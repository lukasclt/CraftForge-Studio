import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  FileCode2,
  Save,
  Terminal,
  X,
} from 'lucide-react';
import type { ProjectConfig, VirtualFile } from '../types/ide';
import { getLanguageFromPath } from '../utils/fileTree';
import { validateGradleSetup } from '../utils/gradleEngine';

interface CodeEditorPaneProps {
  config: ProjectConfig;
  files: Record<string, VirtualFile>;
  openTabs: string[];
  activeFile: string | null;
  draftContents: Record<string, string>;
  dirtyPaths: Set<string>;
  lastSavedAt: number | null;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onChangeContent: (path: string, content: string) => void;
  onSaveFile: (path: string) => void;
}

export const CodeEditorPane: React.FC<CodeEditorPaneProps> = ({
  config,
  files,
  openTabs,
  activeFile,
  draftContents,
  dirtyPaths,
  lastSavedAt,
  onSelectTab,
  onCloseTab,
  onChangeContent,
  onSaveFile,
}) => {
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });
  const [gradleDrawerOpen, setGradleDrawerOpen] = useState(true);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);

  const currentContent = activeFile
    ? draftContents[activeFile] ?? files[activeFile]?.content ?? ''
    : '';
  const isDirty = activeFile ? dirtyPaths.has(activeFile) : false;
  const language = activeFile ? getLanguageFromPath(activeFile) : 'plaintext';

  const lineCount = useMemo(() => {
    if (!activeFile) return 1;
    return Math.max(1, currentContent.split('\n').length);
  }, [activeFile, currentContent]);

  const validation = useMemo(() => validateGradleSetup(config, files), [config, files]);

  const updateCursorFromElement = (el: HTMLTextAreaElement) => {
    const start = el.selectionStart || 0;
    const before = el.value.slice(0, start);
    const lines = before.split('\n');
    setCursorPos({
      line: lines.length,
      col: lines[lines.length - 1].length + 1,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (activeFile) onSaveFile(activeFile);
      return;
    }

    if (e.key === 'Tab' && activeFile) {
      e.preventDefault();
      const el = e.currentTarget;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const updated = `${currentContent.slice(0, start)}    ${currentContent.slice(end)}`;
      onChangeContent(activeFile, updated);
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = start + 4;
          textareaRef.current.selectionEnd = start + 4;
        }
      });
    }
  };

  const handleCopyCommand = (cmd: string) => {
    navigator.clipboard?.writeText(cmd).catch(() => {});
    setCopiedCmd(cmd);
    setTimeout(() => setCopiedCmd(null), 1500);
  };

  const gradleCommands = [
    { label: 'Build JAR', cmd: './gradlew build' },
    { label: 'ShadowJAR', cmd: './gradlew shadowJar' },
    {
      label: config.platform === 'pvp-client' || config.platform === 'fabric' || config.platform === 'forge' || config.platform === 'neoforge' ? 'Run Client' : 'Run Server',
      cmd:
        config.platform === 'pvp-client' || config.platform === 'fabric' || config.platform === 'forge' || config.platform === 'neoforge'
          ? './gradlew runClient'
          : './gradlew runServer',
    },
  ];

  return (
    <div className="flex flex-col h-full min-w-0 bg-[#0F141F]">
      {/* Tab Bar */}
      <div className="flex items-center justify-between border-b border-slate-800 bg-[#111827] min-h-[38px]">
        <div className="flex items-center overflow-x-auto no-scrollbar flex-1" role="tablist" aria-label="Arquivos abertos">
          {openTabs.map((tabPath) => {
            const active = tabPath === activeFile;
            const dirty = dirtyPaths.has(tabPath);
            const fileName = tabPath.split('/').pop() || tabPath;
            return (
              <div
                key={tabPath}
                className={`group flex items-center gap-1.5 border-r border-slate-800 px-3 py-2 text-xs shrink-0 ${
                  active
                    ? 'bg-[#0F141F] text-emerald-300 border-t-2 border-t-emerald-500'
                    : 'bg-[#111827] text-slate-400 hover:bg-slate-800/60 hover:text-slate-200 border-t-2 border-t-transparent'
                }`}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => onSelectTab(tabPath)}
                  className="flex items-center gap-1.5 font-mono text-[12px] cursor-pointer whitespace-nowrap"
                >
                  <FileCode2 className="w-3.5 h-3.5 shrink-0 opacity-80" />
                  <span>{fileName}</span>
                  {dirty && <span className="text-amber-400 font-bold">*</span>}
                </button>
                <button
                  type="button"
                  onClick={() => onCloseTab(tabPath)}
                  aria-label={`Fechar ${fileName}`}
                  className="p-0.5 rounded hover:bg-slate-700/70 text-slate-500 hover:text-slate-200 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-2 px-2.5 shrink-0">
          {activeFile && (
            <button
              type="button"
              onClick={() => onSaveFile(activeFile)}
              className={`px-3 py-1 rounded text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                isDirty
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
              }`}
            >
              <Save className="w-3.5 h-3.5" />
              <span>Salvar (Ctrl+S)</span>
            </button>
          )}
        </div>
      </div>

      {/* File Breadcrumb & Status */}
      {activeFile && (
        <div className="flex items-center justify-between px-3 py-1.5 bg-[#0B0F17] border-b border-slate-800/80 text-[11px] text-slate-400">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-mono truncate text-slate-300">{activeFile}</span>
            {isDirty ? (
              <span className="text-amber-400 shrink-0">· Não salvo</span>
            ) : lastSavedAt ? (
              <span className="text-emerald-400/90 shrink-0">· Salvo em cookies</span>
            ) : null}
          </div>
          <div className="flex items-center gap-3 font-mono tabular-nums shrink-0">
            <span>{language.toUpperCase()}</span>
            <span>
              Ln {cursorPos.line}, Col {cursorPos.col}
            </span>
          </div>
        </div>
      )}

      {/* Main Code Editor Area */}
      <div className="flex-1 min-h-0 relative flex overflow-hidden">
        {activeFile && files[activeFile] !== undefined ? (
          <>
            <div
              ref={lineNumbersRef}
              aria-hidden="true"
              className="w-12 py-3 pr-2.5 pl-2 bg-[#0B0F17]/70 border-r border-slate-800/70 text-right font-mono text-[12px] leading-[1.6] text-slate-600 select-none overflow-hidden tabular-nums shrink-0"
            >
              {Array.from({ length: lineCount }, (_, idx) => (
                <div key={idx + 1}>{idx + 1}</div>
              ))}
            </div>
            <textarea
              ref={textareaRef}
              aria-label={`Editor de código para ${activeFile}`}
              value={currentContent}
              onChange={(e) => {
                onChangeContent(activeFile, e.target.value);
                updateCursorFromElement(e.currentTarget);
              }}
              onClick={(e) => updateCursorFromElement(e.currentTarget)}
              onKeyUp={(e) => updateCursorFromElement(e.currentTarget)}
              onKeyDown={handleKeyDown}
              onScroll={(e) => {
                if (lineNumbersRef.current) {
                  lineNumbersRef.current.scrollTop = e.currentTarget.scrollTop;
                }
              }}
              spellCheck={false}
              className="flex-1 w-full h-full bg-[#0F141F] text-slate-100 font-mono text-[13px] leading-[1.6] p-3 resize-none focus:outline-none overflow-auto whitespace-pre"
            />
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <FileCode2 className="w-10 h-10 text-slate-700 mb-3" />
            <p className="text-sm font-medium text-slate-300 mb-1">Nenhum arquivo aberto</p>
            <p className="text-xs text-slate-500 max-w-sm">
              Selecione um arquivo no Explorador à esquerda ou peça ao Agente Copilot para gerar
              classes Java, Mixins ou configurações Gradle.
            </p>
          </div>
        )}
      </div>

      {/* Bottom Gradle Validator & Tasks Drawer */}
      <div className="border-t border-slate-800 bg-[#111827]">
        <button
          type="button"
          onClick={() => setGradleDrawerOpen((o) => !o)}
          className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800/50 cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <Terminal className="w-3.5 h-3.5 text-emerald-400" />
            <span className="font-medium">Validador Gradle &amp; Tarefas</span>
            <span className="text-slate-500 font-mono text-[11px]">
              · Gradle {config.gradleVersion} · Java {config.javaVersion} · MC{' '}
              {config.minecraftVersion}
            </span>
          </div>
          {gradleDrawerOpen ? (
            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          ) : (
            <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
          )}
        </button>

        {gradleDrawerOpen && (
          <div className="px-3 pb-2.5 pt-1 border-t border-slate-800/80 flex flex-col gap-2 max-h-36 overflow-y-auto">
            <div className="flex flex-wrap items-center gap-2">
              {gradleCommands.map((item) => (
                <button
                  key={item.cmd}
                  type="button"
                  onClick={() => handleCopyCommand(item.cmd)}
                  className="px-2.5 py-1 bg-[#0B0F17] border border-slate-800 hover:border-emerald-600/60 rounded text-[11px] font-mono text-slate-300 flex items-center gap-1.5 cursor-pointer"
                >
                  <span className="text-slate-400">{item.label}:</span>
                  <span className="text-emerald-300">{item.cmd}</span>
                  {copiedCmd === item.cmd ? (
                    <Check className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <Copy className="w-3 h-3 text-slate-500" />
                  )}
                </button>
              ))}
            </div>

            <div className="space-y-1">
              {validation.diagnostics.map((d) => (
                <div key={d.code} className="flex items-center gap-2 text-[11px]">
                  {d.level === 'ok' ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  ) : (
                    <AlertTriangle
                      className={`w-3.5 h-3.5 shrink-0 ${
                        d.level === 'error' ? 'text-red-400' : 'text-amber-400'
                      }`}
                    />
                  )}
                  <span
                    className={
                      d.level === 'error'
                        ? 'text-red-300'
                        : d.level === 'warning'
                          ? 'text-amber-300'
                          : 'text-slate-300'
                    }
                  >
                    {d.message}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
