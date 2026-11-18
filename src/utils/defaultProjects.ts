import type { ChatProject, GitHubUser, ProjectConfig } from '../types/ide';
import { generateGradleProjectFiles } from './gradleEngine';

export function createStarterProject(
  owner?: GitHubUser | null,
  overrides?: Partial<ProjectConfig>
): ChatProject {
  const now = Date.now();
  const config: ProjectConfig = {
    name: 'ArenaPvPPlugin',
    platform: 'paper',
    minecraftVersion: '1.21.4',
    javaVersion: 21,
    gradleVersion: '8.11.1',
    dsl: 'groovy',
    groupId: 'com.craftforge.arenapvp',
    artifactId: 'arenapvp-plugin',
    version: '1.0.0',
    mainClass: 'ArenaPvPPlugin',
    description: 'Plugin Paper/Gradle criado no CraftForge Studio',
    dependencies: ['net.kyori:adventure-text-minimessage:4.17.0'],
    ...overrides,
  };

  const { files, folders } = generateGradleProjectFiles(config);
  const firstOpen = Object.keys(files).find((f) => f.endsWith('.java')) || 'build.gradle';

  return {
    id: `proj_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    roomId: `room_${Math.random().toString(36).slice(2, 8)}`,
    config,
    files,
    folders,
    messages: [
      {
        id: `msg_${now}`,
        role: 'assistant',
        content:
          'Projeto Gradle inicializado. Posso editar arquivos, criar módulos Java, adicionar dependências no `build.gradle` ou reconfigurar qualquer versão de Minecraft e Java via Tools, Vision e Thinking.',
        model: 'openai/gpt-4.1',
        createdAt: now,
      },
    ],
    collaborators: owner
      ? [
          {
            login: owner.login,
            name: owner.name,
            avatar_url: owner.avatar_url,
            role: 'owner',
            online: true,
            addedAt: now,
          },
        ]
      : [],
    openTabs: ['build.gradle', firstOpen].filter((v, i, arr) => arr.indexOf(v) === i && files[v]),
    activeFile: firstOpen,
    createdAt: now,
    updatedAt: now,
  };
}
