import test from 'node:test';
import assert from 'node:assert/strict';
import { executeWorkspaceTool, extractThinkingFromContent } from './agentTools';
import { prepareCompactMessagesForApi } from './copilotClientFallback';
import { createStarterProject } from './defaultProjects';

test('executes write_file, read_file, create_folder, delete_path, and configure_gradle_project tools', () => {
  const starter = createStarterProject(null);
  let state = { config: starter.config, files: starter.files, folders: starter.folders };

  const folderRes = executeWorkspaceTool(state, 't1', 'create_folder', { path: 'src/main/java/custom' });
  state = folderRes.state;
  assert.equal(folderRes.record.status, 'ok');
  assert.ok(state.folders.includes('src/main/java/custom'));

  const writeRes = executeWorkspaceTool(state, 't2', 'write_file', {
    path: 'src/main/java/custom/SwordAbility.java',
    content: 'public class SwordAbility {}',
  });
  state = writeRes.state;
  assert.equal(writeRes.record.status, 'ok');
  assert.equal(state.files['src/main/java/custom/SwordAbility.java'].content, 'public class SwordAbility {}');

  const readRes = executeWorkspaceTool(state, 't3', 'read_file', {
    path: 'src/main/java/custom/SwordAbility.java',
  });
  assert.equal(readRes.record.result, 'public class SwordAbility {}');

  const configRes = executeWorkspaceTool(state, 't4', 'configure_gradle_project', {
    platform: 'pvp-client',
    minecraftVersion: '1.8.9',
    javaVersion: 8,
    regenerateScaffold: true,
  });
  state = configRes.state;
  assert.equal(state.config.platform, 'pvp-client');
  assert.equal(state.config.minecraftVersion, '1.8.9');
  assert.equal(state.config.javaVersion, 8);

  const delRes = executeWorkspaceTool(state, 't5', 'delete_path', { path: 'src/main/java/custom' });
  state = delRes.state;
  assert.equal(state.files['src/main/java/custom/SwordAbility.java'], undefined);
});

test('extracts think blocks and reasoning_content cleanly', () => {
  const parsed = extractThinkingFromContent(
    '<think>Step 1: check build.gradle</think>\nArquivo atualizado com sucesso.',
    'Extra reasoning'
  );
  assert.equal(parsed.content, 'Arquivo atualizado com sucesso.');
  assert.match(parsed.thinking, /Extra reasoning/);
  assert.match(parsed.thinking, /Step 1: check build\.gradle/);
});

test('prepareCompactMessagesForApi strips historical base64 images and caps history', () => {
  const sampleImg = {
    id: 'img1',
    name: 'crash.png',
    mimeType: 'image/png',
    dataUrl: 'data:image/png;base64,AAAA',
  };
  const messages = Array.from({ length: 20 }, (_, i) => ({
    id: `m_${i}`,
    role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
    content: `msg ${i}`,
    images: i === 0 || i === 19 ? [sampleImg] : undefined,
    createdAt: 1000 + i,
  }));

  const compacted = prepareCompactMessagesForApi(messages, 16);
  assert.equal(compacted.length, 16);
  assert.equal(compacted[0].id, 'm_4');
  assert.equal(compacted[0].images, undefined);
  assert.equal(compacted[15].id, 'm_19');
  assert.equal(compacted[15].images?.length, 1);
});
