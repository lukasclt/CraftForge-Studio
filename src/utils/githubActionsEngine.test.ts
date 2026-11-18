import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WORKFLOW_FILE_PATH,
  extractRelevantGradleErrors,
  generateGradleWorkflowYaml,
  shouldTriggerAutoDownload,
  shouldTriggerAutoFix,
} from './githubActionsEngine';
import { createStarterProject } from './defaultProjects';

test('generates valid GitHub Actions Gradle workflow for Java and Gradle versions', () => {
  const proj = createStarterProject(null, {
    name: 'PvPCore',
    platform: 'paper',
    minecraftVersion: '1.21.4',
    javaVersion: 21,
    gradleVersion: '8.11.1',
  });
  const yaml = generateGradleWorkflowYaml(proj.config);
  assert.equal(WORKFLOW_FILE_PATH, '.github/workflows/gradle-build.yml');
  assert.match(yaml, /java-version: '21'/);
  assert.match(yaml, /gradle-version: '8\.11\.1'/);
  assert.match(yaml, /gradle shadowJar build/);
  assert.match(yaml, /minecraft-build-jar/);
});

test('extracts Gradle compilation errors cleanly from verbose CI logs', () => {
  const verbose = [
    '2026-11-18T10:00:00Z Starting Gradle Daemon...',
    '2026-11-18T10:00:02Z > Task :compileJava FAILED',
    '2026-11-18T10:00:02Z /src/Main.java:14: error: cannot find symbol',
    '2026-11-18T10:00:02Z   symbol: class MissingClass',
    '2026-11-18T10:00:03Z FAILURE: Build failed with an exception.',
  ].join('\n');

  const excerpt = extractRelevantGradleErrors(verbose);
  assert.match(excerpt, /error: cannot find symbol/);
  assert.match(excerpt, /FAILURE: Build failed/);
});

test('auto-fix and auto-download guards enforce retry limits and deduplication', () => {
  const failedRun = {
    id: 101,
    status: 'completed' as const,
    conclusion: 'failure' as const,
    htmlUrl: 'https://github.com/u/r/actions/runs/101',
    createdAt: '2026-11-18T10:00:00Z',
  };
  assert.equal(shouldTriggerAutoFix(failedRun, true, 0), true);
  assert.equal(shouldTriggerAutoFix(failedRun, true, 3), false);
  assert.equal(shouldTriggerAutoFix(failedRun, false, 0), false);

  const successRun = {
    id: 102,
    status: 'completed' as const,
    conclusion: 'success' as const,
    htmlUrl: 'https://github.com/u/r/actions/runs/102',
    createdAt: '2026-11-18T10:01:00Z',
    artifacts: [{ id: 55, name: 'minecraft-build-jar', sizeInBytes: 2048, downloadUrl: '/api/x' }],
  };
  const downloaded = new Set<number>();
  assert.equal(shouldTriggerAutoDownload(successRun, true, downloaded), true);
  downloaded.add(102);
  assert.equal(shouldTriggerAutoDownload(successRun, true, downloaded), false);
});
