import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadProjectCookieMeta,
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
