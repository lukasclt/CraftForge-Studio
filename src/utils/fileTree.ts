import type { FileTreeNode, VirtualFile } from '../types/ide';

export function normalizePath(rawPath: string): string {
  return rawPath
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

export function getParentFolder(path: string): string {
  const norm = normalizePath(path);
  const idx = norm.lastIndexOf('/');
  return idx === -1 ? '' : norm.slice(0, idx);
}

export function getLanguageFromPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.java')) return 'java';
  if (lower.endsWith('.gradle') || lower.endsWith('.groovy')) return 'groovy';
  if (lower.endsWith('.kts') || lower.endsWith('.kt')) return 'kotlin';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'yaml';
  if (lower.endsWith('.toml')) return 'toml';
  if (lower.endsWith('.properties')) return 'properties';
  if (lower.endsWith('.md')) return 'markdown';
  if (lower.endsWith('.sh') || lower.endsWith('gradlew')) return 'shell';
  return 'plaintext';
}

export function buildFileTree(
  files: Record<string, VirtualFile>,
  folders: string[]
): FileTreeNode[] {
  const rootMap = new Map<string, FileTreeNode>();

  const ensureFolder = (folderPath: string): FileTreeNode | null => {
    const norm = normalizePath(folderPath);
    if (!norm) return null;
    if (rootMap.has(norm)) return rootMap.get(norm)!;

    const parts = norm.split('/');
    let currentPath = '';
    let lastNode: FileTreeNode | null = null;

    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      let node = rootMap.get(currentPath);
      if (!node) {
        node = {
          name: part,
          path: currentPath,
          type: 'folder',
          children: [],
        };
        rootMap.set(currentPath, node);
        if (lastNode) {
          lastNode.children!.push(node);
        }
      }
      lastNode = node;
    }
    return lastNode;
  };

  for (const folder of folders) {
    ensureFolder(folder);
  }

  for (const filePath of Object.keys(files)) {
    const norm = normalizePath(filePath);
    if (!norm) continue;
    const parent = getParentFolder(norm);
    const fileName = norm.slice(parent ? parent.length + 1 : 0);
    const fileNode: FileTreeNode = {
      name: fileName,
      path: norm,
      type: 'file',
    };

    if (parent) {
      const parentNode = ensureFolder(parent);
      if (parentNode && !parentNode.children!.some((c) => c.path === norm)) {
        parentNode.children!.push(fileNode);
      }
    } else if (!rootMap.has(norm)) {
      rootMap.set(norm, fileNode);
    }
  }

  const topLevel: FileTreeNode[] = [];
  for (const node of rootMap.values()) {
    if (!node.path.includes('/')) {
      topLevel.push(node);
    }
  }

  const sortNodes = (nodes: FileTreeNode[]): FileTreeNode[] => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      if (node.children) sortNodes(node.children);
    }
    return nodes;
  };

  return sortNodes(topLevel);
}

export function deletePathFromWorkspace(
  files: Record<string, VirtualFile>,
  folders: string[],
  targetPath: string
): { files: Record<string, VirtualFile>; folders: string[] } {
  const norm = normalizePath(targetPath);
  const nextFiles: Record<string, VirtualFile> = {};
  for (const [key, val] of Object.entries(files)) {
    const kNorm = normalizePath(key);
    if (kNorm !== norm && !kNorm.startsWith(`${norm}/`)) {
      nextFiles[key] = val;
    }
  }
  const nextFolders = folders.filter((f) => {
    const fNorm = normalizePath(f);
    return fNorm !== norm && !fNorm.startsWith(`${norm}/`);
  });
  return { files: nextFiles, folders: nextFolders };
}

export function renamePathInWorkspace(
  files: Record<string, VirtualFile>,
  folders: string[],
  oldPath: string,
  newPath: string
): { files: Record<string, VirtualFile>; folders: string[] } {
  const from = normalizePath(oldPath);
  const to = normalizePath(newPath);
  if (!from || !to || from === to) return { files, folders };

  const nextFiles: Record<string, VirtualFile> = {};
  for (const [key, val] of Object.entries(files)) {
    const kNorm = normalizePath(key);
    if (kNorm === from) {
      nextFiles[to] = { ...val, path: to, updatedAt: Date.now() };
    } else if (kNorm.startsWith(`${from}/`)) {
      const updated = `${to}${kNorm.slice(from.length)}`;
      nextFiles[updated] = { ...val, path: updated, updatedAt: Date.now() };
    } else {
      nextFiles[key] = val;
    }
  }

  const folderSet = new Set<string>();
  for (const folder of folders) {
    const fNorm = normalizePath(folder);
    if (fNorm === from) {
      folderSet.add(to);
    } else if (fNorm.startsWith(`${from}/`)) {
      folderSet.add(`${to}${fNorm.slice(from.length)}`);
    } else {
      folderSet.add(fNorm);
    }
  }

  return { files: nextFiles, folders: Array.from(folderSet).sort() };
}
