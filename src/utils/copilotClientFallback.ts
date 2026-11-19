import {
  COPILOT_TOOL_DEFINITIONS,
  executeWorkspaceTool,
  extractThinkingFromContent,
  type WorkspaceMutableState,
} from './agentTools';
import type {
  ChatMessage,
  ThinkingEffort,
  ToolCallRecord,
  VisionAttachment,
} from '../types/ide';

export function prepareCompactMessagesForApi(
  messages: ChatMessage[],
  maxHistory = 16
): Array<Pick<ChatMessage, 'id' | 'role' | 'content' | 'images' | 'createdAt'>> {
  const recent = messages.slice(-maxHistory);
  return recent.map((m, idx) => {
    const isLast = idx === recent.length - 1;
    return {
      id: m.id,
      role: m.role,
      content: m.content,
      images: isLast ? m.images : undefined,
      createdAt: m.createdAt,
    };
  });
}

export async function runDirectCopilotModelsFallback(params: {
  githubToken: string;
  userLogin: string;
  model: string;
  thinkingEnabled: boolean;
  thinkingEffort: ThinkingEffort;
  messages: ChatMessage[];
  images: VisionAttachment[];
  projectContext: WorkspaceMutableState;
}): Promise<{ message: ChatMessage; updatedWorkspace: WorkspaceMutableState }> {
  const {
    githubToken,
    userLogin,
    model,
    thinkingEnabled,
    thinkingEffort,
    messages,
    images,
    projectContext,
  } = params;

  let workingState: WorkspaceMutableState = {
    config: { ...projectContext.config },
    files: { ...projectContext.files },
    folders: [...(projectContext.folders || [])],
  };

  const systemPrompt = `Você é o Agente Especialista em Minecraft Gradle do CraftForge Studio (via GitHub Copilot).
Você domina TODAS as versões do Minecraft (1.7.10 até 1.21.5+) e TODAS as versões do Java (Java 8 até Java 24), exclusivamente usando Gradle.

Projeto atual:
- Nome: ${workingState.config.name}
- Plataforma: ${workingState.config.platform}
- Minecraft: ${workingState.config.minecraftVersion}
- Java Toolchain: Java ${workingState.config.javaVersion}
- Gradle: ${workingState.config.gradleVersion} (${workingState.config.dsl})
- Arquivos: ${Object.keys(workingState.files).join(', ')}

Regras:
1. Use as tools (list_files, read_file, write_file, create_folder, delete_path, configure_gradle_project, validate_gradle_setup) sempre que precisar modificar arquivos.
2. Nunca use Maven (pom.xml) — apenas Gradle.
3. Responda em português.${
    thinkingEnabled
      ? `\n4. Estruture seu raciocínio em <think>...</think> com profundidade "${thinkingEffort}".`
      : ''
  }`;

  const apiMessages: Array<Record<string, unknown>> = [{ role: 'system', content: systemPrompt }];
  const compact = prepareCompactMessagesForApi(messages);

  for (let i = 0; i < compact.length; i++) {
    const m = compact[i];
    if (m.role === 'system') continue;
    const isLastUser = i === compact.length - 1 && m.role === 'user';
    const attached = isLastUser && images.length > 0 ? images : m.images || [];
    if (m.role === 'user' && attached.length > 0) {
      apiMessages.push({
        role: 'user',
        content: [
          { type: 'text', text: m.content || 'Analise a imagem no contexto do projeto Minecraft.' },
          ...attached.map((img) => ({ type: 'image_url', image_url: { url: img.dataUrl } })),
        ],
      });
    } else {
      apiMessages.push({ role: m.role, content: m.content });
    }
  }

  const executedToolCalls: ToolCallRecord[] = [];
  let finalContent = '';
  let finalThinking = '';

  for (let round = 0; round < 4; round++) {
    let resp: Response;
    try {
      resp = await fetch('https://models.github.ai/inference/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${githubToken}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({
          model,
          messages: apiMessages,
          tools: COPILOT_TOOL_DEFINITIONS,
          tool_choice: 'auto',
        }),
        signal: AbortSignal.timeout(45000),
      });
    } catch {
      const shortModel = model.includes('/') ? model.split('/')[1] : model;
      resp = await fetch('https://models.inference.ai.azure.com/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${githubToken}`,
        },
        body: JSON.stringify({
          model: shortModel,
          messages: apiMessages,
          tools: COPILOT_TOOL_DEFINITIONS,
          tool_choice: 'auto',
        }),
        signal: AbortSignal.timeout(45000),
      });
    }

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(
        `GitHub Models HTTP ${resp.status}: ${
          errText.slice(0, 220) || 'Verifique se o seu GitHub Token possui permissão models:read.'
        }`
      );
    }

    const data = (await resp.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          reasoning_content?: string | null;
          tool_calls?: Array<{
            id: string;
            type: string;
            function: { name: string; arguments: string };
          }>;
        };
      }>;
    };

    const choiceMsg = data.choices?.[0]?.message;
    if (!choiceMsg) {
      throw new Error('Resposta vazia do GitHub Models API.');
    }

    const parsed = extractThinkingFromContent(
      choiceMsg.content || '',
      choiceMsg.reasoning_content || undefined
    );
    if (parsed.thinking) {
      finalThinking = finalThinking ? `${finalThinking}\n\n${parsed.thinking}` : parsed.thinking;
    }

    const toolCalls = choiceMsg.tool_calls;
    if (toolCalls && toolCalls.length > 0) {
      apiMessages.push({
        role: 'assistant',
        content: choiceMsg.content || '',
        tool_calls: toolCalls,
      });
      for (const tc of toolCalls) {
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>;
        } catch {
          parsedArgs = {};
        }
        const exec = executeWorkspaceTool(
          workingState,
          tc.id,
          tc.function.name,
          parsedArgs,
          userLogin
        );
        workingState = exec.state;
        executedToolCalls.push(exec.record);
        apiMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: exec.record.result,
        });
      }
      continue;
    }

    finalContent = parsed.content;
    break;
  }

  if (!finalContent && executedToolCalls.length > 0) {
    finalContent = 'Alterações aplicadas no projeto via ferramentas do agente.';
  }

  return {
    message: {
      id: `msg_${Date.now()}`,
      role: 'assistant',
      content: finalContent,
      thinking: thinkingEnabled ? finalThinking : undefined,
      toolCalls: executedToolCalls.length > 0 ? executedToolCalls : undefined,
      model,
      createdAt: Date.now(),
    },
    updatedWorkspace: workingState,
  };
}
