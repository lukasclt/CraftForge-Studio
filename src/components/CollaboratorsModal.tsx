import React, { useState } from 'react';
import { Check, Copy, Link2, UserPlus, Users, X } from 'lucide-react';
import type { Collaborator, GitHubUser } from '../types/ide';

interface CollaboratorsModalProps {
  open: boolean;
  roomId: string;
  wsConnected: boolean;
  collaborators: Collaborator[];
  onlineUsers: GitHubUser[];
  onClose: () => void;
  onInviteUser: (username: string) => Promise<{ ok: boolean; error?: string }>;
  onJoinRoom: (targetRoomId: string) => void;
}

export const CollaboratorsModal: React.FC<CollaboratorsModalProps> = ({
  open,
  roomId,
  wsConnected,
  collaborators,
  onlineUsers,
  onClose,
  onInviteUser,
  onJoinRoom,
}) => {
  const [username, setUsername] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const inviteUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/?room=${encodeURIComponent(roomId)}`
      : `?room=${roomId}`;

  const handleCopyInvite = () => {
    navigator.clipboard?.writeText(inviteUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = username.trim().replace(/^@/, '');
    if (!cleaned) {
      setError('Informe o usuário GitHub do colaborador.');
      return;
    }
    setInviting(true);
    setError(null);
    const res = await onInviteUser(cleaned);
    setInviting(false);
    if (!res.ok) {
      setError(res.error || 'Não foi possível convidar este usuário.');
    } else {
      setUsername('');
    }
  };

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = joinCode.trim();
    if (!cleaned) return;
    onJoinRoom(cleaned);
    setJoinCode('');
    onClose();
  };

  const onlineSet = new Set(onlineUsers.map((u) => u.login.toLowerCase()));

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="collab-modal-title"
    >
      <div className="bg-[#111827] border border-slate-800 rounded-xl max-w-lg w-full p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-emerald-400" />
            <h2 id="collab-modal-title" className="text-base font-semibold text-white">
              Colaboradores via GitHub Token
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar colaboradores"
            className="p-1 text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Shareable Room Link */}
        <div className="p-3.5 rounded-lg bg-[#0B0F17] border border-slate-800 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-300">Link de Convite da Sala</span>
            <span className={wsConnected ? 'text-emerald-400' : 'text-amber-400'}>
              {wsConnected ? 'WebSocket Conectado' : 'Reconectando...'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={inviteUrl}
              aria-label="URL de convite da sala"
              className="flex-1 bg-[#111827] border border-slate-800 rounded px-2.5 py-1.5 text-xs font-mono text-slate-300 focus:outline-none"
            />
            <button
              type="button"
              onClick={handleCopyInvite}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copiado' : 'Copiar'}</span>
            </button>
          </div>
          <p className="text-[11px] text-slate-500">
            Código da sala: <code className="font-mono text-slate-300">{roomId}</code> · Quem abrir
            o link fará login obrigatório com o próprio GitHub Token para usar o Chat do Agente e
            editar arquivos em tempo real.
          </p>
        </div>

        {/* Invite by GitHub Username */}
        <form onSubmit={handleInviteSubmit} className="space-y-2">
          <label htmlFor="collab-username" className="block text-xs font-medium text-slate-300">
            Convidar colaborador pelo @usuário do GitHub
          </label>
          <div className="flex items-center gap-2">
            <input
              id="collab-username"
              type="text"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                if (error) setError(null);
              }}
              placeholder="ex: octocat"
              className="flex-1 bg-[#0B0F17] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono text-slate-100 focus:border-emerald-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={inviting}
              className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-medium rounded-md flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <UserPlus className="w-3.5 h-3.5 text-emerald-400" />
              <span>{inviting ? 'Buscando...' : 'Convidar'}</span>
            </button>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </form>

        {/* Active Collaborators List */}
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-slate-300">
            Participantes na Sessão ({collaborators.length})
          </h3>
          <div className="max-h-36 overflow-y-auto divide-y divide-slate-800 border border-slate-800 rounded-lg bg-[#0B0F17]">
            {collaborators.map((c) => {
              const isOnline = onlineSet.has(c.login.toLowerCase());
              return (
                <div key={c.login} className="flex items-center justify-between px-3 py-2 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    {c.avatar_url ? (
                      <img
                        src={c.avatar_url}
                        alt={c.login}
                        referrerPolicy="no-referrer"
                        className="w-6 h-6 rounded-full shrink-0"
                      />
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center text-[11px] font-mono text-slate-300 shrink-0">
                        {c.login.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="font-mono text-slate-200 truncate">@{c.login}</div>
                      {c.name && <div className="text-[11px] text-slate-500 truncate">{c.name}</div>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] shrink-0">
                    <span className="text-slate-400">
                      {c.role === 'owner' ? 'Anfitrião' : 'Colaborador'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className={isOnline ? 'text-emerald-400' : 'text-slate-500'}>
                      {isOnline ? 'Online' : 'Convidado'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Join another room */}
        <form onSubmit={handleJoinSubmit} className="pt-3 border-t border-slate-800 space-y-2">
          <label htmlFor="join-room-code" className="block text-xs font-medium text-slate-300">
            Entrar em outra sala por código
          </label>
          <div className="flex items-center gap-2">
            <input
              id="join-room-code"
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              placeholder="room_xxxxxx"
              className="flex-1 bg-[#0B0F17] border border-slate-700 rounded-md px-3 py-2 text-xs font-mono text-slate-100 focus:border-emerald-500 focus:outline-none"
            />
            <button
              type="submit"
              className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-md flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <Link2 className="w-3.5 h-3.5" />
              <span>Entrar</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
