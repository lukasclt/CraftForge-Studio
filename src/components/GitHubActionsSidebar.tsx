import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  FolderGit2,
  Loader2,
  Play,
  Plus,
  Terminal,
  Wrench,
} from 'lucide-react';
import type { GitHubActionsConfig, GitHubBuildRun, ProjectConfig } from '../types/ide';

interface GitHubActionsSidebarProps {
  projectConfig: ProjectConfig;
  actionsConfig: GitHubActionsConfig;
  buildRun: GitHubBuildRun | null;
  triggering: boolean;
  autoFixing: boolean;
  error: string | null;
  onUpdateConfig: (next: GitHubActionsConfig) => void;
  onCreateRepo: (name: string, isPrivate: boolean) => Promise<{ ok: boolean; error?: string }>;
  onTriggerBuild: () => void;
  onFixLogsInChat: (logs: string) => void;
  onDownloadArtifact: (downloadUrl: string, filename: string) => void;
}

export const GitHubActionsSidebar: React.FC<GitHubActionsSidebarProps> = ({
  projectConfig,
  actionsConfig,
  buildRun,
  triggering,
  autoFixing,
  error,
  onUpdateConfig,
  onCreateRepo,
  onTriggerBuild,
  onFixLogsInChat,
  onDownloadArtifact,
}) => {
  const [newRepoName, setNewRepoName] = useState(projectConfig.artifactId || 'minecraft-plugin');
  const [isPrivate, setIsPrivate] = useState(true);
  const [creatingRepo, setCreatingRepo] = useState(false);
  const [repoError, setRepoError] = useState<string | null>(null);
  const liveLogsRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (liveLogsRef.current) {
      liveLogsRef.current.scrollTop = liveLogsRef.current.scrollHeight;
    }
  }, [buildRun?.liveLogs]);

  const handleCreateRepo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRepoName.trim()) {
      setRepoError('Informe um nome para o repositório.');
      return;
    }
    setCreatingRepo(true);
    setRepoError(null);
    const res = await onCreateRepo(newRepoName.trim(), isPrivate);
    setCreatingRepo(false);
    if (!res.ok) {
      setRepoError(res.error || 'Erro ao criar repositório.');
    }
  };

  const isRunning =
    triggering ||
    autoFixing ||
    buildRun?.status === 'queued' ||
    buildRun?.status === 'in_progress';

  return (
    <div className="flex flex-col h-full overflow-y-auto p-3 space-y-4">
      <div>
        <h2 className="text-xs font-semibold text-slate-200 mb-1">Build no GitHub Actions</h2>
        <p className="text-[11px] text-slate-400">
          Compila o projeto Gradle na nuvem com logs ao vivo (1s/loop), corrige erros no chat e baixa o{' '}
          <code className="font-mono text-slate-300">.jar</code> automaticamente.
        </p>
      </div>

      {/* Repo Config */}
      <div className="space-y-2.5">
        <div>
          <label htmlFor="gha-repo" className="block text-[11px] font-medium text-slate-300 mb-1">
            Repositório GitHub (usuario/repo)
          </label>
          <input
            id="gha-repo"
            type="text"
            value={actionsConfig.repoFullName}
            onChange={(e) =>
              onUpdateConfig({ ...actionsConfig, repoFullName: e.target.value })
            }
            placeholder="seu-usuario/meu-plugin-mc"
            className="w-full bg-[#0B0F17] border border-slate-700 focus:border-emerald-500 rounded-md px-2.5 py-1.5 text-xs font-mono text-slate-100 focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="gha-branch" className="block text-[11px] font-medium text-slate-300 mb-1">
            Branch
          </label>
          <input
            id="gha-branch"
            type="text"
            value={actionsConfig.branch}
            onChange={(e) => onUpdateConfig({ ...actionsConfig, branch: e.target.value })}
            placeholder="main"
            className="w-full bg-[#0B0F17] border border-slate-700 focus:border-emerald-500 rounded-md px-2.5 py-1.5 text-xs font-mono text-slate-100 focus:outline-none"
          />
        </div>

        {/* Create new repo inline */}
        <form
          onSubmit={handleCreateRepo}
          className="p-2.5 rounded-md bg-[#0B0F17] border border-slate-800 space-y-2"
        >
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-300">
            <FolderGit2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>Criar novo repositório no GitHub</span>
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={newRepoName}
              onChange={(e) => setNewRepoName(e.target.value)}
              aria-label="Nome do novo repositório GitHub"
              className="flex-1 min-w-0 bg-[#111827] border border-slate-800 rounded px-2 py-1 text-[11px] font-mono text-slate-200 focus:border-emerald-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={creatingRepo}
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-100 text-[11px] font-medium rounded flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Plus className="w-3 h-3 text-emerald-400" />
              <span>{creatingRepo ? 'Criando...' : 'Criar'}</span>
            </button>
          </div>
          <label className="flex items-center gap-2 text-[11px] text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
              className="accent-emerald-500"
            />
            <span>Repositório privado</span>
          </label>
          {repoError && <p className="text-[11px] text-red-400">{repoError}</p>}
        </form>
      </div>

      {/* Automation Toggles */}
      <div className="space-y-1.5 pt-1 border-t border-slate-800">
        <label className="flex items-center gap-2 px-2 py-1.5 rounded bg-[#0B0F17] border border-slate-800 cursor-pointer text-xs text-slate-300">
          <input
            type="checkbox"
            checked={actionsConfig.autoBuildOnChange}
            onChange={(e) =>
              onUpdateConfig({ ...actionsConfig, autoBuildOnChange: e.target.checked })
            }
            className="accent-emerald-500"
          />
          <span>Build automático após alteração da IA</span>
        </label>

        <label className="flex items-center gap-2 px-2 py-1.5 rounded bg-[#0B0F17] border border-slate-800 cursor-pointer text-xs text-slate-300">
          <input
            type="checkbox"
            checked={actionsConfig.autoFixErrors}
            onChange={(e) =>
              onUpdateConfig({ ...actionsConfig, autoFixErrors: e.target.checked })
            }
            className="accent-emerald-500"
          />
          <span>Corrigir logs de erro no chat e rebuildar</span>
        </label>

        <label className="flex items-center gap-2 px-2 py-1.5 rounded bg-[#0B0F17] border border-slate-800 cursor-pointer text-xs text-slate-300">
          <input
            type="checkbox"
            checked={actionsConfig.autoDownloadJar}
            onChange={(e) =>
              onUpdateConfig({ ...actionsConfig, autoDownloadJar: e.target.checked })
            }
            className="accent-emerald-500"
          />
          <span>Download automático do .jar ao finalizar</span>
        </label>
      </div>

      {error && (
        <div
          role="alert"
          className="p-2.5 rounded-md bg-red-950/40 border border-red-800/60 text-[11px] text-red-200"
        >
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={onTriggerBuild}
        disabled={isRunning || !actionsConfig.repoFullName.trim()}
        className="w-full py-2 px-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold rounded-md flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
      >
        {isRunning ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>
              {autoFixing
                ? 'Corrigindo erro no Chat...'
                : triggering
                  ? 'Enviando para o GitHub...'
                  : 'Compilando no GitHub Actions...'}
            </span>
          </>
        ) : (
          <>
            <Play className="w-3.5 h-3.5" />
            <span>Enviar &amp; Buildar Agora</span>
          </>
        )}
      </button>

      {/* Live Run Status + 1s/loop Live Logs */}
      {buildRun && (
        <div className="p-3 rounded-lg bg-[#0B0F17] border border-slate-800 space-y-2.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              {buildRun.status !== 'completed' ? (
                <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin shrink-0" />
              ) : buildRun.conclusion === 'success' ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
              )}
              <span className="font-medium text-slate-200 truncate">
                {buildRun.status !== 'completed'
                  ? 'Executando Gradle no GitHub Actions'
                  : buildRun.conclusion === 'success'
                    ? 'Build Concluído (Pronto!)'
                    : 'Falha no Build Gradle'}
              </span>
            </div>

            {buildRun.htmlUrl && (
              <a
                href={buildRun.htmlUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1 shrink-0"
              >
                <span>GitHub</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>

          {/* Live 1s/loop Log Stream */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] text-slate-400">
              <span className="flex items-center gap-1 font-medium text-slate-300">
                <Terminal className="w-3 h-3 text-emerald-400" />
                <span>Logs ao Vivo</span>
              </span>
              <span className="font-mono text-emerald-400">
                {buildRun.status !== 'completed' ? '● Ao vivo · 1s/loop' : 'Finalizado'}
              </span>
            </div>
            <pre
              ref={liveLogsRef}
              aria-label="Logs ao vivo do GitHub Actions"
              className={`p-2 rounded bg-[#06090F] border text-[10px] font-mono max-h-40 overflow-auto whitespace-pre-wrap leading-relaxed ${
                buildRun.conclusion === 'failure'
                  ? 'border-red-900/60 text-red-200'
                  : 'border-slate-800 text-slate-300'
              }`}
            >
              {buildRun.liveLogs ||
                '• [GitHub Actions] Aguardando início do job e streaming de logs (1s/loop)...'}
            </pre>
          </div>

          {buildRun.logsExcerpt && buildRun.conclusion === 'failure' && (
            <button
              type="button"
              onClick={() => onFixLogsInChat(buildRun.logsExcerpt!)}
              disabled={autoFixing}
              className="w-full py-1.5 px-2.5 bg-slate-800 hover:bg-slate-700 text-slate-100 text-[11px] font-medium rounded flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Wrench className="w-3 h-3 text-emerald-400" />
              <span>Corrigir Logs no Chat &amp; Rebuildar</span>
            </button>
          )}

          {buildRun.artifacts && buildRun.artifacts.length > 0 && (
            <div className="space-y-1.5 pt-1 border-t border-slate-800">
              {buildRun.artifacts.map((art) => (
                <button
                  key={art.id}
                  type="button"
                  onClick={() =>
                    onDownloadArtifact(
                      art.downloadUrl,
                      `${projectConfig.artifactId}-${projectConfig.version}.jar`
                    )
                  }
                  className="w-full py-1.5 px-2.5 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-600/40 text-emerald-300 text-[11px] font-medium rounded flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Baixar .jar ({art.name})</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
