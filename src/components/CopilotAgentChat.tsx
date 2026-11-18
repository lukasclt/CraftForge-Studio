import React, { useRef, useState } from 'react';
import {
  BrainCircuit,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  ImagePlus,
  Send,
  Wrench,
  X,
} from 'lucide-react';
import type {
  ChatMessage,
  ThinkingEffort,
  VisionAttachment,
} from '../types/ide';

export const COPILOT_MODELS = [
  { id: 'openai/gpt-4.1', label: 'GPT-4.1 (Copilot · Tools + Vision)' },
  { id: 'openai/gpt-4o', label: 'GPT-4o (Copilot · Vision)' },
  { id: 'openai/o3-mini', label: 'o3-mini (Thinking / Reasoning)' },
  { id: 'deepseek/deepseek-r1', label: 'DeepSeek-R1 (Deep Thinking)' },
  { id: 'anthropic/claude-3.7-sonnet', label: 'Claude 3.7 Sonnet (Copilot)' },
];

const AGENT_TOOLS_SUMMARY = [
  { name: 'list_files', desc: 'Lista arquivos e pastas do projeto' },
  { name: 'read_file', desc: 'Lê conteúdo de classes Java e Gradle' },
  { name: 'write_file', desc: 'Cria ou edita arquivos no workspace' },
  { name: 'create_folder', desc: 'Cria novas pastas no explorador' },
  { name: 'delete_path', desc: 'Remove arquivos ou pastas' },
  { name: 'configure_gradle_project', desc: 'Muda versão Minecraft, Java e Plataforma' },
  { name: 'validate_gradle_setup', desc: 'Valida compatibilidade Gradle Toolchain' },
];

interface CopilotAgentChatProps {
  messages: ChatMessage[];
  sending: boolean;
  selectedModel: string;
  thinkingEnabled: boolean;
  thinkingEffort: ThinkingEffort;
  onChangeModel: (model: string) => void;
  onToggleThinking: () => void;
  onChangeEffort: (effort: ThinkingEffort) => void;
  onSendMessage: (prompt: string, images: VisionAttachment[]) => void;
  onOpenFileFromTool: (path: string) => void;
}

export const CopilotAgentChat: React.FC<CopilotAgentChatProps> = ({
  messages,
  sending,
  selectedModel,
  thinkingEnabled,
  thinkingEffort,
  onChangeModel,
  onToggleThinking,
  onChangeEffort,
  onSendMessage,
  onOpenFileFromTool,
}) => {
  const [prompt, setPrompt] = useState('');
  const [images, setImages] = useState<VisionAttachment[]>([]);
  const [showToolsInfo, setShowToolsInfo] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollEndRef = useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, sending]);

  const handleFilesSelected = (fileList: FileList | null) => {
    if (!fileList) return;
    Array.from(fileList).forEach((file) => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          setImages((prev) => [
            ...prev,
            {
              id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              name: file.name,
              mimeType: file.type,
              dataUrl: reader.result as string,
            },
          ]);
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        if (blob) {
          const dt = new DataTransfer();
          dt.items.add(blob);
          handleFilesSelected(dt.files);
        }
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if ((!prompt.trim() && images.length === 0) || sending) return;
    onSendMessage(prompt.trim(), images);
    setPrompt('');
    setImages([]);
  };

  const handleCopyText = (id: string, text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <aside
      aria-label="Agente GitHub Copilot"
      className="flex flex-col h-full bg-[#111827] border-l border-slate-800"
    >
      {/* Header */}
      <div className="p-3 border-b border-slate-800 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold text-slate-100 whitespace-nowrap">
            Agente GitHub Copilot
          </h2>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onToggleThinking}
              aria-pressed={thinkingEnabled}
              className={`px-2 py-1 rounded text-[11px] font-medium flex items-center gap-1 border transition-colors cursor-pointer whitespace-nowrap ${
                thinkingEnabled
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                  : 'bg-[#0B0F17] border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <BrainCircuit className="w-3 h-3" />
              <span>Thinking</span>
            </button>
            <button
              type="button"
              onClick={() => setShowToolsInfo((prev) => !prev)}
              aria-expanded={showToolsInfo}
              className={`px-2 py-1 rounded text-[11px] font-medium flex items-center gap-1 border transition-colors cursor-pointer whitespace-nowrap ${
                showToolsInfo
                  ? 'bg-slate-800 border-slate-600 text-slate-100'
                  : 'bg-[#0B0F17] border-slate-800 text-slate-300 hover:text-white'
              }`}
            >
              <Wrench className="w-3 h-3 text-emerald-400" />
              <span>Tools (7)</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="copilot-model-select" className="sr-only">
            Modelo GitHub Copilot
          </label>
          <select
            id="copilot-model-select"
            value={selectedModel}
            onChange={(e) => onChangeModel(e.target.value)}
            className="flex-1 min-w-0 bg-[#0B0F17] border border-slate-800 rounded px-2 py-1.5 text-[11px] text-slate-200 focus:border-emerald-500 focus:outline-none"
          >
            {COPILOT_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>

          {thinkingEnabled && (
            <select
              aria-label="Nível de Thinking"
              value={thinkingEffort}
              onChange={(e) => onChangeEffort(e.target.value as ThinkingEffort)}
              className="bg-[#0B0F17] border border-slate-800 rounded px-2 py-1.5 text-[11px] text-slate-300 focus:border-emerald-500 focus:outline-none"
            >
              <option value="low">Baixo</option>
              <option value="medium">Médio</option>
              <option value="high">Alto</option>
            </select>
          )}
        </div>

        {showToolsInfo && (
          <div className="p-2.5 rounded-md bg-[#0B0F17] border border-slate-800 space-y-1">
            <div className="text-[11px] font-medium text-slate-300 mb-1">
              Capacidades ativas: Tools · Vision · Thinking
            </div>
            {AGENT_TOOLS_SUMMARY.map((t) => (
              <div key={t.name} className="flex items-baseline justify-between gap-2 text-[11px]">
                <span className="font-mono text-emerald-400 shrink-0">{t.name}</span>
                <span className="text-slate-400 truncate">{t.desc}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Messages Feed */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.map((msg) => {
          const isUser = msg.role === 'user';
          return (
            <div
              key={msg.id}
              className={`rounded-lg p-3 border text-xs leading-relaxed ${
                msg.isError
                  ? 'bg-red-950/40 border-red-800/70 text-red-200'
                  : isUser
                    ? 'bg-[#0B0F17] border-slate-800 text-slate-100'
                    : 'bg-slate-900/70 border-slate-800/90 text-slate-200'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1.5 text-[11px] text-slate-400">
                <div className="flex items-center gap-1.5 min-w-0">
                  {msg.authorAvatar ? (
                    <img
                      src={msg.authorAvatar}
                      alt={msg.authorLogin || 'GitHub'}
                      referrerPolicy="no-referrer"
                      className="w-4 h-4 rounded-full shrink-0"
                    />
                  ) : null}
                  <span className="font-medium text-slate-300 truncate">
                    {isUser ? msg.authorLogin || 'Você' : 'Copilot Agent'}
                  </span>
                  {msg.model && !isUser && (
                    <span className="text-slate-500 font-mono truncate">· {msg.model}</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleCopyText(msg.id, msg.content)}
                  aria-label="Copiar mensagem"
                  className="p-1 text-slate-500 hover:text-slate-200 cursor-pointer shrink-0"
                >
                  {copiedId === msg.id ? (
                    <Check className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                </button>
              </div>

              {/* Thinking disclosure */}
              {msg.thinking && (
                <details className="mb-2 rounded border border-slate-800 bg-[#0B0F17] p-2">
                  <summary className="cursor-pointer text-[11px] font-medium text-emerald-400 flex items-center gap-1.5 select-none">
                    <BrainCircuit className="w-3.5 h-3.5 shrink-0" />
                    <span>Raciocínio do Agente (Thinking)</span>
                  </summary>
                  <pre className="mt-2 text-[11px] font-mono text-slate-400 whitespace-pre-wrap break-words">
                    {msg.thinking}
                  </pre>
                </details>
              )}

              {/* Tools executed */}
              {msg.toolCalls && msg.toolCalls.length > 0 && (
                <div className="mb-2 space-y-1">
                  {msg.toolCalls.map((tc) => (
                    <div
                      key={tc.id}
                      className="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-[#0B0F17] border border-slate-800 text-[11px]"
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Wrench
                          className={`w-3 h-3 shrink-0 ${
                            tc.status === 'ok' ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        />
                        <span className="font-mono text-slate-200 shrink-0">{tc.name}</span>
                        {tc.affectedPath && (
                          <span className="font-mono text-slate-400 truncate">
                            {tc.affectedPath}
                          </span>
                        )}
                      </div>
                      {tc.affectedPath && tc.name !== 'delete_path' && tc.name !== 'create_folder' && (
                        <button
                          type="button"
                          onClick={() => onOpenFileFromTool(tc.affectedPath!)}
                          className="text-emerald-400 hover:text-emerald-300 font-medium shrink-0 cursor-pointer"
                        >
                          Abrir
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Attached Vision Images */}
              {msg.images && msg.images.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {msg.images.map((img) => (
                    <img
                      key={img.id}
                      src={img.dataUrl}
                      alt={img.name}
                      className="max-h-28 rounded border border-slate-700 object-contain bg-black/30"
                    />
                  ))}
                </div>
              )}

              <div className="whitespace-pre-wrap break-words text-slate-200">{msg.content}</div>
            </div>
          );
        })}

        {sending && (
          <div className="p-3 rounded-lg border border-slate-800 bg-slate-900/50 text-xs text-slate-400">
            Agente Copilot processando Tools / Vision / Thinking...
          </div>
        )}
        <div ref={scrollEndRef} />
      </div>

      {/* Composer */}
      <form onSubmit={handleSubmit} className="p-3 border-t border-slate-800 bg-[#0B0F17] space-y-2">
        {images.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {images.map((img) => (
              <div key={img.id} className="relative group">
                <img
                  src={img.dataUrl}
                  alt={img.name}
                  className="w-14 h-14 object-cover rounded border border-slate-700"
                />
                <button
                  type="button"
                  onClick={() => setImages((prev) => prev.filter((i) => i.id !== img.id))}
                  aria-label={`Remover imagem ${img.name}`}
                  className="absolute -top-1.5 -right-1.5 bg-slate-900 border border-slate-700 text-slate-200 rounded-full p-0.5 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <textarea
          aria-label="Prompt para o Agente Copilot"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onPaste={handlePaste}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e);
            }
          }}
          rows={3}
          placeholder="Peça um comando, módulo PvP, Mixin, ou cole um print (Vision)..."
          className="w-full bg-[#111827] border border-slate-800 focus:border-emerald-500 rounded-lg p-2.5 text-xs text-slate-100 placeholder:text-slate-500 resize-none focus:outline-none"
        />

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => handleFilesSelected(e.target.files)}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Anexar Imagem (Vision)"
              className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md text-xs flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <ImagePlus className="w-3.5 h-3.5 text-emerald-400" />
              <span>Vision</span>
            </button>
          </div>

          <button
            type="submit"
            disabled={sending || (!prompt.trim() && images.length === 0)}
            className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-md text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Enviar</span>
          </button>
        </div>
      </form>
    </aside>
  );
};
