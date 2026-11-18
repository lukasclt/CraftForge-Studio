import type { ProjectConfig, ProjectPlatform, JavaVersion, ToolCallRecord, VirtualFile } from '../types/ide';
import {
  generateGradleProjectFiles,
  getRecommendedGradleForJava,
  validateGradleSetup,
} from './gradleEngine';
import { deletePathFromWorkspace, getParentFolder, normalizePath } from './fileTree';

export interface WorkspaceMutableState {
  config: ProjectConfig;
  files: Record<string, VirtualFile>;
  folders: string[];
}

export const COPILOT_TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'Lista todos os arquivos e pastas atuais do projeto Minecraft Gradle.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Lê o conteúdo completo de um arquivo do projeto pelo caminho relativo.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Caminho relativo do arquivo (ex: build.gradle)' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Cria ou atualiza um arquivo Java, Gradle, YAML, JSON ou resource no projeto.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Caminho relativo do arquivo' },
          content: { type: 'string', description: 'Conteúdo completo do arquivo' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_folder',
      description: 'Cria uma nova pasta no explorador de arquivos do projeto.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Caminho relativo da pasta' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_path',
      description: 'Remove um arquivo ou pasta do projeto.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Caminho relativo a remover' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'configure_gradle_project',
      description:
        'Altera plataforma (paper, spigot, velocity, fabric, forge, neoforge, pvp-client), versão do Minecraft (ex: 1.8.9, 1.21.4), versão do Java (8, 11, 16, 17, 21, 22, 23, 24) ou DSL Gradle e atualiza build.gradle.',
      parameters: {
        type: 'object',
        properties: {
          platform: {
            type: 'string',
            enum: ['paper', 'spigot', 'velocity', 'fabric', 'forge', 'neoforge', 'pvp-client'],
          },
          minecraftVersion: { type: 'string' },
          javaVersion: { type: 'number', enum: [8, 11, 16, 17, 21, 22, 23, 24] },
          dsl: { type: 'string', enum: ['groovy', 'kotlin'] },
          regenerateScaffold: {
            type: 'boolean',
            description: 'Se true, regenera todos os arquivos base do template Gradle',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'validate_gradle_setup',
      description: 'Valida compatibilidade entre Minecraft, Java Toolchain e arquivos Gradle.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
];

export function executeWorkspaceTool(
  state: WorkspaceMutableState,
  toolId: string,
  name: string,
  args: Record<string, unknown>,
  authorLogin = 'copilot-agent'
): { record: ToolCallRecord; state: WorkspaceMutableState } {
  const now = Date.now();
  try {
    if (name === 'list_files') {
      const filesList = Object.keys(state.files).sort();
      return {
        state,
        record: {
          id: toolId,
          name,
          args,
          status: 'ok',
          result: JSON.stringify({ files: filesList, folders: state.folders }),
        },
      };
    }

    if (name === 'read_file') {
      const path = normalizePath(String(args.path || ''));
      const file = state.files[path];
      if (!file) {
        return {
          state,
          record: {
            id: toolId,
            name,
            args,
            status: 'error',
            result: `Arquivo não encontrado: ${path}`,
          },
        };
      }
      return {
        state,
        record: {
          id: toolId,
          name,
          args,
          status: 'ok',
          affectedPath: path,
          result: file.content,
        },
      };
    }

    if (name === 'write_file') {
      const path = normalizePath(String(args.path || ''));
      const content = String(args.content ?? '');
      if (!path) {
        return {
          state,
          record: { id: toolId, name, args, status: 'error', result: 'Caminho inválido.' },
        };
      }
      const nextFolders = new Set(state.folders);
      const parent = getParentFolder(path);
      if (parent) {
        const parts = parent.split('/');
        for (let i = 1; i <= parts.length; i++) {
          nextFolders.add(parts.slice(0, i).join('/'));
        }
      }
      const nextState: WorkspaceMutableState = {
        ...state,
        folders: Array.from(nextFolders).sort(),
        files: {
          ...state.files,
          [path]: { path, content, updatedAt: now, updatedBy: authorLogin },
        },
      };
      return {
        state: nextState,
        record: {
          id: toolId,
          name,
          args: { path, bytes: content.length },
          status: 'ok',
          affectedPath: path,
          result: `Arquivo salvo em ${path} (${content.length} caracteres).`,
        },
      };
    }

    if (name === 'create_folder') {
      const path = normalizePath(String(args.path || ''));
      if (!path) {
        return {
          state,
          record: { id: toolId, name, args, status: 'error', result: 'Caminho de pasta inválido.' },
        };
      }
      const nextFolders = new Set(state.folders);
      const parts = path.split('/');
      for (let i = 1; i <= parts.length; i++) {
        nextFolders.add(parts.slice(0, i).join('/'));
      }
      return {
        state: { ...state, folders: Array.from(nextFolders).sort() },
        record: {
          id: toolId,
          name,
          args,
          status: 'ok',
          affectedPath: path,
          result: `Pasta criada: ${path}`,
        },
      };
    }

    if (name === 'delete_path') {
      const path = normalizePath(String(args.path || ''));
      const deleted = deletePathFromWorkspace(state.files, state.folders, path);
      return {
        state: { ...state, files: deleted.files, folders: deleted.folders },
        record: {
          id: toolId,
          name,
          args,
          status: 'ok',
          affectedPath: path,
          result: `Removido do workspace: ${path}`,
        },
      };
    }

    if (name === 'configure_gradle_project') {
      const platform = (args.platform as ProjectPlatform) || state.config.platform;
      const minecraftVersion = String(args.minecraftVersion || state.config.minecraftVersion);
      const javaVersion = (Number(args.javaVersion) as JavaVersion) || state.config.javaVersion;
      const dsl = (args.dsl as 'groovy' | 'kotlin') || state.config.dsl;
      const gradleVersion = getRecommendedGradleForJava(javaVersion, platform, minecraftVersion);

      const nextConfig: ProjectConfig = {
        ...state.config,
        platform,
        minecraftVersion,
        javaVersion,
        dsl,
        gradleVersion,
      };

      const generated = generateGradleProjectFiles(nextConfig);
      const nextFiles = args.regenerateScaffold
        ? generated.files
        : {
            ...state.files,
            ...(generated.files['build.gradle'] ? { 'build.gradle': generated.files['build.gradle'] } : {}),
            ...(generated.files['build.gradle.kts']
              ? { 'build.gradle.kts': generated.files['build.gradle.kts'] }
              : {}),
            'gradle.properties': generated.files['gradle.properties'],
            'gradle/wrapper/gradle-wrapper.properties':
              generated.files['gradle/wrapper/gradle-wrapper.properties'],
          };

      return {
        state: {
          config: nextConfig,
          files: nextFiles,
          folders: Array.from(new Set([...state.folders, ...generated.folders])).sort(),
        },
        record: {
          id: toolId,
          name,
          args,
          status: 'ok',
          affectedPath: nextConfig.dsl === 'kotlin' ? 'build.gradle.kts' : 'build.gradle',
          result: `Projeto Gradle reconfigurado: ${platform} · MC ${minecraftVersion} · Java ${javaVersion} · Gradle ${gradleVersion}.`,
        },
      };
    }

    if (name === 'validate_gradle_setup') {
      const validation = validateGradleSetup(state.config, state.files);
      return {
        state,
        record: {
          id: toolId,
          name,
          args,
          status: validation.valid ? 'ok' : 'error',
          result: JSON.stringify(validation),
        },
      };
    }

    return {
      state,
      record: { id: toolId, name, args, status: 'error', result: `Tool desconhecida: ${name}` },
    };
  } catch (err) {
    return {
      state,
      record: {
        id: toolId,
        name,
        args,
        status: 'error',
        result: err instanceof Error ? err.message : 'Erro interno ao executar tool.',
      },
    };
  }
}

export function extractThinkingFromContent(
  rawContent: string,
  reasoningContent?: string
): { content: string; thinking: string } {
  const thinkBlocks: string[] = [];
  if (reasoningContent && reasoningContent.trim()) {
    thinkBlocks.push(reasoningContent.trim());
  }

  let cleaned = rawContent || '';
  const regex = /<think>([\s\S]*?)<\/think>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(cleaned)) !== null) {
    if (match[1]?.trim()) {
      thinkBlocks.push(match[1].trim());
    }
  }
  cleaned = cleaned.replace(regex, '').trim();

  return {
    content: cleaned,
    thinking: thinkBlocks.join('\n\n'),
  };
}
