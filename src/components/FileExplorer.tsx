import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Edit3,
  FileCode2,
  FilePlus2,
  Folder,
  FolderOpen,
  FolderPlus,
  Trash2,
} from 'lucide-react';
import type { FileTreeNode, VirtualFile } from '../types/ide';
import { buildFileTree, normalizePath } from '../utils/fileTree';

interface FileExplorerProps {
  files: Record<string, VirtualFile>;
  folders: string[];
  activeFile: string | null;
  dirtyPaths: Set<string>;
  onSelectFile: (path: string) => void;
  onCreateFile: (path: string) => void;
  onCreateFolder: (path: string) => void;
  onRenamePath: (oldPath: string, newPath: string) => void;
  onDeletePath: (path: string) => void;
}

export const FileExplorer: React.FC<FileExplorerProps> = ({
  files,
  folders,
  activeFile,
  dirtyPaths,
  onSelectFile,
  onCreateFile,
  onCreateFolder,
  onRenamePath,
  onDeletePath,
}) => {
  const [expanded, setExpanded] = useState<Set<string>>(
    () =>
      new Set([
        'src',
        'src/main',
        'src/main/java',
        'src/main/resources',
        'gradle',
        'gradle/wrapper',
        ...folders.filter((f) => f.startsWith('src/main/java/')),
      ])
  );

  React.useEffect(() => {
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const f of folders) {
        if (f.startsWith('src/main/java')) next.add(f);
      }
      return next;
    });
  }, [folders]);
  const [createMode, setCreateMode] = useState<'file' | 'folder' | null>(null);
  const [createBaseFolder, setCreateBaseFolder] = useState<string>('');
  const [newName, setNewName] = useState('');
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const tree = buildFileTree(files, folders);

  const toggleFolder = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleStartCreate = (mode: 'file' | 'folder', baseFolder = '') => {
    setCreateMode(mode);
    setCreateBaseFolder(baseFolder);
    setNewName(baseFolder ? `${baseFolder}/` : '');
    if (baseFolder) {
      setExpanded((prev) => new Set(prev).add(baseFolder));
    }
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = normalizePath(newName);
    if (!cleaned) return;
    if (createMode === 'file') {
      onCreateFile(cleaned);
    } else if (createMode === 'folder') {
      onCreateFolder(cleaned);
      setExpanded((prev) => new Set(prev).add(cleaned));
    }
    setCreateMode(null);
    setCreateBaseFolder('');
    setNewName('');
  };

  const handleRenameSubmit = (e: React.FormEvent, oldPath: string) => {
    e.preventDefault();
    const cleaned = normalizePath(renameValue);
    if (cleaned && cleaned !== oldPath) {
      onRenamePath(oldPath, cleaned);
    }
    setRenamingPath(null);
    setRenameValue('');
  };

  const renderNode = (node: FileTreeNode, depth: number) => {
    const isFolder = node.type === 'folder';
    const isExpanded = expanded.has(node.path);
    const isActive = !isFolder && activeFile === node.path;
    const isDirty = !isFolder && dirtyPaths.has(node.path);
    const isRenaming = renamingPath === node.path;

    if (isRenaming) {
      return (
        <form
          key={node.path}
          onSubmit={(e) => handleRenameSubmit(e, node.path)}
          className="flex items-center gap-1 py-1 pr-2"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          <input
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            aria-label={`Novo caminho para ${node.name}`}
            autoFocus
            onBlur={() => setRenamingPath(null)}
            className="w-full bg-[#0B0F17] border border-emerald-500 rounded px-1.5 py-0.5 text-xs font-mono text-slate-100 focus:outline-none"
          />
        </form>
      );
    }

    return (
      <div key={node.path}>
        <div
          className={`group flex items-center justify-between pr-1.5 py-1 text-xs rounded-md transition-colors ${
            isActive
              ? 'bg-emerald-500/15 text-emerald-300'
              : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
          }`}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          <button
            type="button"
            onClick={() => (isFolder ? toggleFolder(node.path) : onSelectFile(node.path))}
            className="flex items-center gap-1.5 min-w-0 flex-1 text-left cursor-pointer py-0.5"
          >
            {isFolder ? (
              <>
                {isExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                )}
                {isExpanded ? (
                  <FolderOpen className="w-3.5 h-3.5 text-amber-400/90 shrink-0" />
                ) : (
                  <Folder className="w-3.5 h-3.5 text-amber-400/80 shrink-0" />
                )}
              </>
            ) : (
              <>
                <span className="w-3.5 shrink-0" />
                <FileCode2
                  className={`w-3.5 h-3.5 shrink-0 ${
                    node.name.endsWith('.java')
                      ? 'text-orange-400'
                      : node.name.includes('gradle')
                        ? 'text-emerald-400'
                        : 'text-sky-400'
                  }`}
                />
              </>
            )}
            <span className="truncate font-mono text-[12px]">{node.name}</span>
            {isDirty && (
              <span className="text-amber-400 font-bold shrink-0" title="Alterações não salvas">
                *
              </span>
            )}
          </button>

          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
            {isFolder && (
              <button
                type="button"
                onClick={() => handleStartCreate('file', node.path)}
                aria-label={`Novo arquivo em ${node.name}`}
                title="Novo arquivo nesta pasta"
                className="p-1 text-slate-400 hover:text-emerald-400 rounded cursor-pointer"
              >
                <FilePlus2 className="w-3 h-3" />
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setRenamingPath(node.path);
                setRenameValue(node.path);
              }}
              aria-label={`Renomear ${node.path}`}
              title="Renomear"
              className="p-1 text-slate-400 hover:text-slate-100 rounded cursor-pointer"
            >
              <Edit3 className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={() => onDeletePath(node.path)}
              aria-label={`Excluir ${node.path}`}
              title="Excluir"
              className="p-1 text-slate-400 hover:text-red-400 rounded cursor-pointer"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>

        {isFolder && isExpanded && node.children && (
          <div>{node.children.map((child) => renderNode(child, depth + 1))}</div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-800">
        <span className="text-xs font-semibold text-slate-300">Explorador de Arquivos</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => handleStartCreate('file', '')}
            aria-label="Novo Arquivo"
            title="Novo Arquivo"
            className="p-1.5 text-slate-400 hover:text-emerald-400 hover:bg-slate-800 rounded-md transition-colors cursor-pointer"
          >
            <FilePlus2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => handleStartCreate('folder', '')}
            aria-label="Nova Pasta"
            title="Nova Pasta"
            className="p-1.5 text-slate-400 hover:text-emerald-400 hover:bg-slate-800 rounded-md transition-colors cursor-pointer"
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {createMode && (
        <form onSubmit={handleCreateSubmit} className="p-2.5 border-b border-slate-800 bg-[#0B0F17] space-y-2">
          <label htmlFor="new-path-input" className="block text-[11px] font-medium text-slate-400">
            {createMode === 'file' ? 'Caminho do novo arquivo' : 'Caminho da nova pasta'}
            {createBaseFolder ? ` (em ${createBaseFolder})` : ''}
          </label>
          <input
            id="new-path-input"
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={
              createMode === 'file' ? 'src/main/java/MeuModulo.java' : 'src/main/java/utils'
            }
            autoFocus
            className="w-full bg-[#111827] border border-slate-700 focus:border-emerald-500 rounded px-2 py-1.5 text-xs font-mono text-slate-100 focus:outline-none"
          />
          <div className="flex items-center gap-1.5">
            <button
              type="submit"
              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded cursor-pointer"
            >
              Criar
            </button>
            <button
              type="button"
              onClick={() => {
                setCreateMode(null);
                setNewName('');
              }}
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded cursor-pointer"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      <div className="flex-1 overflow-y-auto p-2 space-y-0.5" role="tree" aria-label="Árvore de arquivos do projeto">
        {tree.length === 0 ? (
          <div className="p-4 text-center text-xs text-slate-500">
            Nenhum arquivo no projeto. Clique em Novo Arquivo para começar.
          </div>
        ) : (
          tree.map((node) => renderNode(node, 0))
        )}
      </div>
    </div>
  );
};
