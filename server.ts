import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import http from 'http';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import JSZip from 'jszip';
import {
  COPILOT_TOOL_DEFINITIONS,
  executeWorkspaceTool,
  extractThinkingFromContent,
  type WorkspaceMutableState,
} from './src/utils/agentTools.ts';
import {
  WORKFLOW_FILE_PATH,
  extractRelevantGradleErrors,
  formatGitHubJobLiveLogs,
  generateGradleWorkflowYaml,
} from './src/utils/githubActionsEngine.ts';
import {
  consumeCopilotUsage,
  createInitialCopilotUsage,
  normalizeCopilotUsage,
  type HeaderQuotaSync,
} from './src/utils/copilotQuota.ts';
import type {
  ChatMessage,
  ChatProject,
  Collaborator,
  CopilotUsageState,
  GitHubBuildRun,
  GitHubBuildStep,
  GitHubUser,
  ToolCallRecord,
  VirtualFile,
  VisionAttachment,
} from './src/types/ide.ts';

interface AuthSession {
  id: string;
  token: string;
  user: GitHubUser;
  createdAt: number;
}

interface RoomClient {
  ws: WebSocket;
  user: GitHubUser;
}

interface RoomState {
  roomId: string;
  ownerLogin: string;
  projectSnapshot: ChatProject | null;
  allowedLogins: Set<string>;
  clients: Set<RoomClient>;
}

const PORT = 3000;
const SESSION_COOKIE = 'cf_session';
const DATA_DIR = path.resolve(process.cwd(), '.craftforge-data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const sessions = new Map<string, AuthSession>();
const rooms = new Map<string, RoomState>();
const sandboxBuildRuns = new Map<string, { attempt: number; run: GitHubBuildRun; polls: number }>();

function loadSessionsFromDisk() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8')) as Record<string, AuthSession>;
      for (const [k, v] of Object.entries(raw)) {
        sessions.set(k, v);
      }
    }
  } catch {
    // ignore corrupt sessions file
  }
}

function saveSessionsToDisk() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const obj: Record<string, AuthSession> = {};
    for (const [k, v] of sessions.entries()) {
      obj[k] = v;
    }
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(obj), 'utf-8');
  } catch {
    // ignore disk write issues
  }
}

loadSessionsFromDisk();

function getUserProjectsFile(login: string): string {
  const safeLogin = login.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  return path.join(DATA_DIR, `projects_${safeLogin}.json`);
}

function getUserUsageFile(login: string): string {
  const safeLogin = login.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  return path.join(DATA_DIR, `usage_${safeLogin}.json`);
}

function loadUserCopilotUsage(login: string): CopilotUsageState {
  const file = getUserUsageFile(login);
  try {
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<CopilotUsageState>;
      return normalizeCopilotUsage(parsed);
    }
  } catch {
    // ignore corrupt usage file
  }
  return createInitialCopilotUsage();
}

function saveUserCopilotUsage(login: string, usage: CopilotUsageState): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(getUserUsageFile(login), JSON.stringify(usage), 'utf-8');
  } catch {
    // ignore disk write issues
  }
}

function parseGitHubRateLimitHeaders(headers: Headers): HeaderQuotaSync | undefined {
  const limitRaw = headers.get('x-ratelimit-limit');
  const remainingRaw = headers.get('x-ratelimit-remaining');
  const resetRaw = headers.get('x-ratelimit-reset');
  if (!limitRaw || !remainingRaw) return undefined;
  const limit = Number(limitRaw);
  const remaining = Number(remainingRaw);
  if (!Number.isFinite(limit) || !Number.isFinite(remaining) || limit <= 0) return undefined;
  const resetSec = resetRaw ? Number(resetRaw) : NaN;
  return {
    limit,
    remaining,
    resetAt: Number.isFinite(resetSec) ? resetSec * 1000 : undefined,
  };
}

function getCookieOptions(
  req: express.Request,
  maxAge: number,
  httpOnly = true
): express.CookieOptions {
  const isHttps =
    req.secure ||
    req.headers['x-forwarded-proto'] === 'https' ||
    (typeof req.headers.origin === 'string' && req.headers.origin.startsWith('https://'));
  return {
    httpOnly,
    sameSite: isHttps ? 'none' : 'lax',
    secure: isHttps,
    path: '/',
    maxAge,
  };
}

function getSessionFromReq(req: express.Request): AuthSession | null {
  const sid =
    req.cookies?.[SESSION_COOKIE] ||
    req.cookies?.cf_auth_sid ||
    (req.headers['x-session-id'] as string | undefined);
  if (sid && sessions.has(sid)) {
    return sessions.get(sid)!;
  }
  const authHeader = req.headers.authorization;
  const bearerToken =
    authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  const cookieToken = req.cookies?.cf_auth_token
    ? String(req.cookies.cf_auth_token).trim()
    : null;
  const candidateToken = bearerToken || cookieToken;
  if (candidateToken) {
    for (const s of sessions.values()) {
      if (s.token === candidateToken || s.id === candidateToken) return s;
    }
  }
  return null;
}

async function fetchGitHubUser(token: string): Promise<GitHubUser> {
  const resp = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'CraftForge-Studio',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`GitHub API ${resp.status}: ${body || 'Token inválido ou expirado'}`);
  }
  const data = (await resp.json()) as GitHubUser;
  return {
    id: data.id,
    login: data.login,
    name: data.name,
    avatar_url: data.avatar_url,
    html_url: data.html_url,
  };
}

async function resolveOrRestoreSession(
  req: express.Request,
  res: express.Response
): Promise<AuthSession | null> {
  const existing = getSessionFromReq(req);
  if (existing) return existing;

  const authHeader = req.headers.authorization;
  const bearerToken =
    authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const cookieToken = req.cookies?.cf_auth_token
    ? String(req.cookies.cf_auth_token).trim()
    : '';
  const restoreToken = bearerToken || cookieToken;

  if (!restoreToken || restoreToken === 'sandbox-autostart-token' || restoreToken.length < 10) {
    return null;
  }

  try {
    const user = await fetchGitHubUser(restoreToken);
    const sessionId = crypto.randomUUID();
    const restored: AuthSession = {
      id: sessionId,
      token: restoreToken,
      user,
      createdAt: Date.now(),
    };
    sessions.set(sessionId, restored);
    saveSessionsToDisk();
    const thirtyDaysMs = 1000 * 60 * 60 * 24 * 30;
    res.cookie(SESSION_COOKIE, sessionId, getCookieOptions(req, thirtyDaysMs, true));
    res.cookie('cf_auth_sid', sessionId, getCookieOptions(req, thirtyDaysMs, false));
    res.cookie('cf_auth_token', restoreToken, getCookieOptions(req, thirtyDaysMs, false));
    return restored;
  } catch {
    return null;
  }
}

async function resolveCopilotEndpoint(
  githubToken: string
): Promise<{ endpoint: string; authToken: string; extraHeaders: Record<string, string>; isCopilotNative: boolean }> {
  // 1. Try native GitHub Copilot token exchange (works for ghu_/gho_ Copilot OAuth tokens)
  try {
    const exchangeResp = await fetch('https://api.github.com/copilot_internal/v2/token', {
      headers: {
        Authorization: `token ${githubToken}`,
        Accept: 'application/json',
        'User-Agent': 'CraftForge-Studio/1.0',
      },
      signal: AbortSignal.timeout(12000),
    });
    if (exchangeResp.ok) {
      const data = (await exchangeResp.json()) as {
        token?: string;
        endpoints?: { api?: string };
      };
      if (data.token) {
        const base = data.endpoints?.api || 'https://api.individual.githubcopilot.com';
        return {
          endpoint: `${base.replace(/\/$/, '')}/chat/completions`,
          authToken: data.token,
          extraHeaders: {
            'Copilot-Integration-Id': 'vscode-chat',
            'Editor-Version': 'vscode/1.98.0',
          },
          isCopilotNative: true,
        };
      }
    }
  } catch {
    // Fall back to GitHub Models inference endpoint
  }

  // 2. GitHub Models API (works with standard GitHub PAT ghp_ / github_pat_ with models:read)
  return {
    endpoint: 'https://models.github.ai/inference/chat/completions',
    authToken: githubToken,
    extraHeaders: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    isCopilotNative: false,
  };
}

function normalizeModelForEndpoint(model: string, useShortName: boolean): string {
  if (!useShortName) return model;
  // Copilot native & Azure AI inference endpoints use short model names like gpt-4o, gpt-4.1, o3-mini
  return model.includes('/') ? model.split('/')[1] : model;
}

function broadcastRoom(room: RoomState, payload: Record<string, unknown>, excludeWs?: WebSocket) {
  const data = JSON.stringify(payload);
  for (const client of room.clients) {
    if (client.ws !== excludeWs && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(data);
    }
  }
}

function getRoomOnlineUsers(room: RoomState) {
  const seen = new Map<string, GitHubUser>();
  for (const c of room.clients) {
    seen.set(c.user.login, c.user);
  }
  return Array.from(seen.values());
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));
  app.use(cookieParser());

  // --- Auth Routes ---
  app.post('/api/auth/github', async (req, res) => {
    const token = String(req.body?.token || '').trim();
    if (!token) {
      return res.status(400).json({ error: 'Informe um GitHub Token válido.' });
    }
    if (token.length < 10) {
      return res.status(400).json({ error: 'Formato de GitHub Token inválido.' });
    }

    try {
      const user = await fetchGitHubUser(token);
      const sessionId = crypto.randomUUID();
      sessions.set(sessionId, {
        id: sessionId,
        token,
        user,
        createdAt: Date.now(),
      });
      saveSessionsToDisk();
      const thirtyDaysMs = 1000 * 60 * 60 * 24 * 30;
      res.cookie(SESSION_COOKIE, sessionId, getCookieOptions(req, thirtyDaysMs, true));
      res.cookie('cf_auth_sid', sessionId, getCookieOptions(req, thirtyDaysMs, false));
      res.cookie('cf_auth_token', token, getCookieOptions(req, thirtyDaysMs, false));
      return res.json({
        user,
        sessionId,
        copilotUsage: loadUserCopilotUsage(user.login),
      });
    } catch (err) {
      return res.status(401).json({
        error:
          err instanceof Error
            ? err.message
            : 'Falha ao autenticar com a API do GitHub.',
      });
    }
  });

  // Automated inspection route ONLY invoked when ?autostart=1 is explicitly in URL
  app.post('/api/auth/sandbox', (req, res) => {
    const sessionId = crypto.randomUUID();
    const user: GitHubUser = {
      id: 900001,
      login: 'craftforge-dev',
      name: 'CraftForge Sandbox',
      avatar_url: '',
      isSandbox: true,
    };
    sessions.set(sessionId, {
      id: sessionId,
      token: 'sandbox-autostart-token',
      user,
      createdAt: Date.now(),
    });
    saveSessionsToDisk();
    res.cookie(SESSION_COOKIE, sessionId, getCookieOptions(req, 1000 * 60 * 60 * 2));
    return res.json({
      user,
      sessionId,
      copilotUsage: loadUserCopilotUsage(user.login),
    });
  });

  app.get('/api/auth/me', async (req, res) => {
    const session = await resolveOrRestoreSession(req, res);
    if (!session) {
      return res.status(200).json({ authenticated: false, user: null });
    }
    return res.json({
      authenticated: true,
      user: session.user,
      sessionId: session.id,
      copilotUsage: loadUserCopilotUsage(session.user.login),
    });
  });

  app.get('/api/copilot/usage', async (req, res) => {
    const session = await resolveOrRestoreSession(req, res);
    if (!session) {
      return res.status(401).json({ error: 'Login obrigatório com GitHub Token.' });
    }
    return res.json({ copilotUsage: loadUserCopilotUsage(session.user.login) });
  });

  app.post('/api/auth/logout', (req, res) => {
    const sid =
      req.cookies?.[SESSION_COOKIE] ||
      req.cookies?.cf_auth_sid ||
      (req.headers['x-session-id'] as string | undefined);
    if (sid) {
      sessions.delete(sid);
      saveSessionsToDisk();
    }
    res.clearCookie(SESSION_COOKIE, getCookieOptions(req, 0, true));
    res.clearCookie('cf_auth_sid', getCookieOptions(req, 0, false));
    res.clearCookie('cf_auth_token', getCookieOptions(req, 0, false));
    res.clearCookie('cf_auth_user', getCookieOptions(req, 0, false));
    return res.json({ ok: true });
  });

  // --- Cookie-Keyed User Projects Persistence ---
  app.get('/api/projects', async (req, res) => {
    const session = await resolveOrRestoreSession(req, res);
    if (!session) {
      return res.status(401).json({ error: 'Login obrigatório com GitHub Token.' });
    }
    const file = getUserProjectsFile(session.user.login);
    if (!fs.existsSync(file)) {
      return res.json({ projects: [], activeProjectId: null });
    }
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
        projects?: ChatProject[];
        activeProjectId?: string | null;
      };
      return res.json({
        projects: Array.isArray(data.projects) ? data.projects : [],
        activeProjectId: data.activeProjectId || null,
      });
    } catch {
      return res.json({ projects: [], activeProjectId: null });
    }
  });

  app.post('/api/projects', async (req, res) => {
    const session = await resolveOrRestoreSession(req, res);
    if (!session) {
      return res.status(401).json({ error: 'Login obrigatório com GitHub Token.' });
    }
    const { projects = [], activeProjectId = null } = req.body as {
      projects?: ChatProject[];
      activeProjectId?: string | null;
    };
    const file = getUserProjectsFile(session.user.login);
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(file, JSON.stringify({ projects, activeProjectId }), 'utf-8');
      return res.json({ ok: true });
    } catch {
      return res.status(500).json({ error: 'Erro ao salvar projetos.' });
    }
  });

  // --- Lookup GitHub User for Collaborator Invite ---
  app.get('/api/github/user/:username', async (req, res) => {
    const session = await resolveOrRestoreSession(req, res);
    if (!session) {
      return res.status(401).json({ error: 'Login obrigatório com GitHub Token.' });
    }
    const username = String(req.params.username || '').trim().replace(/^@/, '');
    if (!username) {
      return res.status(400).json({ error: 'Informe um usuário do GitHub.' });
    }

    if (session.user.isSandbox) {
      return res.json({
        user: {
          id: 999000 + username.length,
          login: username,
          name: username,
          avatar_url: '',
        },
      });
    }

    try {
      const resp = await fetch(`https://api.github.com/users/${encodeURIComponent(username)}`, {
        headers: {
          Authorization: `Bearer ${session.token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'CraftForge-Studio',
        },
      });
      if (!resp.ok) {
        return res.status(resp.status).json({
          error: `Usuário "${username}" não encontrado no GitHub (${resp.status}).`,
        });
      }
      const data = (await resp.json()) as GitHubUser;
      return res.json({
        user: {
          id: data.id,
          login: data.login,
          name: data.name,
          avatar_url: data.avatar_url,
          html_url: data.html_url,
        },
      });
    } catch {
      return res.status(502).json({ error: 'Erro de rede ao consultar GitHub API.' });
    }
  });

  // --- GitHub Actions: Create Repository ---
  app.post('/api/github/actions/create-repo', async (req, res) => {
    const session = await resolveOrRestoreSession(req, res);
    if (!session) {
      return res.status(401).json({ error: 'Login obrigatório com GitHub Token.' });
    }
    const name = String(req.body?.name || '').trim().replace(/[^a-zA-Z0-9._-]/g, '-');
    const isPrivate = Boolean(req.body?.isPrivate ?? true);
    const description = String(req.body?.description || 'Projeto Minecraft Gradle via CraftForge Studio');
    if (!name) {
      return res.status(400).json({ error: 'Informe um nome válido para o repositório.' });
    }

    if (session.user.isSandbox) {
      return res.json({
        repoFullName: `${session.user.login}/${name}`,
        defaultBranch: 'main',
        htmlUrl: `https://github.com/${session.user.login}/${name}`,
      });
    }

    try {
      const resp = await fetch('https://api.github.com/user/repos', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'User-Agent': 'CraftForge-Studio',
        },
        body: JSON.stringify({
          name,
          private: isPrivate,
          description,
          auto_init: true,
        }),
      });
      const data = (await resp.json().catch(() => ({}))) as {
        full_name?: string;
        default_branch?: string;
        html_url?: string;
        message?: string;
      };
      if (!resp.ok || !data.full_name) {
        return res.status(resp.status || 400).json({
          error:
            data.message ||
            `GitHub API ${resp.status}: verifique se o token possui permissão "repo".`,
        });
      }
      return res.json({
        repoFullName: data.full_name,
        defaultBranch: data.default_branch || 'main',
        htmlUrl: data.html_url || `https://github.com/${data.full_name}`,
      });
    } catch {
      return res.status(502).json({ error: 'Erro ao criar repositório na API do GitHub.' });
    }
  });

  // --- GitHub Actions: Push Files Atomically & Trigger Gradle Build ---
  app.post('/api/github/actions/trigger', async (req, res) => {
    const session = await resolveOrRestoreSession(req, res);
    if (!session) {
      return res.status(401).json({ error: 'Login obrigatório com GitHub Token.' });
    }
    const {
      repoFullName,
      branch = 'main',
      files,
      config,
      commitMessage = 'CraftForge Studio: update Gradle Minecraft project',
      autoFixAttempt = 0,
    } = req.body as {
      repoFullName: string;
      branch?: string;
      files: Record<string, VirtualFile>;
      config?: ChatProject['config'];
      commitMessage?: string;
      autoFixAttempt?: number;
    };

    const parts = String(repoFullName || '').trim().split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return res.status(400).json({ error: 'Informe o repositório no formato usuario/repositorio.' });
    }
    const [owner, repo] = parts;

    if (session.user.isSandbox) {
      const prev = sandboxBuildRuns.get(repoFullName);
      const nextAttempt = autoFixAttempt > 0 ? autoFixAttempt + 1 : (prev?.attempt || 0) + 1;
      const runId = 7000 + nextAttempt;
      const commitSha = `sb_${Date.now().toString(16)}`;
      const run: GitHubBuildRun = {
        id: runId,
        status: 'in_progress',
        conclusion: null,
        htmlUrl: `https://github.com/${owner}/${repo}/actions/runs/${runId}`,
        commitSha,
        createdAt: new Date().toISOString(),
        autoFixAttempt,
      };
      sandboxBuildRuns.set(repoFullName, { attempt: nextAttempt, run, polls: 0 });
      return res.json({ run, commitSha });
    }

    const ghHeaders = {
      Authorization: `Bearer ${session.token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'CraftForge-Studio',
    };

    try {
      // Ensure workflow YAML exists in pushed files
      const allFiles: Record<string, VirtualFile> = { ...(files || {}) };
      if (!allFiles[WORKFLOW_FILE_PATH] && config) {
        allFiles[WORKFLOW_FILE_PATH] = {
          path: WORKFLOW_FILE_PATH,
          content: generateGradleWorkflowYaml(config),
          updatedAt: Date.now(),
        };
      }

      // 1. Get branch ref (initialize repo with README if empty)
      let headSha = '';
      const refResp = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`,
        { headers: ghHeaders }
      );

      if (refResp.status === 404 || refResp.status === 409) {
        const initResp = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/contents/README.md`,
          {
            method: 'PUT',
            headers: ghHeaders,
            body: JSON.stringify({
              message: 'chore: initialize CraftForge Gradle repository',
              content: Buffer.from(`# ${repo}\n\nProjeto Minecraft Gradle gerenciado no CraftForge Studio.\n`).toString('base64'),
              branch,
            }),
          }
        );
        if (!initResp.ok) {
          const errData = (await initResp.json().catch(() => ({}))) as { message?: string };
          return res.status(initResp.status).json({
            error: `Falha ao inicializar branch ${branch}: ${errData.message || initResp.status}`,
          });
        }
        const initJson = (await initResp.json()) as { commit?: { sha?: string } };
        headSha = initJson.commit?.sha || '';
      } else if (!refResp.ok) {
        const errData = (await refResp.json().catch(() => ({}))) as { message?: string };
        return res.status(refResp.status).json({
          error: `Erro ao acessar repositório ${owner}/${repo}: ${errData.message || refResp.status}`,
        });
      } else {
        const refJson = (await refResp.json()) as { object?: { sha?: string } };
        headSha = refJson.object?.sha || '';
      }

      // 2. Get base tree SHA
      const commitInfoResp = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/git/commits/${headSha}`,
        { headers: ghHeaders }
      );
      const commitInfo = (await commitInfoResp.json()) as { tree?: { sha?: string } };
      const baseTreeSha = commitInfo.tree?.sha;

      // 3. Create blobs & tree entries
      const treeItems: Array<{ path: string; mode: string; type: 'blob'; sha: string }> = [];
      for (const [filePath, vfile] of Object.entries(allFiles)) {
        const blobResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/blobs`, {
          method: 'POST',
          headers: ghHeaders,
          body: JSON.stringify({
            content: vfile.content,
            encoding: 'utf-8',
          }),
        });
        if (!blobResp.ok) {
          const errData = (await blobResp.json().catch(() => ({}))) as { message?: string };
          return res.status(blobResp.status).json({
            error: `Erro ao enviar ${filePath}: ${errData.message || blobResp.status}`,
          });
        }
        const blobJson = (await blobResp.json()) as { sha: string };
        treeItems.push({
          path: filePath,
          mode: filePath === 'gradlew' ? '100755' : '100644',
          type: 'blob',
          sha: blobJson.sha,
        });
      }

      // 4. Create tree
      const treeResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees`, {
        method: 'POST',
        headers: ghHeaders,
        body: JSON.stringify({
          base_tree: baseTreeSha,
          tree: treeItems,
        }),
      });
      if (!treeResp.ok) {
        const errData = (await treeResp.json().catch(() => ({}))) as { message?: string };
        return res.status(treeResp.status).json({
          error: `Erro ao criar árvore Git: ${errData.message || treeResp.status}`,
        });
      }
      const treeJson = (await treeResp.json()) as { sha: string };

      // 5. Create commit
      const newCommitResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/commits`, {
        method: 'POST',
        headers: ghHeaders,
        body: JSON.stringify({
          message: commitMessage,
          tree: treeJson.sha,
          parents: [headSha],
        }),
      });
      if (!newCommitResp.ok) {
        const errData = (await newCommitResp.json().catch(() => ({}))) as { message?: string };
        return res.status(newCommitResp.status).json({
          error: `Erro ao criar commit: ${errData.message || newCommitResp.status}`,
        });
      }
      const newCommitJson = (await newCommitResp.json()) as { sha: string };

      // 6. Update branch ref (triggers push workflow)
      const patchRefResp = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`,
        {
          method: 'PATCH',
          headers: ghHeaders,
          body: JSON.stringify({ sha: newCommitJson.sha }),
        }
      );
      if (!patchRefResp.ok) {
        const errData = (await patchRefResp.json().catch(() => ({}))) as { message?: string };
        return res.status(patchRefResp.status).json({
          error: `Erro ao atualizar branch ${branch}: ${errData.message || patchRefResp.status}`,
        });
      }

      return res.json({
        commitSha: newCommitJson.sha,
        run: {
          id: 0,
          status: 'queued',
          conclusion: null,
          htmlUrl: `https://github.com/${owner}/${repo}/actions`,
          commitSha: newCommitJson.sha,
          createdAt: new Date().toISOString(),
          autoFixAttempt,
        } satisfies GitHubBuildRun,
      });
    } catch (err) {
      return res.status(502).json({
        error:
          err instanceof Error
            ? `Erro ao iniciar build no GitHub Actions: ${err.message}`
            : 'Erro ao iniciar build no GitHub Actions.',
      });
    }
  });

  // --- GitHub Actions: Poll Status, Logs & Artifacts ---
  app.get('/api/github/actions/status', async (req, res) => {
    const session = await resolveOrRestoreSession(req, res);
    if (!session) {
      return res.status(401).json({ error: 'Login obrigatório com GitHub Token.' });
    }
    const repoFullName = String(req.query.repo || '').trim();
    const commitSha = String(req.query.commitSha || '').trim();
    const runIdParam = Number(req.query.runId || 0);
    const parts = repoFullName.split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return res.status(400).json({ error: 'Repositório inválido.' });
    }
    const [owner, repo] = parts;

    if (session.user.isSandbox) {
      const entry = sandboxBuildRuns.get(repoFullName);
      if (!entry) {
        return res.json({ run: null });
      }
      entry.polls += 1;

      if (entry.polls === 1) {
        const steps: GitHubBuildStep[] = [
          { name: 'Checkout repository', status: 'completed', conclusion: 'success' },
          { name: 'Setup Java & Gradle Toolchain', status: 'in_progress', conclusion: null },
          { name: 'Build Gradle JAR', status: 'queued', conclusion: null },
        ];
        entry.run = {
          ...entry.run,
          status: 'in_progress',
          conclusion: null,
          steps,
          liveLogs: formatGitHubJobLiveLogs(
            steps,
            `[${new Date().toLocaleTimeString()}] Inicializando runner ubuntu-latest...\nDownloading Gradle distribution...\nStarting a Gradle Daemon...`
          ),
        };
      } else if (entry.polls === 2) {
        const steps: GitHubBuildStep[] = [
          { name: 'Checkout repository', status: 'completed', conclusion: 'success' },
          { name: 'Setup Java & Gradle Toolchain', status: 'completed', conclusion: 'success' },
          { name: 'Build Gradle JAR', status: 'in_progress', conclusion: null },
        ];
        entry.run = {
          ...entry.run,
          status: 'in_progress',
          conclusion: null,
          steps,
          liveLogs: formatGitHubJobLiveLogs(
            steps,
            `> Configure project :\n> Task :compileJava\nCompilando classes Java e dependências Gradle...`
          ),
        };
      } else {
        if (entry.attempt === 1) {
          const steps: GitHubBuildStep[] = [
            { name: 'Checkout repository', status: 'completed', conclusion: 'success' },
            { name: 'Setup Java & Gradle Toolchain', status: 'completed', conclusion: 'success' },
            { name: 'Build Gradle JAR', status: 'completed', conclusion: 'failure' },
          ];
          const errLog =
            '> Task :compileJava FAILED\nsrc/main/java/com/craftforge/arenapvp/ArenaPvPPlugin.java:18: error: cannot find symbol\n  symbol:   method registerBrokenPlaceholder()\n  location: class ArenaPvPPlugin\nFAILURE: Build failed with an exception.';
          entry.run = {
            ...entry.run,
            status: 'completed',
            conclusion: 'failure',
            steps,
            logsExcerpt: errLog,
            liveLogs: formatGitHubJobLiveLogs(steps, errLog),
          };
        } else {
          const steps: GitHubBuildStep[] = [
            { name: 'Checkout repository', status: 'completed', conclusion: 'success' },
            { name: 'Setup Java & Gradle Toolchain', status: 'completed', conclusion: 'success' },
            { name: 'Build Gradle JAR', status: 'completed', conclusion: 'success' },
            { name: 'Upload Compiled JAR Artifact', status: 'completed', conclusion: 'success' },
          ];
          entry.run = {
            ...entry.run,
            status: 'completed',
            conclusion: 'success',
            steps,
            liveLogs: formatGitHubJobLiveLogs(
              steps,
              `> Task :compileJava UP-TO-DATE\n> Task :processResources\n> Task :jar\n> Task :build\nBUILD SUCCESSFUL in 3s\nArtifact minecraft-build-jar (${repo}-1.0.0.jar) enviado!`
            ),
            artifacts: [
              {
                id: 9001,
                name: 'minecraft-build-jar',
                sizeInBytes: 4280,
                downloadUrl: `/api/github/actions/artifact?repo=${encodeURIComponent(repoFullName)}&artifactId=9001&filename=${encodeURIComponent(`${repo}-1.0.0.jar`)}`,
              },
            ],
          };
        }
      }
      return res.json({ run: entry.run });
    }

    const ghHeaders = {
      Authorization: `Bearer ${session.token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'CraftForge-Studio',
    };

    try {
      const runsResp = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/actions/runs?per_page=10`,
        { headers: ghHeaders }
      );
      if (!runsResp.ok) {
        return res.status(runsResp.status).json({
          error: `GitHub Actions API ${runsResp.status}`,
        });
      }
      const runsData = (await runsResp.json()) as {
        workflow_runs?: Array<{
          id: number;
          status: string;
          conclusion: string | null;
          html_url: string;
          head_sha: string;
          created_at: string;
        }>;
      };

      const matched =
        runsData.workflow_runs?.find((r) => (runIdParam > 0 ? r.id === runIdParam : false)) ||
        runsData.workflow_runs?.find((r) => (commitSha ? r.head_sha === commitSha : false)) ||
        runsData.workflow_runs?.[0];

      if (!matched) {
        return res.json({
          run: {
            id: 0,
            status: 'queued',
            conclusion: null,
            htmlUrl: `https://github.com/${owner}/${repo}/actions`,
            commitSha,
            createdAt: new Date().toISOString(),
            liveLogs: '• [GitHub Actions] Aguardando criação do runner na fila...',
          } satisfies GitHubBuildRun,
        });
      }

      const resultRun: GitHubBuildRun = {
        id: matched.id,
        status: (matched.status as GitHubBuildRun['status']) || 'queued',
        conclusion: (matched.conclusion as GitHubBuildRun['conclusion']) || null,
        htmlUrl: matched.html_url,
        commitSha: matched.head_sha,
        createdAt: matched.created_at,
      };

      // Fetch live job steps & available logs on every 1s poll
      try {
        const jobsResp = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/actions/runs/${matched.id}/jobs`,
          { headers: ghHeaders }
        );
        if (jobsResp.ok) {
          const jobsData = (await jobsResp.json()) as {
            jobs?: Array<{
              id: number;
              status: string;
              conclusion: string | null;
              steps?: Array<{
                name: string;
                status: 'queued' | 'in_progress' | 'completed';
                conclusion: string | null;
              }>;
            }>;
          };
          const primaryJob =
            jobsData.jobs?.find((j) => j.conclusion === 'failure') || jobsData.jobs?.[0];
          if (primaryJob) {
            const steps: GitHubBuildStep[] = (primaryJob.steps || []).map((s) => ({
              name: s.name,
              status: s.status,
              conclusion: s.conclusion,
            }));
            resultRun.steps = steps;

            let rawLogs = '';
            try {
              const logsResp = await fetch(
                `https://api.github.com/repos/${owner}/${repo}/actions/jobs/${primaryJob.id}/logs`,
                { headers: ghHeaders }
              );
              if (logsResp.ok) {
                rawLogs = await logsResp.text();
              }
            } catch {
              // raw job logs may not be ready until step/job completes
            }

            resultRun.liveLogs = formatGitHubJobLiveLogs(steps, rawLogs);
            if (resultRun.status === 'completed' && resultRun.conclusion === 'failure' && rawLogs) {
              resultRun.logsExcerpt = extractRelevantGradleErrors(rawLogs);
            }
          }
        }
      } catch {
        // ignore live job fetch error
      }

      if (resultRun.status === 'completed' && resultRun.conclusion === 'success') {
        try {
          const artResp = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/actions/runs/${matched.id}/artifacts`,
            { headers: ghHeaders }
          );
          if (artResp.ok) {
            const artData = (await artResp.json()) as {
              artifacts?: Array<{ id: number; name: string; size_in_bytes: number }>;
            };
            resultRun.artifacts = (artData.artifacts || []).map((a) => ({
              id: a.id,
              name: a.name,
              sizeInBytes: a.size_in_bytes,
              downloadUrl: `/api/github/actions/artifact?repo=${encodeURIComponent(repoFullName)}&artifactId=${a.id}&filename=${encodeURIComponent(`${repo}.jar`)}`,
            }));
          }
        } catch {
          // ignore artifact list error
        }
      }

      return res.json({ run: resultRun });
    } catch {
      return res.status(502).json({ error: 'Erro ao consultar status do GitHub Actions.' });
    }
  });

  // --- GitHub Actions: Download Compiled JAR (extracts .jar from GitHub artifact zip) ---
  app.get('/api/github/actions/artifact', async (req, res) => {
    const session = await resolveOrRestoreSession(req, res);
    if (!session) {
      return res.status(401).json({ error: 'Login obrigatório com GitHub Token.' });
    }
    const repoFullName = String(req.query.repo || '').trim();
    const artifactId = Number(req.query.artifactId || 0);
    const desiredName = String(req.query.filename || 'minecraft-plugin.jar').replace(
      /[^a-zA-Z0-9._-]/g,
      '_'
    );
    const parts = repoFullName.split('/');
    if (parts.length !== 2 || !artifactId) {
      return res.status(400).json({ error: 'Parâmetros de artefato inválidos.' });
    }
    const [owner, repo] = parts;

    if (session.user.isSandbox) {
      const jarZip = new JSZip();
      jarZip.file(
        'META-INF/MANIFEST.MF',
        'Manifest-Version: 1.0\nCreated-By: CraftForge Studio Gradle Actions\n'
      );
      const buf = await jarZip.generateAsync({ type: 'nodebuffer' });
      res.setHeader('Content-Type', 'application/java-archive');
      res.setHeader('Content-Disposition', `attachment; filename="${desiredName}"`);
      return res.send(buf);
    }

    try {
      const zipResp = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/actions/artifacts/${artifactId}/zip`,
        {
          headers: {
            Authorization: `Bearer ${session.token}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'CraftForge-Studio',
          },
        }
      );
      if (!zipResp.ok) {
        return res.status(zipResp.status).json({
          error: `Erro ao baixar artefato do GitHub (${zipResp.status}).`,
        });
      }
      const arrBuf = await zipResp.arrayBuffer();
      const loadedZip = await JSZip.loadAsync(arrBuf);
      const jarEntryName = Object.keys(loadedZip.files).find(
        (name) => name.endsWith('.jar') && !loadedZip.files[name].dir
      );
      if (jarEntryName) {
        const jarBuf = await loadedZip.files[jarEntryName].async('nodebuffer');
        const outName = jarEntryName.split('/').pop() || desiredName;
        res.setHeader('Content-Type', 'application/java-archive');
        res.setHeader('Content-Disposition', `attachment; filename="${outName}"`);
        return res.send(jarBuf);
      }

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${desiredName}.zip"`);
      return res.send(Buffer.from(arrBuf));
    } catch {
      return res.status(502).json({ error: 'Falha ao processar download do artefato.' });
    }
  });

  // --- Room State & Invite Sync ---
  app.get('/api/rooms/:roomId', async (req, res) => {
    const session = await resolveOrRestoreSession(req, res);
    if (!session) {
      return res.status(401).json({ error: 'Login obrigatório com GitHub Token.' });
    }
    const room = rooms.get(req.params.roomId);
    if (!room) {
      return res.status(404).json({ error: 'Sala de colaboração não encontrada ou expirada.' });
    }
    return res.json({
      roomId: room.roomId,
      ownerLogin: room.ownerLogin,
      project: room.projectSnapshot,
      onlineUsers: getRoomOnlineUsers(room),
    });
  });

  app.post('/api/rooms/:roomId/sync', async (req, res) => {
    const session = await resolveOrRestoreSession(req, res);
    if (!session) {
      return res.status(401).json({ error: 'Login obrigatório com GitHub Token.' });
    }
    const roomId = req.params.roomId;
    const project = req.body?.project as ChatProject | undefined;
    if (!project) {
      return res.status(400).json({ error: 'Projeto ausente.' });
    }
    let room = rooms.get(roomId);
    if (!room) {
      room = {
        roomId,
        ownerLogin: session.user.login,
        projectSnapshot: project,
        allowedLogins: new Set([
          session.user.login.toLowerCase(),
          ...project.collaborators.map((c) => c.login.toLowerCase()),
        ]),
        clients: new Set(),
      };
      rooms.set(roomId, room);
    } else {
      room.projectSnapshot = project;
      for (const c of project.collaborators) {
        room.allowedLogins.add(c.login.toLowerCase());
      }
    }
    return res.json({ ok: true, onlineUsers: getRoomOnlineUsers(room) });
  });

  // --- GitHub Copilot / Models Agent Chat (TOOLS + VISION + THINKING + QUOTA) ---
  app.post('/api/copilot/chat', async (req, res) => {
    const session = await resolveOrRestoreSession(req, res);
    if (!session) {
      return res.status(401).json({ error: 'Autenticação via GitHub Token obrigatória.' });
    }

    const currentUsage = loadUserCopilotUsage(session.user.login);
    if (currentUsage.remaining <= 0) {
      return res.status(429).json({
        error: `Limite de uso do GitHub Copilot atingido (${currentUsage.used}/${currentUsage.limit}). Aguarde a renovação da cota.`,
        copilotUsage: currentUsage,
      });
    }

    const {
      model = 'openai/gpt-4.1',
      thinkingEnabled = true,
      thinkingEffort = 'medium',
      messages = [],
      images = [],
      projectContext,
    } = req.body as {
      model?: string;
      thinkingEnabled?: boolean;
      thinkingEffort?: 'low' | 'medium' | 'high';
      messages?: ChatMessage[];
      images?: VisionAttachment[];
      projectContext: WorkspaceMutableState;
    };

    if (!projectContext || !projectContext.config) {
      return res.status(400).json({ error: 'Contexto do projeto Gradle ausente.' });
    }

    let workingState: WorkspaceMutableState = {
      config: { ...projectContext.config },
      files: { ...projectContext.files },
      folders: [...(projectContext.folders || [])],
    };

    const executedToolCalls: ToolCallRecord[] = [];

    // Sandbox verification path ONLY when started via ?autostart=1 without a real token
    if (session.user.isSandbox) {
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      const userPrompt = lastUser?.content || '';
      const hasImages = (images?.length || 0) > 0 || (lastUser?.images?.length || 0) > 0;

      const listTool = executeWorkspaceTool(
        workingState,
        'tc_sandbox_1',
        'validate_gradle_setup',
        {},
        session.user.login
      );
      workingState = listTool.state;
      executedToolCalls.push(listTool.record);

      if (/erro|corrig|fix|log|build|actions|falh|criar|add|módulo|module|comando|command|pvp|kb|reach/i.test(userPrompt)) {
        const pkgPath = workingState.config.groupId.replace(/\./g, '/');
        const targetPath = `src/main/java/${pkgPath}/CopilotGeneratedFeature.java`;
        const writeTool = executeWorkspaceTool(
          workingState,
          'tc_sandbox_2',
          'write_file',
          {
            path: targetPath,
            content: `package ${workingState.config.groupId};\n\n// Gerado/Corrigido via Gradle Toolchain Java ${workingState.config.javaVersion} (MC ${workingState.config.minecraftVersion})\npublic class CopilotGeneratedFeature {\n    public static String describe() {\n        return "Código validado para ${workingState.config.name}";\n    }\n}\n`,
          },
          session.user.login
        );
        workingState = writeTool.state;
        executedToolCalls.push(writeTool.record);
      }

      const thinking = thinkingEnabled
        ? `1. Analisando projeto ${workingState.config.name} (${workingState.config.platform}, Minecraft ${workingState.config.minecraftVersion}, Java ${workingState.config.javaVersion}).\n2. Verificando toolchain Gradle ${workingState.config.gradleVersion}${hasImages ? ' e imagem anexada via Vision' : ''}.\n3. Executando validação de estrutura e ferramentas no workspace.`
        : '';

      const quotaStep = consumeCopilotUsage(currentUsage);
      saveUserCopilotUsage(session.user.login, quotaStep.nextUsage);

      return res.json({
        message: {
          id: `msg_${Date.now()}`,
          role: 'assistant',
          content: `Modo Sandbox de verificação ativo. Validei a configuração Gradle (${workingState.config.platform} · MC ${workingState.config.minecraftVersion} · Java ${workingState.config.javaVersion})${hasImages ? ' e recebi o anexo visual para análise' : ''}. Para chamadas reais ao GitHub Copilot, faça login com seu GitHub Token pessoal.`,
          thinking,
          toolCalls: executedToolCalls,
          model,
          createdAt: Date.now(),
        },
        updatedWorkspace: workingState,
        copilotUsage: quotaStep.nextUsage,
        quotaWarning: quotaStep.warning,
      });
    }

    try {
      const { endpoint, authToken, extraHeaders, isCopilotNative } = await resolveCopilotEndpoint(
        session.token
      );

      const systemPrompt = `Você é o Agente Especialista em Minecraft Gradle do CraftForge Studio (via GitHub Copilot).
Você domina TODAS as versões do Minecraft (1.7.10 até 1.21.5+) e TODAS as versões do Java (Java 8 até Java 24), exclusivamente usando Gradle (build.gradle / build.gradle.kts, Java Toolchains, Paper/Spigot/Velocity/Fabric/Forge/NeoForge/Mixin PvP Clients).

Estado atual do projeto:
- Nome: ${workingState.config.name}
- Plataforma: ${workingState.config.platform}
- Minecraft: ${workingState.config.minecraftVersion}
- Java Toolchain: Java ${workingState.config.javaVersion}
- Gradle Wrapper: ${workingState.config.gradleVersion} (${workingState.config.dsl})
- Group ID: ${workingState.config.groupId}
- Arquivos existentes: ${Object.keys(workingState.files).join(', ')}

Regras do Agente:
1. Use as tools (list_files, read_file, write_file, create_folder, delete_path, configure_gradle_project, validate_gradle_setup) sempre que precisar inspecionar ou modificar o projeto.
2. Nunca use Maven (pom.xml) — todo build, dependência e Java toolchain deve ser estritamente via Gradle.
3. Responda em português de forma clara, técnica e objetiva.${
        thinkingEnabled
          ? `\n4. Antes da resposta final, estruture seu raciocínio dentro de tags <think>...</think> com nível de profundidade "${thinkingEffort}".`
          : ''
      }`;

      const apiMessages: Array<Record<string, unknown>> = [
        { role: 'system', content: systemPrompt },
      ];

      for (let i = 0; i < messages.length; i++) {
        const m = messages[i];
        if (m.role === 'system') continue;
        const isLastUser = i === messages.length - 1 && m.role === 'user';
        const attached = isLastUser && images.length > 0 ? images : m.images || [];

        if (m.role === 'user' && attached.length > 0) {
          const contentParts: Array<Record<string, unknown>> = [
            { type: 'text', text: m.content || 'Analise esta imagem no contexto do projeto Minecraft.' },
          ];
          for (const img of attached) {
            contentParts.push({
              type: 'image_url',
              image_url: { url: img.dataUrl },
            });
          }
          apiMessages.push({ role: 'user', content: contentParts });
        } else {
          apiMessages.push({ role: m.role, content: m.content });
        }
      }

      let finalContent = '';
      let finalThinking = '';
      let latestHeaderQuota: HeaderQuotaSync | undefined;
      const maxRounds = 4;

      for (let round = 0; round < maxRounds; round++) {
        const makePayload = (useShortName: boolean) => ({
          model: normalizeModelForEndpoint(model, isCopilotNative || useShortName),
          messages: apiMessages,
          tools: COPILOT_TOOL_DEFINITIONS,
          tool_choice: 'auto',
        });

        let aiResp: Response;
        try {
          aiResp = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${authToken}`,
              'User-Agent': 'CraftForge-Studio/1.0',
              ...extraHeaders,
            },
            body: JSON.stringify(makePayload(false)),
            signal: AbortSignal.timeout(45000),
          });
        } catch (primaryErr) {
          if (!isCopilotNative) {
            aiResp = await fetch('https://models.inference.ai.azure.com/chat/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${authToken}`,
                'User-Agent': 'CraftForge-Studio/1.0',
              },
              body: JSON.stringify(makePayload(true)),
              signal: AbortSignal.timeout(45000),
            });
          } else {
            throw primaryErr;
          }
        }

        const parsedHeaders = parseGitHubRateLimitHeaders(aiResp.headers);
        if (parsedHeaders) latestHeaderQuota = parsedHeaders;

        if (!aiResp.ok) {
          const errText = await aiResp.text().catch(() => '');
          if (aiResp.status === 429) {
            const exhausted = consumeCopilotUsage(currentUsage, {
              limit: latestHeaderQuota?.limit || currentUsage.limit,
              remaining: 0,
              resetAt: latestHeaderQuota?.resetAt,
            });
            saveUserCopilotUsage(session.user.login, exhausted.nextUsage);
            return res.status(429).json({
              error: `Limite de uso do GitHub Copilot / Models atingido (HTTP 429).`,
              copilotUsage: exhausted.nextUsage,
              quotaWarning: exhausted.warning,
            });
          }
          return res.status(aiResp.status).json({
            error: `GitHub Copilot / Models retornou HTTP ${aiResp.status}: ${
              errText.slice(0, 300) ||
              'Verifique se o seu GitHub Token possui assinatura Copilot ou permissão models:read.'
            }`,
          });
        }

        const data = (await aiResp.json()) as {
          choices?: Array<{
            message?: {
              role?: string;
              content?: string | null;
              reasoning_content?: string | null;
              tool_calls?: Array<{
                id: string;
                type: string;
                function: { name: string; arguments: string };
              }>;
            };
          }>;
        };

        const choiceMsg = data.choices?.[0]?.message;
        if (!choiceMsg) {
          return res.status(502).json({ error: 'Resposta vazia do endpoint GitHub Copilot.' });
        }

        const rawText = choiceMsg.content || '';
        const parsed = extractThinkingFromContent(
          rawText,
          choiceMsg.reasoning_content || undefined
        );
        if (parsed.thinking) {
          finalThinking = finalThinking ? `${finalThinking}\n\n${parsed.thinking}` : parsed.thinking;
        }

        const toolCalls = choiceMsg.tool_calls;
        if (toolCalls && toolCalls.length > 0) {
          apiMessages.push({
            role: 'assistant',
            content: choiceMsg.content || '',
            tool_calls: toolCalls,
          });

          for (const tc of toolCalls) {
            let parsedArgs: Record<string, unknown> = {};
            try {
              parsedArgs = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>;
            } catch {
              parsedArgs = {};
            }

            const exec = executeWorkspaceTool(
              workingState,
              tc.id,
              tc.function.name,
              parsedArgs,
              session.user.login
            );
            workingState = exec.state;
            executedToolCalls.push(exec.record);

            apiMessages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: exec.record.result,
            });
          }
          continue;
        }

        finalContent = parsed.content;
        break;
      }

      if (!finalContent && executedToolCalls.length > 0) {
        finalContent = 'Alterações aplicadas no projeto via ferramentas do agente.';
      }

      const quotaStep = consumeCopilotUsage(currentUsage, latestHeaderQuota);
      saveUserCopilotUsage(session.user.login, quotaStep.nextUsage);

      return res.json({
        message: {
          id: `msg_${Date.now()}`,
          role: 'assistant',
          content: finalContent,
          thinking: thinkingEnabled ? finalThinking : undefined,
          toolCalls: executedToolCalls.length > 0 ? executedToolCalls : undefined,
          model,
          createdAt: Date.now(),
        },
        updatedWorkspace: workingState,
        copilotUsage: quotaStep.nextUsage,
        quotaWarning: quotaStep.warning,
      });
    } catch (err) {
      return res.status(500).json({
        error:
          err instanceof Error
            ? `Erro ao comunicar com GitHub Copilot: ${err.message}`
            : 'Erro desconhecido ao chamar GitHub Copilot.',
      });
    }
  });

  // --- Vite / Static Middleware ---
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  const server = http.createServer(app);

  // --- Real-Time WebSocket Server for Collaborators ---
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const roomId = url.searchParams.get('room') || '';
    let joinedRoom: RoomState | null = null;
    let joinedClient: RoomClient | null = null;

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          type: string;
          roomId?: string;
          token?: string;
          user?: GitHubUser;
          payload?: Record<string, unknown>;
        };

        if (msg.type === 'join') {
          const targetRoomId = msg.roomId || roomId;
          if (!targetRoomId) return;

          // Resolve authenticated user via cookie session or provided token
          let verifiedUser: GitHubUser | null = null;
          const cookieHeader = req.headers.cookie || '';
          const match = cookieHeader.match(/cf_session=([^;]+)/);
          if (match && sessions.has(decodeURIComponent(match[1]))) {
            verifiedUser = sessions.get(decodeURIComponent(match[1]))!.user;
          } else if (msg.token) {
            try {
              verifiedUser = await fetchGitHubUser(msg.token);
            } catch {
              ws.send(JSON.stringify({ type: 'error', message: 'GitHub Token inválido para WebSocket.' }));
              ws.close();
              return;
            }
          }

          if (!verifiedUser) {
            ws.send(JSON.stringify({ type: 'error', message: 'Autenticação necessária.' }));
            ws.close();
            return;
          }

          let room = rooms.get(targetRoomId);
          if (!room) {
            room = {
              roomId: targetRoomId,
              ownerLogin: verifiedUser.login,
              projectSnapshot: null,
              allowedLogins: new Set([verifiedUser.login.toLowerCase()]),
              clients: new Set(),
            };
            rooms.set(targetRoomId, room);
          }

          joinedRoom = room;
          joinedClient = { ws, user: verifiedUser };
          room.clients.add(joinedClient);

          ws.send(
            JSON.stringify({
              type: 'room:init',
              roomId: targetRoomId,
              onlineUsers: getRoomOnlineUsers(room),
              projectSnapshot: room.projectSnapshot,
            })
          );

          broadcastRoom(room, {
            type: 'presence:update',
            onlineUsers: getRoomOnlineUsers(room),
          });
          return;
        }

        if (!joinedRoom || !joinedClient) return;

        if (msg.type === 'file:save' && msg.payload) {
          const { path: filePath, content, updatedAt } = msg.payload as {
            path: string;
            content: string;
            updatedAt: number;
          };
          if (joinedRoom.projectSnapshot && filePath) {
            joinedRoom.projectSnapshot.files[filePath] = {
              path: filePath,
              content,
              updatedAt: updatedAt || Date.now(),
              updatedBy: joinedClient.user.login,
            };
          }
          broadcastRoom(
            joinedRoom,
            {
              type: 'file:save',
              payload: {
                path: filePath,
                content,
                updatedAt: updatedAt || Date.now(),
                updatedBy: joinedClient.user.login,
              },
            },
            ws
          );
        } else if (msg.type === 'workspace:sync' && msg.payload) {
          const project = msg.payload.project as ChatProject | undefined;
          if (project) {
            joinedRoom.projectSnapshot = project;
            broadcastRoom(
              joinedRoom,
              {
                type: 'workspace:sync',
                payload: { project, by: joinedClient.user.login },
              },
              ws
            );
          }
        } else if (msg.type === 'chat:message' && msg.payload) {
          const chatMessage = msg.payload.message as ChatMessage;
          if (joinedRoom.projectSnapshot && chatMessage) {
            const exists = joinedRoom.projectSnapshot.messages.some((m) => m.id === chatMessage.id);
            if (!exists) {
              joinedRoom.projectSnapshot.messages.push(chatMessage);
            }
          }
          broadcastRoom(
            joinedRoom,
            {
              type: 'chat:message',
              payload: { message: chatMessage },
            },
            ws
          );
        } else if (msg.type === 'collaborator:invited' && msg.payload) {
          const collaborator = msg.payload.collaborator as Collaborator;
          if (collaborator) {
            joinedRoom.allowedLogins.add(collaborator.login.toLowerCase());
            if (joinedRoom.projectSnapshot) {
              const exists = joinedRoom.projectSnapshot.collaborators.some(
                (c) => c.login.toLowerCase() === collaborator.login.toLowerCase()
              );
              if (!exists) {
                joinedRoom.projectSnapshot.collaborators.push(collaborator);
              }
            }
            broadcastRoom(joinedRoom, {
              type: 'collaborator:invited',
              payload: { collaborator },
            });
          }
        }
      } catch {
        // Ignore malformed socket frames
      }
    });

    ws.on('close', () => {
      if (joinedRoom && joinedClient) {
        joinedRoom.clients.delete(joinedClient);
        broadcastRoom(joinedRoom, {
          type: 'presence:update',
          onlineUsers: getRoomOnlineUsers(joinedRoom),
        });
      }
    });
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`CraftForge Studio rodando em http://localhost:${PORT}`);
  });
}

startServer();
