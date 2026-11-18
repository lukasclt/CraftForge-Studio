import type { ChatProject } from '../types/ide';

const CHUNK_SIZE = 2800;
const PROJECT_META_COOKIE = 'cf_proj_meta';
const ACTIVE_PROJECT_COOKIE = 'cf_active_proj';

export interface CookieProjectSummary {
  id: string;
  roomId: string;
  name: string;
  platform: ChatProject['config']['platform'];
  minecraftVersion: string;
  javaVersion: ChatProject['config']['javaVersion'];
  updatedAt: number;
  lastMessages: Array<{ id: string; role: string; content: string; createdAt: number }>;
}

export interface CookieStoreAdapter {
  getCookieString(): string;
  setCookieString(cookieAssignment: string): void;
}

export const browserCookieAdapter: CookieStoreAdapter = {
  getCookieString() {
    if (typeof document === 'undefined') return '';
    return document.cookie || '';
  },
  setCookieString(cookieAssignment: string) {
    if (typeof document === 'undefined') return;
    document.cookie = cookieAssignment;
  },
};

export function parseCookieMap(cookieString: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieString) return result;
  for (const pair of cookieString.split(';')) {
    const idx = pair.indexOf('=');
    if (idx <= 0) continue;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    result[key] = val;
  }
  return result;
}

export function writeCookieValue(
  name: string,
  value: string,
  adapter: CookieStoreAdapter = browserCookieAdapter,
  maxAgeSeconds = 60 * 60 * 24 * 30
): void {
  const encoded = encodeURIComponent(value);
  adapter.setCookieString(`${name}=${encoded}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax`);
}

export function deleteCookieValue(
  name: string,
  adapter: CookieStoreAdapter = browserCookieAdapter
): void {
  adapter.setCookieString(`${name}=; Path=/; Max-Age=0; SameSite=Lax`);
}

export function writeChunkedCookie(
  prefix: string,
  rawJson: string,
  adapter: CookieStoreAdapter = browserCookieAdapter
): number {
  const encoded = encodeURIComponent(rawJson);
  const existing = parseCookieMap(adapter.getCookieString());
  const oldCount = Number.parseInt(decodeURIComponent(existing[`${prefix}_n`] || '0'), 10) || 0;

  // Cap at max 2 chunks (~5.6KB encoded) to guarantee we never trigger HTTP 431
  const chunks: string[] = [];
  for (let i = 0; i < encoded.length && chunks.length < 2; i += CHUNK_SIZE) {
    chunks.push(encoded.slice(i, i + CHUNK_SIZE));
  }
  if (chunks.length === 0) chunks.push('');

  for (let i = 0; i < chunks.length; i++) {
    adapter.setCookieString(`${prefix}_${i}=${chunks[i]}; Path=/; Max-Age=2592000; SameSite=Lax`);
  }
  adapter.setCookieString(
    `${prefix}_n=${chunks.length}; Path=/; Max-Age=2592000; SameSite=Lax`
  );

  for (let i = chunks.length; i < oldCount; i++) {
    deleteCookieValue(`${prefix}_${i}`, adapter);
  }
  return chunks.length;
}

export function readChunkedCookie(
  prefix: string,
  adapter: CookieStoreAdapter = browserCookieAdapter
): string | null {
  const map = parseCookieMap(adapter.getCookieString());
  const count = Number.parseInt(map[`${prefix}_n`] || '0', 10);
  if (!Number.isFinite(count) || count <= 0) return null;

  let encoded = '';
  for (let i = 0; i < count; i++) {
    const part = map[`${prefix}_${i}`];
    if (part === undefined) return null;
    encoded += part;
  }
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

export function clearLegacyLargeCookies(adapter: CookieStoreAdapter = browserCookieAdapter): void {
  const map = parseCookieMap(adapter.getCookieString());
  for (const key of Object.keys(map)) {
    if (key.startsWith('cf_p_') || key.startsWith('cf_proj_index')) {
      deleteCookieValue(key, adapter);
    }
  }
}

export function saveProjectsToCookies(
  projects: ChatProject[],
  activeProjectId: string | null,
  adapter: CookieStoreAdapter = browserCookieAdapter
): void {
  clearLegacyLargeCookies(adapter);

  const summaries: CookieProjectSummary[] = projects.slice(0, 8).map((p) => ({
    id: p.id,
    roomId: p.roomId,
    name: p.config.name,
    platform: p.config.platform,
    minecraftVersion: p.config.minecraftVersion,
    javaVersion: p.config.javaVersion,
    updatedAt: p.updatedAt,
    lastMessages: p.messages.slice(-3).map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content.slice(0, 140),
      createdAt: m.createdAt,
    })),
  }));

  writeChunkedCookie(PROJECT_META_COOKIE, JSON.stringify(summaries), adapter);
  if (activeProjectId) {
    writeCookieValue(ACTIVE_PROJECT_COOKIE, activeProjectId, adapter);
  }
}

export function loadProjectCookieMeta(
  adapter: CookieStoreAdapter = browserCookieAdapter
): { summaries: CookieProjectSummary[]; activeProjectId: string | null } {
  const map = parseCookieMap(adapter.getCookieString());
  const activeProjectId = map[ACTIVE_PROJECT_COOKIE]
    ? decodeURIComponent(map[ACTIVE_PROJECT_COOKIE])
    : null;

  const metaRaw = readChunkedCookie(PROJECT_META_COOKIE, adapter);
  if (!metaRaw) return { summaries: [], activeProjectId };

  try {
    const summaries = JSON.parse(metaRaw) as CookieProjectSummary[];
    return { summaries: Array.isArray(summaries) ? summaries : [], activeProjectId };
  } catch {
    return { summaries: [], activeProjectId };
  }
}
