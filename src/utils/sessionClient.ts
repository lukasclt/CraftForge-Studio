import type { GitHubUser } from '../types/ide';
import { clearAuthCookies, loadAuthCookies, saveAuthCookies } from './cookieStorage';

const SESSION_STORAGE_KEY = 'cf_session_id';
const TOKEN_STORAGE_KEY = 'cf_gh_token';
const USER_STORAGE_KEY = 'cf_gh_user';

export function storeClientSession(
  sessionId?: string | null,
  token?: string | null,
  user?: GitHubUser | null
): void {
  if (typeof window === 'undefined') return;
  const isSandboxToken = token === 'sandbox-autostart-token' || Boolean(user?.isSandbox);

  try {
    if (sessionId) {
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, sessionId);
      if (!isSandboxToken) {
        window.localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
      }
    }
    if (token) {
      window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
      if (!isSandboxToken) {
        window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
      }
    }
    if (user && !isSandboxToken) {
      const compactUser: GitHubUser = {
        id: user.id,
        login: user.login,
        name: user.name,
        avatar_url: user.avatar_url,
      };
      window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(compactUser));
    }
  } catch {
    // ignore storage errors in restricted contexts
  }

  if (!isSandboxToken) {
    saveAuthCookies({ sessionId, token, user });
  }
}

export function clearClientSession(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
    window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    window.localStorage.removeItem(USER_STORAGE_KEY);
  } catch {
    // ignore
  }
  clearAuthCookies();
}

export function getStoredSessionId(): string | null {
  if (typeof window === 'undefined') return null;
  const fromCookie = loadAuthCookies().sessionId;
  if (fromCookie) return fromCookie;
  try {
    return (
      window.sessionStorage.getItem(SESSION_STORAGE_KEY) ||
      window.localStorage.getItem(SESSION_STORAGE_KEY)
    );
  } catch {
    return null;
  }
}

export function getStoredGitHubToken(): string | null {
  if (typeof window === 'undefined') return null;
  const fromCookie = loadAuthCookies().token;
  if (fromCookie) return fromCookie;
  try {
    return (
      window.sessionStorage.getItem(TOKEN_STORAGE_KEY) ||
      window.localStorage.getItem(TOKEN_STORAGE_KEY)
    );
  } catch {
    return null;
  }
}

export function getStoredAuthUser(): GitHubUser | null {
  if (typeof window === 'undefined') return null;
  const fromCookie = loadAuthCookies().user;
  if (fromCookie) return fromCookie;
  try {
    const raw = window.localStorage.getItem(USER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GitHubUser;
    return parsed?.login ? parsed : null;
  } catch {
    return null;
  }
}

export function getClientAuthHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const headers: Record<string, string> = {};
  const sid = getStoredSessionId();
  const token = getStoredGitHubToken();
  if (sid) headers['X-Session-Id'] = sid;
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

export function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const authHeaders = getClientAuthHeaders();
  const mergedHeaders = new Headers(init.headers || {});
  for (const [k, v] of Object.entries(authHeaders)) {
    if (!mergedHeaders.has(k)) {
      mergedHeaders.set(k, v);
    }
  }
  return fetch(input, {
    ...init,
    credentials: 'include',
    headers: mergedHeaders,
  });
}
