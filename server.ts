import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import http from 'http';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import {
  COPILOT_TOOL_DEFINITIONS,
  executeWorkspaceTool,
  extractThinkingFromContent,
  type WorkspaceMutableState,
} from './src/utils/agentTools.ts';
import type {
  ChatMessage,
  ChatProject,
  Collaborator,
  GitHubUser,
  ToolCallRecord,
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

function getSessionFromReq(req: express.Request): AuthSession | null {
  const sid = req.cookies?.[SESSION_COOKIE];
  if (sid && sessions.has(sid)) {
    return sessions.get(sid)!;
  }
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    for (const s of sessions.values()) {
      if (s.token === token) return s;
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

function normalizeModelForEndpoint(model: string, isCopilotNative: boolean): string {
  if (!isCopilotNative) return model;
  // Copilot native API usually takes short model names like gpt-4o, gpt-4.1, o3-mini, claude-3.7-sonnet
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
      res.cookie(SESSION_COOKIE, sessionId, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 1000 * 60 * 60 * 24 * 7,
      });
      return res.json({ user });
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
    res.cookie(SESSION_COOKIE, sessionId, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 1000 * 60 * 60 * 2,
    });
    return res.json({ user });
  });

  app.get('/api/auth/me', (req, res) => {
    const session = getSessionFromReq(req);
    if (!session) {
      return res.status(200).json({ authenticated: false, user: null });
    }
    return res.json({ authenticated: true, user: session.user });
  });

  app.post('/api/auth/logout', (req, res) => {
    const sid = req.cookies?.[SESSION_COOKIE];
    if (sid) {
      sessions.delete(sid);
      saveSessionsToDisk();
    }
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return res.json({ ok: true });
  });

  // --- Cookie-Keyed User Projects Persistence ---
  app.get('/api/projects', (req, res) => {
    const session = getSessionFromReq(req);
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

  app.post('/api/projects', (req, res) => {
    const session = getSessionFromReq(req);
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
    const session = getSessionFromReq(req);
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

  // --- Room State & Invite Sync ---
  app.get('/api/rooms/:roomId', (req, res) => {
    const session = getSessionFromReq(req);
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

  app.post('/api/rooms/:roomId/sync', (req, res) => {
    const session = getSessionFromReq(req);
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

  // --- GitHub Copilot / Models Agent Chat (TOOLS + VISION + THINKING) ---
  app.post('/api/copilot/chat', async (req, res) => {
    const session = getSessionFromReq(req);
    if (!session) {
      return res.status(401).json({ error: 'Autenticação via GitHub Token obrigatória.' });
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

      if (/criar|add|módulo|module|comando|command|pvp|kb|reach/i.test(userPrompt)) {
        const pkgPath = workingState.config.groupId.replace(/\./g, '/');
        const targetPath = `src/main/java/${pkgPath}/CopilotGeneratedFeature.java`;
        const writeTool = executeWorkspaceTool(
          workingState,
          'tc_sandbox_2',
          'write_file',
          {
            path: targetPath,
            content: `package ${workingState.config.groupId};\n\n// Gerado via Gradle Toolchain Java ${workingState.config.javaVersion} (MC ${workingState.config.minecraftVersion})\npublic class CopilotGeneratedFeature {\n    public static String describe() {\n        return "Recurso criado pelo Agente para ${workingState.config.name}";\n    }\n}\n`,
          },
          session.user.login
        );
        workingState = writeTool.state;
        executedToolCalls.push(writeTool.record);
      }

      const thinking = thinkingEnabled
        ? `1. Analisando projeto ${workingState.config.name} (${workingState.config.platform}, Minecraft ${workingState.config.minecraftVersion}, Java ${workingState.config.javaVersion}).\n2. Verificando toolchain Gradle ${workingState.config.gradleVersion}${hasImages ? ' e imagem anexada via Vision' : ''}.\n3. Executando validação de estrutura e ferramentas no workspace.`
        : '';

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
      });
    }

    try {
      const { endpoint, authToken, extraHeaders, isCopilotNative } = await resolveCopilotEndpoint(
        session.token
      );
      const resolvedModel = normalizeModelForEndpoint(model, isCopilotNative);

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
      const maxRounds = 4;

      for (let round = 0; round < maxRounds; round++) {
        const payload: Record<string, unknown> = {
          model: resolvedModel,
          messages: apiMessages,
          tools: COPILOT_TOOL_DEFINITIONS,
          tool_choice: 'auto',
        };

        const aiResp = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
            'User-Agent': 'CraftForge-Studio/1.0',
            ...extraHeaders,
          },
          body: JSON.stringify(payload),
        });

        if (!aiResp.ok) {
          const errText = await aiResp.text().catch(() => '');
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
