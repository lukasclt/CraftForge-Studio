import React, { useState } from 'react';
import { ExternalLink, Eye, EyeOff, KeyRound, Lock, ShieldCheck, Users } from 'lucide-react';
import type { GitHubUser } from '../types/ide';

interface GitHubLoginScreenProps {
  onAuthenticated: (user: GitHubUser) => void;
  inviteRoomId?: string | null;
}

export const GitHubLoginScreen: React.FC<GitHubLoginScreenProps> = ({
  onAuthenticated,
  inviteRoomId,
}) => {
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = token.trim();
    if (!trimmed) {
      setError('Informe seu GitHub Token para continuar.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const resp = await fetch('/api/auth/github', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: trimmed }),
      });
      const data = (await resp.json()) as { user?: GitHubUser; error?: string };
      if (!resp.ok || !data.user) {
        setError(data.error || 'Token inválido ou sem acesso à API do GitHub.');
        return;
      }
      onAuthenticated(data.user);
    } catch {
      setError('Erro de conexão com o servidor ao validar seu GitHub Token.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex flex-col justify-between p-6">
      <header className="max-w-5xl w-full mx-auto flex items-center justify-between gap-8 py-2">
        <span className="text-lg font-semibold tracking-tight text-slate-100 whitespace-nowrap shrink-0">
          CraftForge Studio
        </span>
        <div className="flex items-center gap-3 text-xs text-slate-400">
          <span>Gradle Only</span>
          <span aria-hidden="true">·</span>
          <span>Minecraft 1.7.10 – 1.21.5+</span>
          <span aria-hidden="true">·</span>
          <span>Java 8 – 24</span>
        </div>
      </header>

      <main className="max-w-md w-full mx-auto my-auto py-8">
        <div className="bg-[#111827] border border-slate-800 rounded-xl p-7">
          <div className="flex items-center gap-2.5 text-emerald-400 text-xs font-medium mb-3">
            <Lock className="w-4 h-4 shrink-0" />
            <span>Login Obrigatório via GitHub Token</span>
          </div>

          <h1 className="text-2xl font-bold tracking-tight text-white mb-2 text-balance">
            Acesse sua IDE Gradle de Minecraft
          </h1>
          <p className="text-sm text-slate-400 leading-relaxed mb-6">
            Autentique-se com seu GitHub Token para desbloquear o editor de plugins, mods e
            clients de PvP, o Agente GitHub Copilot e a sincronização com colaboradores.
          </p>

          {inviteRoomId && (
            <div className="mb-5 p-3 rounded-lg bg-emerald-950/40 border border-emerald-800/60 flex items-start gap-2.5 text-xs text-emerald-200">
              <Users className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                Você foi convidado para a sala colaborativa{' '}
                <span className="font-mono font-medium text-emerald-300">{inviteRoomId}</span>. Faça
                login com seu GitHub Token para entrar na sessão.
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div>
              <label
                htmlFor="github-token-input"
                className="block text-xs font-medium text-slate-300 mb-1.5"
              >
                GitHub Personal Access Token ou Copilot Token
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="github-token-input"
                  type={showToken ? 'text' : 'password'}
                  value={token}
                  onChange={(e) => {
                    setToken(e.target.value);
                    if (error) setError(null);
                  }}
                  placeholder="ghp_... / github_pat_... / ghu_..."
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full bg-[#0B0F17] border border-slate-700 focus:border-emerald-500 focus:outline-none rounded-lg pl-9 pr-10 py-2.5 text-sm font-mono text-slate-100 placeholder:text-slate-600"
                />
                <button
                  type="button"
                  onClick={() => setShowToken((prev) => !prev)}
                  aria-label={showToken ? 'Ocultar token' : 'Mostrar token'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-200"
                >
                  {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div
                role="alert"
                className="p-3 rounded-lg bg-red-950/50 border border-red-800/70 text-xs text-red-200"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap"
            >
              {loading ? 'Validando no GitHub...' : 'Entrar com GitHub Token'}
            </button>

            <div className="pt-1 flex flex-col gap-2">
              <a
                href="https://github.com/settings/personal-access-tokens/new?name=CraftForge%20Studio&description=IDE%20Minecraft%20Gradle%20e%20Agente%20Copilot"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-2 px-4 bg-[#0B0F17] hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-2 whitespace-nowrap"
              >
                <ExternalLink className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Criar Key no GitHub (Fine-grained Token)</span>
              </a>
              <a
                href="https://github.com/settings/tokens/new?description=CraftForge%20Studio&scopes=read:user"
                target="_blank"
                rel="noopener noreferrer"
                className="text-center text-[11px] text-slate-400 hover:text-emerald-400 underline underline-offset-2 transition-colors"
              >
                Ou criar Token Clássico (read:user) na API do GitHub
              </a>
            </div>
          </form>

          <div className="mt-6 pt-5 border-t border-slate-800 space-y-2 text-xs text-slate-400">
            <div className="flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
              <span>
                Validado diretamente na API oficial do GitHub. Seus projetos e histórico de chat são
                salvos automaticamente via cookies.
              </span>
            </div>
            <p className="text-slate-500 pl-6">
              Dica: para o Agente IA via GitHub Models / Copilot, utilize um token com permissão{' '}
              <code className="font-mono text-slate-300">models:read</code> ou token de sessão
              GitHub Copilot.
            </p>
          </div>
        </div>
      </main>

      <footer className="max-w-5xl w-full mx-auto text-center text-xs text-slate-500 py-2">
        CraftForge Studio · Desenvolvimento Minecraft exclusivo via Gradle
      </footer>
    </div>
  );
};
