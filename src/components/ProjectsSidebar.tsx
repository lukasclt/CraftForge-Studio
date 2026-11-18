import React from 'react';
import { Cookie, FolderGit2, Plus, Trash2 } from 'lucide-react';
import type { ChatProject } from '../types/ide';
import { PLATFORM_LABELS } from '../utils/gradleEngine';

interface ProjectsSidebarProps {
  projects: ChatProject[];
  activeProjectId: string;
  onSelectProject: (id: string) => void;
  onOpenNewProject: () => void;
  onDeleteProject: (id: string) => void;
}

export const ProjectsSidebar: React.FC<ProjectsSidebarProps> = ({
  projects,
  activeProjectId,
  onSelectProject,
  onOpenNewProject,
  onDeleteProject,
}) => {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-800">
        <span className="text-xs font-semibold text-slate-300">Projetos &amp; Chats</span>
        <button
          type="button"
          onClick={onOpenNewProject}
          aria-label="Novo Projeto Gradle"
          className="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-medium rounded flex items-center gap-1 cursor-pointer whitespace-nowrap"
        >
          <Plus className="w-3 h-3" />
          <span>Novo</span>
        </button>
      </div>

      <div className="px-3 py-2 bg-[#0B0F17] border-b border-slate-800/80 flex items-center gap-2 text-[11px] text-slate-400">
        <Cookie className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
        <span>Salvos automaticamente via cookies do navegador.</span>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {projects.map((proj) => {
          const active = proj.id === activeProjectId;
          return (
            <div
              key={proj.id}
              className={`group rounded-lg border p-2.5 transition-colors ${
                active
                  ? 'bg-emerald-500/10 border-emerald-500/40'
                  : 'bg-[#0B0F17] border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <button
                  type="button"
                  onClick={() => onSelectProject(proj.id)}
                  className="flex-1 min-w-0 text-left cursor-pointer"
                >
                  <div className="flex items-center gap-1.5">
                    <FolderGit2
                      className={`w-3.5 h-3.5 shrink-0 ${
                        active ? 'text-emerald-400' : 'text-slate-400'
                      }`}
                    />
                    <span className="text-xs font-semibold text-slate-100 truncate">
                      {proj.config.name}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400 font-mono truncate">
                    {PLATFORM_LABELS[proj.config.platform].split(' ')[0]} · MC{' '}
                    {proj.config.minecraftVersion} · Java {proj.config.javaVersion}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500 tabular-nums">
                    {Object.keys(proj.files).length} arquivos · {proj.messages.length} mensagens
                  </div>
                </button>

                {projects.length > 1 && (
                  <button
                    type="button"
                    onClick={() => onDeleteProject(proj.id)}
                    aria-label={`Excluir projeto ${proj.config.name}`}
                    className="p-1 text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity cursor-pointer shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
