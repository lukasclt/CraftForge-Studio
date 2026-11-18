export type ProjectPlatform =
  | 'paper'
  | 'spigot'
  | 'velocity'
  | 'fabric'
  | 'forge'
  | 'neoforge'
  | 'pvp-client';

export type JavaVersion = 8 | 11 | 16 | 17 | 21 | 22 | 23 | 24;

export type GradleDsl = 'groovy' | 'kotlin';

export type ThinkingEffort = 'low' | 'medium' | 'high';

export interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
  html_url?: string;
  isSandbox?: boolean;
}

export interface ProjectConfig {
  name: string;
  platform: ProjectPlatform;
  minecraftVersion: string;
  javaVersion: JavaVersion;
  gradleVersion: string;
  dsl: GradleDsl;
  groupId: string;
  artifactId: string;
  version: string;
  mainClass: string;
  description: string;
  dependencies: string[];
}

export interface VirtualFile {
  path: string;
  content: string;
  updatedAt: number;
  updatedBy?: string;
}

export interface VisionAttachment {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result: string;
  status: 'ok' | 'error';
  affectedPath?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thinking?: string;
  images?: VisionAttachment[];
  toolCalls?: ToolCallRecord[];
  authorLogin?: string;
  authorAvatar?: string;
  model?: string;
  createdAt: number;
  isError?: boolean;
}

export interface Collaborator {
  login: string;
  name: string | null;
  avatar_url: string;
  role: 'owner' | 'collaborator';
  online?: boolean;
  addedAt: number;
}

export interface GitHubActionsConfig {
  repoFullName: string;
  branch: string;
  autoBuildOnChange: boolean;
  autoFixErrors: boolean;
  autoDownloadJar: boolean;
}

export interface GitHubBuildArtifact {
  id: number;
  name: string;
  sizeInBytes: number;
  downloadUrl: string;
}

export interface GitHubBuildStep {
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: string | null;
}

export interface GitHubBuildRun {
  id: number;
  status: 'queued' | 'in_progress' | 'completed' | 'error';
  conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | null;
  htmlUrl: string;
  commitSha?: string;
  createdAt: string;
  logsExcerpt?: string;
  liveLogs?: string;
  steps?: GitHubBuildStep[];
  artifacts?: GitHubBuildArtifact[];
  autoFixAttempt?: number;
}

export interface CopilotUsageState {
  used: number;
  limit: number;
  remaining: number;
  warningsShown: number;
  maxWarnings: number;
  resetAt: number;
  source: 'quota' | 'github-headers';
}

export interface CopilotLowLimitWarning {
  id: string;
  warningNumber: number;
  maxWarnings: number;
  remaining: number;
  message: string;
  createdAt: number;
}

export interface ChatProject {
  id: string;
  roomId: string;
  config: ProjectConfig;
  githubActions?: GitHubActionsConfig;
  files: Record<string, VirtualFile>;
  folders: string[];
  messages: ChatMessage[];
  collaborators: Collaborator[];
  openTabs: string[];
  activeFile: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface GradleDiagnostic {
  level: 'ok' | 'warning' | 'error';
  code: string;
  message: string;
  suggestion?: string;
}

export interface GradleValidationResult {
  valid: boolean;
  recommendedJava: JavaVersion;
  recommendedGradle: string;
  diagnostics: GradleDiagnostic[];
}

export interface FileTreeNode {
  name: string;
  path: string;
  type: 'folder' | 'file';
  children?: FileTreeNode[];
}
