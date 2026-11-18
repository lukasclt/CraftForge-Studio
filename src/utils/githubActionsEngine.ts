import type { GitHubBuildRun, ProjectConfig } from '../types/ide';

export const WORKFLOW_FILE_PATH = '.github/workflows/gradle-build.yml';

export function generateGradleWorkflowYaml(config: ProjectConfig): string {
  const isShadowPlatform =
    config.platform === 'paper' || config.platform === 'spigot' || config.platform === 'velocity';
  const buildCommand = isShadowPlatform
    ? 'gradle shadowJar build --no-daemon --stacktrace'
    : 'gradle build --no-daemon --stacktrace';

  return `name: CraftForge Gradle Build

on:
  push:
    branches: [ main, master ]
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Java ${config.javaVersion}
        uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '${config.javaVersion}'

      - name: Setup Gradle ${config.gradleVersion}
        uses: gradle/actions/setup-gradle@v4
        with:
          gradle-version: '${config.gradleVersion}'

      - name: Build ${config.name} (${config.minecraftVersion})
        run: ${buildCommand}

      - name: Upload Compiled JAR Artifact
        uses: actions/upload-artifact@v4
        with:
          name: minecraft-build-jar
          path: |
            build/libs/*.jar
            !build/libs/*-sources.jar
            !build/libs/*-dev.jar
          if-no-files-found: warn
`;
}

export function extractRelevantGradleErrors(rawLogs: string, maxChars = 3500): string {
  if (!rawLogs || !rawLogs.trim()) {
    return 'Logs detalhados não disponíveis no job do GitHub Actions.';
  }
  const lines = rawLogs.split(/\r?\n/);
  const important: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (
      /error:|FAILURE:|Execution failed|Compilation failed|Exception|Could not resolve|cannot find symbol|package .* does not exist|Task .* FAILED/i.test(
        line
      )
    ) {
      const start = Math.max(0, i - 1);
      const end = Math.min(lines.length, i + 4);
      for (let j = start; j < end; j++) {
        if (!important.includes(lines[j])) {
          important.push(lines[j]);
        }
      }
    }
  }

  const output =
    important.length > 0 ? important.join('\n') : lines.slice(-60).join('\n');
  if (output.length <= maxChars) return output;
  return output.slice(output.length - maxChars);
}

export function shouldTriggerAutoFix(
  run: GitHubBuildRun | null,
  autoFixEnabled: boolean,
  consecutiveRetries: number,
  maxRetries = 3
): boolean {
  if (!run || !autoFixEnabled) return false;
  if (run.status !== 'completed') return false;
  if (run.conclusion !== 'failure') return false;
  return consecutiveRetries < maxRetries;
}

export function shouldTriggerAutoDownload(
  run: GitHubBuildRun | null,
  autoDownloadEnabled: boolean,
  alreadyDownloadedRunIds: Set<number>
): boolean {
  if (!run || !autoDownloadEnabled) return false;
  if (run.status !== 'completed' || run.conclusion !== 'success') return false;
  if (alreadyDownloadedRunIds.has(run.id)) return false;
  return Boolean(run.artifacts && run.artifacts.length > 0);
}
