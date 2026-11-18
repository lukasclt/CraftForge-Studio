import React, { useCallback, useEffect, useRef, useState } from 'react';
import JSZip from 'jszip';
import {
  Bot,
  Code2,
  Download,
  Files,
  FolderKanban,
  Loader2,
  LogOut,
  Plus,
  Rocket,
  Settings2,
  Users,
} from 'lucide-react';
import type {
  ChatMessage,
  ChatProject,
  Collaborator,
  GitHubActionsConfig,
  GitHubBuildRun,
  GitHubUser,
  ProjectConfig,
  ThinkingEffort,
  VisionAttachment,
} from './types/ide';
import { GitHubLoginScreen } from './components/GitHubLoginScreen';
import { FileExplorer } from './components/FileExplorer';
import { ProjectsSidebar } from './components/ProjectsSidebar';
import { GradleConfigSidebar } from './components/GradleConfigSidebar';
import { GitHubActionsSidebar } from './components/GitHubActionsSidebar';
import { CodeEditorPane } from './components/CodeEditorPane';
import { CopilotAgentChat } from './components/CopilotAgentChat';
import { NewProjectModal } from './components/NewProjectModal';
import { CollaboratorsModal } from './components/CollaboratorsModal';
import { createStarterProject } from './utils/defaultProjects';
import { loadProjectCookieMeta, saveProjectsToCookies } from './utils/cookieStorage';
import {
  apiFetch,
  clearClientSession,
  getStoredGitHubToken,
  storeClientSession,
} from './utils/sessionClient';
import {
  deletePathFromWorkspace,
  getParentFolder,
  normalizePath,
  renamePathInWorkspace,
} from './utils/fileTree';
import { generateGradleProjectFiles } from './utils/gradleEngine';
import {
  shouldTriggerAutoDownload,
  shouldTriggerAutoFix,
} from './utils/githubActionsEngine';

type LeftTab = 'files' | 'projects' | 'gradle' | 'actions';
type MobilePane = 'explorer' | 'editor' | 'chat';

export default function App() {
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  const [projects, setProjects] = useState<ChatProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string>('');
  const [draftContents, setDraftContents] = useState<Record<string, string>>({});
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  const [leftTab, setLeftTab] = useState<LeftTab>('files');
  const [mobilePane, setMobilePane] = useState<MobilePane>('editor');
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [collabOpen, setCollabOpen] = useState(false);

  // Agent state
  const [selectedModel, setSelectedModel] = useState('openai/gpt-4.1');
  const [thinkingEnabled, setThinkingEnabled] = useState(true);
  const [thinkingEffort, setThinkingEffort] = useState<ThinkingEffort>('medium');
  const [sendingChat, setSendingChat] = useState(false);

  // Realtime WebSocket state
  const [wsConnected, setWsConnected] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<GitHubUser[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  // GitHub Actions state
  const [buildRun, setBuildRun] = useState<GitHubBuildRun | null>(null);
  const [triggeringBuild, setTriggeringBuild] = useState(false);
  const [autoFixingBuild, setAutoFixingBuild] = useState(false);
  const [actionsError, setActionsError] = useState<string | null>(null);
  const consecutiveFixRetriesRef = useRef(0);
  const downloadedRunIdsRef = useRef<Set<number>>(new Set());
  const handledFailedRunIdsRef = useRef<Set<number>>(new Set());

  const urlParams =
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const inviteRoomId = urlParams?.get('room') || null;
  const autostart = urlParams?.get('autostart') === '1';

  // Hydrate auth on mount
  useEffect(() => {
    let active = true;
    const initAuth = async () => {
      try {
        const res = await apiFetch('/api/auth/me');
        if (res.ok) {
          const data = (await res.json()) as {
            authenticated?: boolean;
            user: GitHubUser | null;
            sessionId?: string;
          };
          if (data.authenticated && data.user) {
            storeClientSession(data.sessionId, null);
            if (active) setUser(data.user);
            return;
          }
        }
        // Fallback: if a real GitHub token is in sessionStorage (e.g. static proxy), validate directly
        const storedToken = getStoredGitHubToken();
        if (storedToken && storedToken !== 'sandbox-autostart-token') {
          const ghResp = await fetch('https://api.github.com/user', {
            headers: {
              Authorization: `Bearer ${storedToken}`,
              Accept: 'application/vnd.github+json',
            },
          });
          if (ghResp.ok) {
            const ghUser = (await ghResp.json()) as GitHubUser;
            if (active) setUser(ghUser);
            return;
          }
        }
        if (autostart) {
          const sbRes = await apiFetch('/api/auth/sandbox', { method: 'POST' });
          if (sbRes.ok) {
            const sbData = (await sbRes.json()) as { user: GitHubUser; sessionId?: string };
            storeClientSession(sbData.sessionId, 'sandbox-autostart-token');
            if (active) setUser(sbData.user);
          }
        }
      } catch {
        // remain unauthenticated
      } finally {
        if (active) setAuthChecked(true);
      }
    };
    initAuth();
    return () => {
      active = false;
    };
  }, [autostart]);

  // Hydrate projects from cookie-keyed backend + cookie metadata once authenticated
  useEffect(() => {
    if (!user) return;

    const loadInitial = async () => {
      const { activeProjectId: cookieActiveId } = loadProjectCookieMeta();
      let serverProjects: ChatProject[] = [];
      let serverActiveId: string | null = null;

      try {
        const projRes = await apiFetch('/api/projects');
        if (projRes.ok) {
          const projData = (await projRes.json()) as {
            projects?: ChatProject[];
            activeProjectId?: string | null;
          };
          serverProjects = projData.projects || [];
          serverActiveId = projData.activeProjectId || null;
        }
      } catch {
        // ignore fetch failure
      }

      if (inviteRoomId) {
        try {
          const roomRes = await apiFetch(`/api/rooms/${encodeURIComponent(inviteRoomId)}`);
          if (roomRes.ok) {
            const roomData = (await roomRes.json()) as { project?: ChatProject };
            if (roomData.project) {
              const merged = serverProjects.some((p) => p.id === roomData.project!.id)
                ? serverProjects.map((p) => (p.id === roomData.project!.id ? roomData.project! : p))
                : [roomData.project, ...serverProjects];
              setProjects(merged);
              setActiveProjectId(roomData.project.id);
              return;
            }
          }
        } catch {
          // fallback to user projects
        }
      }

      if (serverProjects.length > 0) {
        setProjects(serverProjects);
        const preferred = cookieActiveId || serverActiveId;
        const target =
          serverProjects.find((p) => p.id === preferred)?.id || serverProjects[0].id;
        setActiveProjectId(target);
      } else {
        const starter = createStarterProject(user);
        if (inviteRoomId) starter.roomId = inviteRoomId;
        setProjects([starter]);
        setActiveProjectId(starter.id);
      }
    };

    loadInitial();
  }, [user, inviteRoomId]);

  const activeProject = projects.find((p) => p.id === activeProjectId) || projects[0] || null;
  const activeProjectRef = useRef<ChatProject | null>(activeProject);
  activeProjectRef.current = activeProject;

  const getProjectActionsConfig = useCallback(
    (proj: ChatProject | null): GitHubActionsConfig => {
      if (proj?.githubActions) return proj.githubActions;
      return {
        repoFullName:
          user && !user.isSandbox && proj
            ? `${user.login}/${proj.config.artifactId}`
            : '',
        branch: 'main',
        autoBuildOnChange: true,
        autoFixErrors: true,
        autoDownloadJar: true,
      };
    },
    [user]
  );

  const activeActionsConfig = getProjectActionsConfig(activeProject);

  // Save compact metadata to cookies & full workspace/chat to session-cookie-keyed store
  useEffect(() => {
    if (!user || projects.length === 0 || !activeProjectId) return;
    saveProjectsToCookies(projects, activeProjectId);
    apiFetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projects, activeProjectId }),
    }).catch(() => {});
  }, [user, projects, activeProjectId]);

  // Sync room snapshot & WebSocket connection
  useEffect(() => {
    if (!user || !activeProject) return;

    apiFetch(`/api/rooms/${encodeURIComponent(activeProject.roomId)}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: activeProject }),
    }).catch(() => {});

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(
      `${proto}//${window.location.host}/ws?room=${encodeURIComponent(activeProject.roomId)}`
    );
    wsRef.current = ws;

    ws.onopen = () => {
      setWsConnected(true);
      ws.send(
        JSON.stringify({
          type: 'join',
          roomId: activeProject.roomId,
          token: getStoredGitHubToken() || undefined,
        })
      );
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as {
          type: string;
          onlineUsers?: GitHubUser[];
          projectSnapshot?: ChatProject | null;
          payload?: Record<string, unknown>;
        };

        if (msg.type === 'room:init') {
          if (msg.onlineUsers) setOnlineUsers(msg.onlineUsers);
          if (msg.projectSnapshot && msg.projectSnapshot.roomId === activeProject.roomId) {
            // Only hydrate if incoming snapshot is newer or local has fewer messages
            setProjects((prev) =>
              prev.map((p) => {
                if (p.roomId !== msg.projectSnapshot!.roomId) return p;
                if (msg.projectSnapshot!.updatedAt > p.updatedAt) {
                  return msg.projectSnapshot!;
                }
                return p;
              })
            );
          }
        } else if (msg.type === 'presence:update' && msg.onlineUsers) {
          setOnlineUsers(msg.onlineUsers);
        } else if (msg.type === 'file:save' && msg.payload) {
          const { path, content, updatedAt, updatedBy } = msg.payload as {
            path: string;
            content: string;
            updatedAt: number;
            updatedBy?: string;
          };
          setProjects((prev) =>
            prev.map((p) => {
              if (p.id !== activeProject.id) return p;
              return {
                ...p,
                updatedAt: updatedAt || Date.now(),
                files: {
                  ...p.files,
                  [path]: { path, content, updatedAt: updatedAt || Date.now(), updatedBy },
                },
              };
            })
          );
        } else if (msg.type === 'chat:message' && msg.payload) {
          const incomingMsg = msg.payload.message as ChatMessage;
          setProjects((prev) =>
            prev.map((p) => {
              if (p.id !== activeProject.id) return p;
              if (p.messages.some((m) => m.id === incomingMsg.id)) return p;
              return {
                ...p,
                updatedAt: Date.now(),
                messages: [...p.messages, incomingMsg],
              };
            })
          );
        } else if (msg.type === 'workspace:sync' && msg.payload) {
          const syncedProj = msg.payload.project as ChatProject;
          setProjects((prev) =>
            prev.map((p) => (p.roomId === syncedProj.roomId ? syncedProj : p))
          );
        } else if (msg.type === 'collaborator:invited' && msg.payload) {
          const collab = msg.payload.collaborator as Collaborator;
          setProjects((prev) =>
            prev.map((p) => {
              if (p.id !== activeProject.id) return p;
              if (p.collaborators.some((c) => c.login.toLowerCase() === collab.login.toLowerCase())) {
                return p;
              }
              return { ...p, collaborators: [...p.collaborators, collab] };
            })
          );
        }
      } catch {
        // ignore invalid frames
      }
    };

    ws.onclose = () => {
      setWsConnected(false);
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [user, activeProject?.id, activeProject?.roomId]);

  const updateActiveProject = useCallback(
    (updater: (proj: ChatProject) => ChatProject) => {
      setProjects((prev) =>
        prev.map((p) => (p.id === activeProjectId ? updater({ ...p, updatedAt: Date.now() }) : p))
      );
    },
    [activeProjectId]
  );

  // Dirty paths calculation
  const dirtyPaths = new Set<string>();
  if (activeProject) {
    for (const [path, draft] of Object.entries(draftContents)) {
      if (activeProject.files[path] && activeProject.files[path].content !== draft) {
        dirtyPaths.add(path);
      }
    }
  }

  const downloadArtifactFile = useCallback(async (downloadUrl: string, filename: string) => {
    try {
      const resp = await apiFetch(downloadUrl);
      if (!resp.ok) {
        const errData = (await resp.json().catch(() => ({}))) as { error?: string };
        setActionsError(errData.error || `Erro ao baixar artefato (${resp.status}).`);
        return;
      }
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch {
      setActionsError('Falha de rede ao baixar o arquivo .jar compilado.');
    }
  }, []);

  const triggerGitHubActionsBuild = useCallback(
    async (
      projOverride?: ChatProject,
      commitMessage?: string,
      autoFixAttempt = 0
    ): Promise<boolean> => {
      const targetProj = projOverride || activeProjectRef.current;
      if (!targetProj) return false;
      const actionsCfg = getProjectActionsConfig(targetProj);
      const repoFullName = actionsCfg.repoFullName.trim();
      if (!repoFullName) {
        setActionsError('Configure ou crie um repositório GitHub antes de iniciar o build.');
        return false;
      }

      setTriggeringBuild(true);
      setActionsError(null);
      try {
        const mergedFiles = { ...targetProj.files };
        if (targetProj.id === activeProjectRef.current?.id) {
          for (const [fPath, draft] of Object.entries(draftContents)) {
            if (mergedFiles[fPath]) {
              mergedFiles[fPath] = { ...mergedFiles[fPath], content: draft };
            }
          }
        }

        const resp = await apiFetch('/api/github/actions/trigger', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            repoFullName,
            branch: actionsCfg.branch || 'main',
            files: mergedFiles,
            config: targetProj.config,
            commitMessage:
              commitMessage ||
              `CraftForge Studio: build ${targetProj.config.name} (${targetProj.config.minecraftVersion})`,
            autoFixAttempt,
          }),
        });
        const data = (await resp.json().catch(() => ({}))) as {
          run?: GitHubBuildRun;
          error?: string;
        };
        if (!resp.ok || !data.run) {
          setActionsError(data.error || `Erro HTTP ${resp.status} ao iniciar build.`);
          return false;
        }
        setBuildRun(data.run);
        return true;
      } catch {
        setActionsError('Falha de conexão ao disparar workflow no GitHub Actions.');
        return false;
      } finally {
        setTriggeringBuild(false);
      }
    },
    [draftContents, getProjectActionsConfig]
  );

  const handleSaveFile = useCallback(
    (path: string) => {
      if (!activeProject) return;
      const contentToSave = draftContents[path] ?? activeProject.files[path]?.content;
      if (contentToSave === undefined) return;
      const now = Date.now();

      const updatedProj: ChatProject = {
        ...activeProject,
        updatedAt: now,
        files: {
          ...activeProject.files,
          [path]: {
            path,
            content: contentToSave,
            updatedAt: now,
            updatedBy: user?.login,
          },
        },
      };

      setProjects((prev) =>
        prev.map((p) => (p.id === activeProject.id ? updatedProj : p))
      );

      setDraftContents((prev) => {
        const next = { ...prev };
        delete next[path];
        return next;
      });
      setLastSavedAt(now);

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'file:save',
            payload: { path, content: contentToSave, updatedAt: now },
          })
        );
      }

      const actionsCfg = getProjectActionsConfig(updatedProj);
      if (actionsCfg.autoBuildOnChange && actionsCfg.repoFullName.trim()) {
        consecutiveFixRetriesRef.current = 0;
        void triggerGitHubActionsBuild(
          updatedProj,
          `CraftForge Studio: salvar ${path}`,
          0
        );
      }
    },
    [
      activeProject,
      draftContents,
      getProjectActionsConfig,
      triggerGitHubActionsBuild,
      user?.login,
    ]
  );

  // Global CTRL + S / CMD + S handler
  useEffect(() => {
    const onGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (activeProject?.activeFile) {
          handleSaveFile(activeProject.activeFile);
        }
      }
    };
    window.addEventListener('keydown', onGlobalKeyDown);
    return () => window.removeEventListener('keydown', onGlobalKeyDown);
  }, [activeProject?.activeFile, handleSaveFile]);

  const handleSelectFile = (path: string) => {
    updateActiveProject((proj) => ({
      ...proj,
      activeFile: path,
      openTabs: proj.openTabs.includes(path) ? proj.openTabs : [...proj.openTabs, path],
    }));
    setMobilePane('editor');
  };

  const handleCloseTab = (path: string) => {
    updateActiveProject((proj) => {
      const nextTabs = proj.openTabs.filter((t) => t !== path);
      const nextActive =
        proj.activeFile === path ? nextTabs[nextTabs.length - 1] || null : proj.activeFile;
      return { ...proj, openTabs: nextTabs, activeFile: nextActive };
    });
  };

  const handleCreateFile = (rawPath: string) => {
    const norm = normalizePath(rawPath);
    if (!norm || !activeProject) return;
    const now = Date.now();
    const parent = getParentFolder(norm);
    const extraFolders: string[] = [];
    if (parent) {
      const parts = parent.split('/');
      for (let i = 1; i <= parts.length; i++) {
        extraFolders.push(parts.slice(0, i).join('/'));
      }
    }

    const defaultBody = norm.endsWith('.java')
      ? `package ${activeProject.config.groupId};\n\npublic class ${norm.split('/').pop()?.replace('.java', '') || 'NewClass'} {\n\n}\n`
      : '';

    const updatedProj: ChatProject = {
      ...activeProject,
      updatedAt: now,
      folders: Array.from(new Set([...activeProject.folders, ...extraFolders])).sort(),
      files: {
        ...activeProject.files,
        [norm]: { path: norm, content: defaultBody, updatedAt: now, updatedBy: user?.login },
      },
      openTabs: activeProject.openTabs.includes(norm)
        ? activeProject.openTabs
        : [...activeProject.openTabs, norm],
      activeFile: norm,
    };

    setProjects((prev) => prev.map((p) => (p.id === activeProject.id ? updatedProj : p)));
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({ type: 'workspace:sync', payload: { project: updatedProj } })
      );
    }
  };

  const handleCreateFolder = (rawPath: string) => {
    const norm = normalizePath(rawPath);
    if (!norm || !activeProject) return;
    const parts = norm.split('/');
    const extraFolders: string[] = [];
    for (let i = 1; i <= parts.length; i++) {
      extraFolders.push(parts.slice(0, i).join('/'));
    }
    updateActiveProject((proj) => ({
      ...proj,
      folders: Array.from(new Set([...proj.folders, ...extraFolders])).sort(),
    }));
  };

  const handleRenamePath = (oldPath: string, newPath: string) => {
    if (!activeProject) return;
    const renamed = renamePathInWorkspace(
      activeProject.files,
      activeProject.folders,
      oldPath,
      newPath
    );
    const updatedProj: ChatProject = {
      ...activeProject,
      updatedAt: Date.now(),
      files: renamed.files,
      folders: renamed.folders,
      openTabs: activeProject.openTabs.map((t) =>
        t === oldPath ? newPath : t.startsWith(`${oldPath}/`) ? `${newPath}${t.slice(oldPath.length)}` : t
      ),
      activeFile:
        activeProject.activeFile === oldPath
          ? newPath
          : activeProject.activeFile?.startsWith(`${oldPath}/`)
            ? `${newPath}${activeProject.activeFile.slice(oldPath.length)}`
            : activeProject.activeFile,
    };
    setProjects((prev) => prev.map((p) => (p.id === activeProject.id ? updatedProj : p)));
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({ type: 'workspace:sync', payload: { project: updatedProj } })
      );
    }
  };

  const handleDeletePath = (targetPath: string) => {
    if (!activeProject) return;
    const deleted = deletePathFromWorkspace(activeProject.files, activeProject.folders, targetPath);
    const nextTabs = activeProject.openTabs.filter(
      (t) => t !== targetPath && !t.startsWith(`${targetPath}/`)
    );
    const nextActive =
      activeProject.activeFile &&
      (activeProject.activeFile === targetPath ||
        activeProject.activeFile.startsWith(`${targetPath}/`))
        ? nextTabs[nextTabs.length - 1] || null
        : activeProject.activeFile;

    const updatedProj: ChatProject = {
      ...activeProject,
      updatedAt: Date.now(),
      files: deleted.files,
      folders: deleted.folders,
      openTabs: nextTabs,
      activeFile: nextActive,
    };
    setProjects((prev) => prev.map((p) => (p.id === activeProject.id ? updatedProj : p)));
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({ type: 'workspace:sync', payload: { project: updatedProj } })
      );
    }
  };

  const handleApplyGradleConfig = (nextConfig: ProjectConfig, regenerateAll: boolean) => {
    if (!activeProject) return;
    const generated = generateGradleProjectFiles(nextConfig);
    const nextFiles = regenerateAll
      ? generated.files
      : {
          ...activeProject.files,
          ...(generated.files['build.gradle'] ? { 'build.gradle': generated.files['build.gradle'] } : {}),
          ...(generated.files['build.gradle.kts']
            ? { 'build.gradle.kts': generated.files['build.gradle.kts'] }
            : {}),
          'gradle.properties': generated.files['gradle.properties'],
          'gradle/wrapper/gradle-wrapper.properties':
            generated.files['gradle/wrapper/gradle-wrapper.properties'],
          ...(generated.files['.github/workflows/gradle-build.yml']
            ? {
                '.github/workflows/gradle-build.yml':
                  generated.files['.github/workflows/gradle-build.yml'],
              }
            : {}),
        };

    const buildFile = nextConfig.dsl === 'kotlin' ? 'build.gradle.kts' : 'build.gradle';
    const nextOpenTabs = regenerateAll
      ? [buildFile, Object.keys(nextFiles).find((f) => f.endsWith('.java')) || buildFile].filter(
          (v, i, arr) => arr.indexOf(v) === i && nextFiles[v]
        )
      : activeProject.openTabs;

    const updatedProj: ChatProject = {
      ...activeProject,
      config: nextConfig,
      files: nextFiles,
      folders: regenerateAll
        ? generated.folders
        : Array.from(new Set([...activeProject.folders, ...generated.folders])).sort(),
      openTabs: nextOpenTabs,
      activeFile: nextOpenTabs[0] || buildFile,
      updatedAt: Date.now(),
    };
    setDraftContents({});
    setProjects((prev) => prev.map((p) => (p.id === activeProject.id ? updatedProj : p)));
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({ type: 'workspace:sync', payload: { project: updatedProj } })
      );
    }
  };

  const handleCreateNewProject = (config: ProjectConfig) => {
    const created = createStarterProject(user, config);
    setProjects((prev) => [created, ...prev]);
    setActiveProjectId(created.id);
    setDraftContents({});
    setBuildRun(null);
    setActionsError(null);
    consecutiveFixRetriesRef.current = 0;
    setLeftTab('files');
  };

  const handleDeleteProject = (id: string) => {
    setProjects((prev) => {
      const remaining = prev.filter((p) => p.id !== id);
      if (remaining.length > 0 && activeProjectId === id) {
        setActiveProjectId(remaining[0].id);
        setBuildRun(null);
        setActionsError(null);
      }
      return remaining;
    });
  };

  const handleUpdateActionsConfig = useCallback(
    (nextCfg: GitHubActionsConfig) => {
      setActionsError(null);
      updateActiveProject((proj) => ({
        ...proj,
        githubActions: nextCfg,
      }));
    },
    [updateActiveProject]
  );

  const handleCreateGitHubRepo = useCallback(
    async (
      name: string,
      isPrivate: boolean
    ): Promise<{ ok: boolean; error?: string }> => {
      if (!activeProject) return { ok: false, error: 'Nenhum projeto ativo.' };
      try {
        const resp = await apiFetch('/api/github/actions/create-repo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            isPrivate,
            description: `${activeProject.config.name} (${activeProject.config.platform} ${activeProject.config.minecraftVersion})`,
          }),
        });
        const data = (await resp.json().catch(() => ({}))) as {
          repoFullName?: string;
          defaultBranch?: string;
          error?: string;
        };
        if (!resp.ok || !data.repoFullName) {
          return { ok: false, error: data.error || 'Erro ao criar repositório.' };
        }
        const currentCfg = getProjectActionsConfig(activeProject);
        updateActiveProject((proj) => ({
          ...proj,
          githubActions: {
            ...currentCfg,
            repoFullName: data.repoFullName!,
            branch: data.defaultBranch || currentCfg.branch || 'main',
          },
        }));
        setActionsError(null);
        return { ok: true };
      } catch {
        return { ok: false, error: 'Falha de conexão ao criar repositório no GitHub.' };
      }
    },
    [activeProject, getProjectActionsConfig, updateActiveProject]
  );

  const handleSendAgentMessage = useCallback(
    async (
      prompt: string,
      images: VisionAttachment[],
      options?: { skipAutoBuild?: boolean; targetProject?: ChatProject }
    ): Promise<{ nextProj: ChatProject | null; modifiedFiles: boolean }> => {
      const targetProj = options?.targetProject || activeProjectRef.current;
      if (!targetProj || !user) return { nextProj: null, modifiedFiles: false };

      const now = Date.now();
      const userMsg: ChatMessage = {
        id: `msg_${now}_u`,
        role: 'user',
        content: prompt || 'Analise a imagem anexada.',
        images: images.length > 0 ? images : undefined,
        authorLogin: user.login,
        authorAvatar: user.avatar_url,
        createdAt: now,
      };

      const nextMessages = [...targetProj.messages, userMsg];
      setProjects((prev) =>
        prev.map((proj) =>
          proj.id === targetProj.id
            ? { ...proj, messages: nextMessages, updatedAt: now }
            : proj
        )
      );

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({ type: 'chat:message', payload: { message: userMsg } })
        );
      }

      setSendingChat(true);
      try {
        const resp = await apiFetch('/api/copilot/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: selectedModel,
            thinkingEnabled,
            thinkingEffort,
            messages: nextMessages,
            images,
            projectContext: {
              config: targetProj.config,
              files: targetProj.files,
              folders: targetProj.folders,
            },
          }),
        });

        const data = (await resp.json()) as {
          message?: ChatMessage;
          updatedWorkspace?: {
            config: ProjectConfig;
            files: ChatProject['files'];
            folders: string[];
          };
          error?: string;
        };

        if (!resp.ok || !data.message) {
          const errMsg: ChatMessage = {
            id: `msg_${Date.now()}_err`,
            role: 'assistant',
            content: data.error || 'Erro ao consultar GitHub Copilot.',
            isError: true,
            model: selectedModel,
            createdAt: Date.now(),
          };
          setProjects((prev) =>
            prev.map((proj) =>
              proj.id === targetProj.id
                ? { ...proj, messages: [...proj.messages, errMsg], updatedAt: Date.now() }
                : proj
            )
          );
          return { nextProj: null, modifiedFiles: false };
        }

        const aiMsg = data.message;
        const updatedWs = data.updatedWorkspace;
        const modifiedFiles = Boolean(
          updatedWs &&
            (aiMsg.toolCalls?.some(
              (tc) =>
                tc.status === 'ok' &&
                ['write_file', 'delete_path', 'configure_gradle_project'].includes(tc.name)
            ) ||
              JSON.stringify(updatedWs.files) !== JSON.stringify(targetProj.files))
        );

        const nextProj: ChatProject = {
          ...targetProj,
          config: updatedWs ? updatedWs.config : targetProj.config,
          files: updatedWs ? updatedWs.files : targetProj.files,
          folders: updatedWs ? updatedWs.folders : targetProj.folders,
          messages: [...nextMessages, aiMsg],
          updatedAt: Date.now(),
        };

        setProjects((prev) =>
          prev.map((proj) => {
            if (proj.id !== targetProj.id) return proj;
            const mergedProj: ChatProject = {
              ...proj,
              config: updatedWs ? updatedWs.config : proj.config,
              files: updatedWs ? updatedWs.files : proj.files,
              folders: updatedWs ? updatedWs.folders : proj.folders,
              messages: [...proj.messages, aiMsg],
              updatedAt: Date.now(),
            };
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(
                JSON.stringify({ type: 'workspace:sync', payload: { project: mergedProj } })
              );
            }
            return mergedProj;
          })
        );

        if (!options?.skipAutoBuild && modifiedFiles) {
          const actionsCfg = getProjectActionsConfig(nextProj);
          if (actionsCfg.autoBuildOnChange && actionsCfg.repoFullName.trim()) {
            consecutiveFixRetriesRef.current = 0;
            void triggerGitHubActionsBuild(
              nextProj,
              'CraftForge Copilot AI: alteração automática de código',
              0
            );
          }
        }

        return { nextProj, modifiedFiles };
      } catch {
        const errMsg: ChatMessage = {
          id: `msg_${Date.now()}_neterr`,
          role: 'assistant',
          content: 'Falha de rede ao enviar prompt para o Agente Copilot.',
          isError: true,
          model: selectedModel,
          createdAt: Date.now(),
        };
        setProjects((prev) =>
          prev.map((proj) =>
            proj.id === targetProj.id
              ? { ...proj, messages: [...proj.messages, errMsg], updatedAt: Date.now() }
              : proj
          )
        );
        return { nextProj: null, modifiedFiles: false };
      } finally {
        setSendingChat(false);
      }
    },
    [
      getProjectActionsConfig,
      selectedModel,
      thinkingEffort,
      thinkingEnabled,
      triggerGitHubActionsBuild,
      user,
    ]
  );

  const handleFixBuildLogsInChat = useCallback(
    async (logs: string, targetProj?: ChatProject, retryNumber?: number) => {
      const proj = targetProj || activeProjectRef.current;
      if (!proj) return;
      const attemptNum = retryNumber ?? Math.max(1, consecutiveFixRetriesRef.current);
      setAutoFixingBuild(true);
      try {
        const prompt = `O build no GitHub Actions falhou com os logs abaixo. Corrija os arquivos necessários usando as tools para compilar corretamente:\n\n\`\`\`\n${logs}\n\`\`\``;
        const result = await handleSendAgentMessage(prompt, [], {
          skipAutoBuild: true,
          targetProject: proj,
        });
        const updatedProj = result.nextProj || activeProjectRef.current || proj;
        const actionsCfg = getProjectActionsConfig(updatedProj);
        if (actionsCfg.repoFullName.trim()) {
          await triggerGitHubActionsBuild(
            updatedProj,
            `CraftForge Copilot AI: correção automática #${attemptNum}`,
            attemptNum
          );
        }
      } finally {
        setAutoFixingBuild(false);
      }
    },
    [getProjectActionsConfig, handleSendAgentMessage, triggerGitHubActionsBuild]
  );

  // Poll GitHub Actions run status, auto-fix failures in chat, and auto-download JAR on success
  useEffect(() => {
    if (!user || !activeProject || !buildRun) return;
    if (buildRun.status !== 'queued' && buildRun.status !== 'in_progress') return;

    const actionsCfg = getProjectActionsConfig(activeProject);
    if (!actionsCfg.repoFullName.trim()) return;

    const intervalMs = user.isSandbox ? 800 : 4000;
    const timer = window.setInterval(async () => {
      try {
        const params = new URLSearchParams({
          repo: actionsCfg.repoFullName.trim(),
          commitSha: buildRun.commitSha || '',
          runId: String(buildRun.id || 0),
        });
        const resp = await apiFetch(`/api/github/actions/status?${params.toString()}`);
        if (!resp.ok) return;
        const data = (await resp.json()) as { run?: GitHubBuildRun | null };
        if (!data.run) return;

        const nextRun = data.run;
        setBuildRun(nextRun);

        if (shouldTriggerAutoDownload(nextRun, actionsCfg.autoDownloadJar, downloadedRunIdsRef.current)) {
          downloadedRunIdsRef.current.add(nextRun.id);
          consecutiveFixRetriesRef.current = 0;
          const art = nextRun.artifacts![0];
          const jarName = `${activeProject.config.artifactId}-${activeProject.config.version}.jar`;
          void downloadArtifactFile(art.downloadUrl, jarName);
        } else if (
          shouldTriggerAutoFix(nextRun, actionsCfg.autoFixErrors, consecutiveFixRetriesRef.current) &&
          !handledFailedRunIdsRef.current.has(nextRun.id)
        ) {
          handledFailedRunIdsRef.current.add(nextRun.id);
          consecutiveFixRetriesRef.current += 1;
          const retryCount = consecutiveFixRetriesRef.current;
          void handleFixBuildLogsInChat(
            nextRun.logsExcerpt || 'Falha de compilação Gradle no GitHub Actions.',
            activeProject,
            retryCount
          );
        }
      } catch {
        // ignore transient poll error
      }
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [
    activeProject,
    buildRun,
    downloadArtifactFile,
    getProjectActionsConfig,
    handleFixBuildLogsInChat,
    user,
  ]);

  const handleInviteCollaborator = async (
    username: string
  ): Promise<{ ok: boolean; error?: string }> => {
    if (!activeProject) return { ok: false, error: 'Nenhum projeto ativo.' };
    try {
      const resp = await apiFetch(`/api/github/user/${encodeURIComponent(username)}`);
      const data = (await resp.json()) as { user?: GitHubUser; error?: string };
      if (!resp.ok || !data.user) {
        return { ok: false, error: data.error || 'Usuário não encontrado.' };
      }

      const collab: Collaborator = {
        login: data.user.login,
        name: data.user.name,
        avatar_url: data.user.avatar_url,
        role: 'collaborator',
        addedAt: Date.now(),
      };

      updateActiveProject((proj) => {
        if (proj.collaborators.some((c) => c.login.toLowerCase() === collab.login.toLowerCase())) {
          return proj;
        }
        return { ...proj, collaborators: [...proj.collaborators, collab] };
      });

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({ type: 'collaborator:invited', payload: { collaborator: collab } })
        );
      }
      return { ok: true };
    } catch {
      return { ok: false, error: 'Erro ao consultar GitHub API.' };
    }
  };

  const handleJoinRoomByCode = async (targetRoomId: string) => {
    try {
      const resp = await apiFetch(`/api/rooms/${encodeURIComponent(targetRoomId)}`);
      if (resp.ok) {
        const data = (await resp.json()) as { project?: ChatProject };
        if (data.project) {
          setProjects((prev) => {
            const exists = prev.some((p) => p.id === data.project!.id);
            return exists
              ? prev.map((p) => (p.id === data.project!.id ? data.project! : p))
              : [data.project!, ...prev];
          });
          setActiveProjectId(data.project.id);
          return;
        }
      }
      // Fallback: attach roomId to a new joined project shell
      const joined = createStarterProject(user, { name: `Sala ${targetRoomId}` });
      joined.roomId = targetRoomId;
      setProjects((prev) => [joined, ...prev]);
      setActiveProjectId(joined.id);
    } catch {
      // ignore
    }
  };

  const handleExportZip = async () => {
    if (!activeProject) return;
    const zip = new JSZip();
    for (const [filePath, file] of Object.entries(activeProject.files)) {
      const content = draftContents[filePath] ?? file.content;
      zip.file(filePath, content, {
        unixPermissions: filePath === 'gradlew' ? '755' : undefined,
      });
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeProject.config.artifactId}-${activeProject.config.minecraftVersion}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleLogout = async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    clearClientSession();
    setUser(null);
    setProjects([]);
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-[#0B0F17] flex items-center justify-center text-sm text-slate-400">
        Verificando sessão GitHub Token...
      </div>
    );
  }

  if (!user) {
    return <GitHubLoginScreen onAuthenticated={setUser} inviteRoomId={inviteRoomId} />;
  }

  if (!activeProject) {
    return (
      <div className="min-h-screen bg-[#0B0F17] flex items-center justify-center text-sm text-slate-400">
        Carregando workspace Gradle...
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-[#0B0F17] text-slate-100 overflow-hidden">
      {/* Top Bar (3-zone contract) */}
      <header className="h-12 px-3 sm:px-4 border-b border-slate-800 bg-[#111827] flex items-center justify-between gap-2 sm:gap-4 shrink-0">
        {/* Zone 1: Brand + Active Project Context */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <span className="text-sm font-bold tracking-tight text-white truncate whitespace-nowrap">
            CraftForge Studio
          </span>
          <span className="text-slate-600 hidden sm:inline" aria-hidden="true">
            /
          </span>
          <span className="text-xs font-medium text-slate-200 truncate hidden sm:inline">
            {activeProject.config.name}
          </span>
          <span className="text-xs font-mono text-slate-400 hidden md:inline whitespace-nowrap">
            · MC {activeProject.config.minecraftVersion} · Java {activeProject.config.javaVersion} ·
            Gradle {activeProject.config.gradleVersion}
          </span>
        </div>

        {/* Zone 2: Primary Workspace Actions */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              setLeftTab('actions');
              setMobilePane('explorer');
            }}
            aria-label="Abrir Build no GitHub Actions"
            className={`px-2 sm:px-2.5 py-1.5 rounded text-xs font-medium flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
              leftTab === 'actions'
                ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/40'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
            }`}
          >
            {triggeringBuild ||
            autoFixingBuild ||
            buildRun?.status === 'queued' ||
            buildRun?.status === 'in_progress' ? (
              <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" />
            ) : (
              <Rocket className="w-3.5 h-3.5 text-emerald-400" />
            )}
            <span className="hidden md:inline">
              {autoFixingBuild
                ? 'Corrigindo Logs...'
                : triggeringBuild ||
                    buildRun?.status === 'queued' ||
                    buildRun?.status === 'in_progress'
                  ? 'Buildando...'
                  : 'GitHub Actions'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setNewProjectOpen(true)}
            aria-label="Novo Projeto"
            className="px-2 sm:px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs font-medium flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline">Novo Projeto</span>
          </button>

          <button
            type="button"
            onClick={handleExportZip}
            aria-label="Exportar .zip"
            className="px-2 sm:px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs font-medium flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden md:inline">Exportar .zip</span>
          </button>

          <button
            type="button"
            onClick={() => setCollabOpen(true)}
            aria-label={`Colaboradores (${Math.max(1, onlineUsers.length)})`}
            className="px-2 sm:px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Users className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Colaboradores</span>
            <span className="tabular-nums">({Math.max(1, onlineUsers.length)})</span>
          </button>
        </div>

        {/* Zone 3: GitHub Account */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="flex items-center gap-2">
            {user.avatar_url ? (
              <img
                src={user.avatar_url}
                alt={user.login}
                referrerPolicy="no-referrer"
                className="w-6 h-6 rounded-full border border-slate-700 shrink-0"
              />
            ) : (
              <div className="w-6 h-6 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-[10px] font-mono text-emerald-400 shrink-0">
                {user.login.slice(0, 2).toUpperCase()}
              </div>
            )}
            <span className="text-xs font-mono text-slate-300 hidden sm:inline whitespace-nowrap">
              @{user.login}
            </span>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            aria-label="Sair da conta GitHub"
            title="Sair"
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* Mobile Pane Switcher (< lg) */}
      <div className="lg:hidden flex items-center border-b border-slate-800 bg-[#111827] px-2 py-1.5 gap-1 shrink-0">
        <button
          type="button"
          onClick={() => setMobilePane('explorer')}
          className={`flex-1 py-1.5 rounded text-xs font-medium flex items-center justify-center gap-1.5 ${
            mobilePane === 'explorer' ? 'bg-emerald-600 text-white' : 'text-slate-400'
          }`}
        >
          <Files className="w-3.5 h-3.5" />
          <span>Arquivos</span>
        </button>
        <button
          type="button"
          onClick={() => setMobilePane('editor')}
          className={`flex-1 py-1.5 rounded text-xs font-medium flex items-center justify-center gap-1.5 ${
            mobilePane === 'editor' ? 'bg-emerald-600 text-white' : 'text-slate-400'
          }`}
        >
          <Code2 className="w-3.5 h-3.5" />
          <span>Editor</span>
        </button>
        <button
          type="button"
          onClick={() => setMobilePane('chat')}
          className={`flex-1 py-1.5 rounded text-xs font-medium flex items-center justify-center gap-1.5 ${
            mobilePane === 'chat' ? 'bg-emerald-600 text-white' : 'text-slate-400'
          }`}
        >
          <Bot className="w-3.5 h-3.5" />
          <span>Copilot</span>
        </button>
      </div>

      {/* Main 3-Pane IDE Body */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Left Sidebar (Activity Strip + Explorer / Projects / Gradle) */}
        <aside
          className={`${
            mobilePane === 'explorer' ? 'flex w-full' : 'hidden'
          } lg:flex lg:w-[296px] border-r border-slate-800 bg-[#111827] shrink-0`}
        >
          {/* VS Code Activity Rail */}
          <nav
            aria-label="Navegação lateral da IDE"
            className="w-11 border-r border-slate-800 bg-[#0B0F17] flex flex-col items-center py-2 gap-2 shrink-0"
          >
            <button
              type="button"
              onClick={() => setLeftTab('files')}
              aria-label="Explorador de Arquivos"
              title="Explorador de Arquivos"
              className={`p-2 rounded-md transition-colors cursor-pointer ${
                leftTab === 'files'
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Files className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setLeftTab('projects')}
              aria-label="Projetos e Chats (Cookies)"
              title="Projetos e Chats (Cookies)"
              className={`p-2 rounded-md transition-colors cursor-pointer ${
                leftTab === 'projects'
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <FolderKanban className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setLeftTab('gradle')}
              aria-label="Configuração Gradle e Versões"
              title="Configuração Gradle e Versões"
              className={`p-2 rounded-md transition-colors cursor-pointer ${
                leftTab === 'gradle'
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Settings2 className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setLeftTab('actions')}
              aria-label="Build no GitHub Actions"
              title="Build no GitHub Actions"
              className={`relative p-2 rounded-md transition-colors cursor-pointer ${
                leftTab === 'actions'
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Rocket className="w-4 h-4" />
              {buildRun && (
                <span
                  aria-hidden="true"
                  className={`absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full ${
                    buildRun.status !== 'completed'
                      ? 'bg-amber-400 animate-pulse'
                      : buildRun.conclusion === 'success'
                        ? 'bg-emerald-400'
                        : 'bg-red-400'
                  }`}
                />
              )}
            </button>
          </nav>

          {/* Active Sidebar View */}
          <div className="flex-1 min-w-0 h-full overflow-hidden">
            {leftTab === 'files' && (
              <FileExplorer
                files={activeProject.files}
                folders={activeProject.folders}
                activeFile={activeProject.activeFile}
                dirtyPaths={dirtyPaths}
                onSelectFile={handleSelectFile}
                onCreateFile={handleCreateFile}
                onCreateFolder={handleCreateFolder}
                onRenamePath={handleRenamePath}
                onDeletePath={handleDeletePath}
              />
            )}
            {leftTab === 'projects' && (
              <ProjectsSidebar
                projects={projects}
                activeProjectId={activeProject.id}
                onSelectProject={(id) => {
                  setActiveProjectId(id);
                  setDraftContents({});
                  setBuildRun(null);
                  setActionsError(null);
                  consecutiveFixRetriesRef.current = 0;
                }}
                onOpenNewProject={() => setNewProjectOpen(true)}
                onDeleteProject={handleDeleteProject}
              />
            )}
            {leftTab === 'gradle' && (
              <GradleConfigSidebar
                config={activeProject.config}
                files={activeProject.files}
                onApplyConfig={handleApplyGradleConfig}
              />
            )}
            {leftTab === 'actions' && (
              <GitHubActionsSidebar
                projectConfig={activeProject.config}
                actionsConfig={activeActionsConfig}
                buildRun={buildRun}
                triggering={triggeringBuild}
                autoFixing={autoFixingBuild}
                error={actionsError}
                onUpdateConfig={handleUpdateActionsConfig}
                onCreateRepo={handleCreateGitHubRepo}
                onTriggerBuild={() => {
                  consecutiveFixRetriesRef.current = 0;
                  void triggerGitHubActionsBuild(activeProject, undefined, 0);
                }}
                onFixLogsInChat={(logs) => {
                  consecutiveFixRetriesRef.current += 1;
                  void handleFixBuildLogsInChat(
                    logs,
                    activeProject,
                    consecutiveFixRetriesRef.current
                  );
                }}
                onDownloadArtifact={(url, filename) => void downloadArtifactFile(url, filename)}
              />
            )}
          </div>
        </aside>

        {/* Center Code Editor */}
        <main
          className={`${
            mobilePane === 'editor' ? 'flex' : 'hidden'
          } lg:flex flex-1 min-w-0 flex-col overflow-hidden`}
        >
          <CodeEditorPane
            config={activeProject.config}
            files={activeProject.files}
            openTabs={activeProject.openTabs}
            activeFile={activeProject.activeFile}
            draftContents={draftContents}
            dirtyPaths={dirtyPaths}
            lastSavedAt={lastSavedAt}
            onSelectTab={handleSelectFile}
            onCloseTab={handleCloseTab}
            onChangeContent={(path, content) =>
              setDraftContents((prev) => ({ ...prev, [path]: content }))
            }
            onSaveFile={handleSaveFile}
          />
        </main>

        {/* Right Agent Copilot Chat */}
        <div
          className={`${
            mobilePane === 'chat' ? 'flex w-full' : 'hidden'
          } lg:flex lg:w-[390px] xl:w-[420px] shrink-0 overflow-hidden`}
        >
          <div className="w-full h-full">
            <CopilotAgentChat
              messages={activeProject.messages}
              sending={sendingChat}
              selectedModel={selectedModel}
              thinkingEnabled={thinkingEnabled}
              thinkingEffort={thinkingEffort}
              onChangeModel={setSelectedModel}
              onToggleThinking={() => setThinkingEnabled((t) => !t)}
              onChangeEffort={setThinkingEffort}
              onSendMessage={handleSendAgentMessage}
              onOpenFileFromTool={handleSelectFile}
            />
          </div>
        </div>
      </div>

      {/* Modals */}
      <NewProjectModal
        open={newProjectOpen}
        onClose={() => setNewProjectOpen(false)}
        onCreate={handleCreateNewProject}
      />

      <CollaboratorsModal
        open={collabOpen}
        roomId={activeProject.roomId}
        wsConnected={wsConnected}
        collaborators={activeProject.collaborators}
        onlineUsers={onlineUsers}
        onClose={() => setCollabOpen(false)}
        onInviteUser={handleInviteCollaborator}
        onJoinRoom={handleJoinRoomByCode}
      />
    </div>
  );
}
