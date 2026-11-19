import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearAuthCookies,
  loadAuthCookies,
  loadProjectCookieMeta,
  saveAuthCookies,
  saveProjectsToCookies,
  type CookieStoreAdapter,
} from './cookieStorage';
import { createStarterProject } from './defaultProjects';

function createMemoryCookieAdapter(): CookieStoreAdapter {
  const jar = new Map<string, string>();
  return {
    getCookieString() {
      return Array.from(jar.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
    },
    setCookieString(assignment: string) {
      const firstSemi = assignment.indexOf(';');
      const pair = firstSemi === -1 ? assignment : assignment.slice(0, firstSemi);
      const eq = pair.indexOf('=');
      if (eq <= 0) return;
      const key = pair.slice(0, eq).trim();
      const val = pair.slice(eq + 1).trim();
      if (assignment.includes('Max-Age=0')) {
        jar.delete(key);
      } else {
        jar.set(key, val);
      }
    },
  };
}

test('saves and restores compact ChatProject summaries and active ID via cookies without header bloat', () => {
  const adapter = createMemoryCookieAdapter();
  const projA = createStarterProject(null, { name: 'FactionsCore', minecraftVersion: '1.8.9', javaVersion: 8 });
  const projB = createStarterProject(null, { name: 'LunarPvPClient', platform: 'pvp-client', minecraftVersion: '1.21.4', javaVersion: 21 });

  saveProjectsToCookies([projA, projB], projB.id, adapter);
  const loaded = loadProjectCookieMeta(adapter);

  assert.equal(loaded.activeProjectId, projB.id);
  assert.equal(loaded.summaries.length, 2);
  assert.equal(loaded.summaries[0].name, 'FactionsCore');
  assert.equal(loaded.summaries[1].platform, 'pvp-client');
  assert.ok(adapter.getCookieString().length < 4096);
});

test('saves and restores persistent login token, sessionId, and GitHub user via cookies', () => {
  const adapter = createMemoryCookieAdapter();
  saveAuthCookies(
    {
      sessionId: 'sid-12345',
      token: 'ghp_examplePersistentToken123456',
      user: {
        id: 42,
        login: 'NotchDev',
        name: 'Notch',
        avatar_url: 'https://avatars.githubusercontent.com/u/42',
      },
    },
    adapter
  );

  const restored = loadAuthCookies(adapter);
  assert.equal(restored.sessionId, 'sid-12345');
  assert.equal(restored.token, 'ghp_examplePersistentToken123456');
  assert.equal(restored.user?.login, 'NotchDev');

  // Sandbox autostart tokens must NOT overwrite real login cookies
  saveAuthCookies(
    {
      sessionId: 'sb-sid',
      token: 'sandbox-autostart-token',
      user: { id: 9, login: 'craftforge-dev', name: 'Sandbox', avatar_url: '', isSandbox: true },
    },
    adapter
  );
  const afterSandbox = loadAuthCookies(adapter);
  assert.equal(afterSandbox.token, 'ghp_examplePersistentToken123456');
  assert.equal(afterSandbox.user?.login, 'NotchDev');

  clearAuthCookies(adapter);
  const cleared = loadAuthCookies(adapter);
  assert.equal(cleared.sessionId, null);
  assert.equal(cleared.token, null);
  assert.equal(cleared.user, null);
});
