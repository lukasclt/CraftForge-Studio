const SESSION_STORAGE_KEY = 'cf_session_id';
const TOKEN_STORAGE_KEY = 'cf_gh_token';

export function storeClientSession(sessionId?: string | null, token?: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (sessionId) {
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, sessionId);
    }
    if (token) {
      window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    }
  } catch {
    // ignore storage errors in restricted contexts
  }
}

export function clearClientSession(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
    window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function getClientAuthHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const headers: Record<string, string> = {};
  try {
    const sid = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    const token = window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
    if (sid) headers['X-Session-Id'] = sid;
    if (token) headers['Authorization'] = `Bearer ${token}`;
  } catch {
    // ignore
  }
  return headers;
}

export function getStoredGitHubToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
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
