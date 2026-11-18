import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFileTree,
  deletePathFromWorkspace,
  getLanguageFromPath,
  normalizePath,
  renamePathInWorkspace,
} from './fileTree';
import type { VirtualFile } from '../types/ide';

test('normalizes paths and detects languages', () => {
  assert.equal(normalizePath('/src\\main//Main.java/'), 'src/main/Main.java');
  assert.equal(getLanguageFromPath('build.gradle.kts'), 'kotlin');
  assert.equal(getLanguageFromPath('build.gradle'), 'groovy');
  assert.equal(getLanguageFromPath('Main.java'), 'java');
});

test('builds sorted file tree and handles recursive folder delete and rename', () => {
  const files: Record<string, VirtualFile> = {
    'build.gradle': { path: 'build.gradle', content: '', updatedAt: 1 },
    'src/main/java/App.java': { path: 'src/main/java/App.java', content: 'class App {}', updatedAt: 1 },
    'src/main/resources/plugin.yml': { path: 'src/main/resources/plugin.yml', content: 'name: Test', updatedAt: 1 },
  };
  const folders = ['src', 'src/main', 'src/main/java', 'src/main/resources', 'empty-folder'];

  const tree = buildFileTree(files, folders);
  assert.equal(tree[0].type, 'folder');
  assert.equal(tree[tree.length - 1].name, 'build.gradle');

  const renamed = renamePathInWorkspace(files, folders, 'src/main/java', 'src/main/kotlin');
  assert.ok(renamed.files['src/main/kotlin/App.java']);
  assert.equal(renamed.files['src/main/java/App.java'], undefined);

  const deleted = deletePathFromWorkspace(renamed.files, renamed.folders, 'src/main/kotlin');
  assert.equal(deleted.files['src/main/kotlin/App.java'], undefined);
  assert.ok(deleted.files['src/main/resources/plugin.yml']);
});
