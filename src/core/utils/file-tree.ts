/**
 * File Tree Utilities
 *
 * Converts flat parentToken-based file structure (from API)
 * to nested children-based structure (for display).
 */

/**
 * File snapshot with nested children (for display)
 */
export interface FileSnapshot {
  token: string;
  name: string;
  kind: 'file' | 'folder' | string;
  position: number;
  blobHash?: string;
  wordCount?: number;
  isManuscript?: boolean;
  children?: FileSnapshot[];
}

/**
 * Flat file snapshot with parentToken (from API)
 */
export interface FlatFileSnapshot {
  token: string;
  name: string;
  kind: 'file' | 'folder' | string;
  position: number;
  blobHash?: string;
  wordCount?: number;
  isManuscript?: boolean;
  parentToken?: string;
}

/**
 * Convert flat parentToken structure to nested children structure
 *
 * @param flatFiles - Array of files with parentToken references
 * @returns Array of root-level files with nested children
 */
export function buildFileTree(flatFiles: FlatFileSnapshot[]): FileSnapshot[] {
  if (flatFiles.length === 0) {
    return [];
  }

  // Create a map for quick lookup
  const fileMap = new Map<string, FileSnapshot>();

  // First pass: create all FileSnapshot objects (without children)
  for (const file of flatFiles) {
    fileMap.set(file.token, {
      token: file.token,
      name: file.name,
      kind: file.kind,
      position: file.position,
      blobHash: file.blobHash,
      wordCount: file.wordCount,
      isManuscript: file.isManuscript,
      children: [],
    });
  }

  // Second pass: build parent-child relationships
  const rootFiles: FileSnapshot[] = [];

  for (const file of flatFiles) {
    const node = fileMap.get(file.token)!;

    if (file.parentToken) {
      // Has parent - add to parent's children
      const parent = fileMap.get(file.parentToken);
      if (parent) {
        parent.children = parent.children || [];
        parent.children.push(node);
      } else {
        // Parent not found - treat as root
        rootFiles.push(node);
      }
    } else {
      // No parent - this is a root node
      rootFiles.push(node);
    }
  }

  // Sort children by position recursively
  sortChildrenByPosition(rootFiles);

  // Clean up empty children arrays
  cleanEmptyChildren(rootFiles);

  return rootFiles;
}

/**
 * Recursively sort children by position
 */
function sortChildrenByPosition(files: FileSnapshot[]): void {
  files.sort((a, b) => a.position - b.position);

  for (const file of files) {
    if (file.children && file.children.length > 0) {
      sortChildrenByPosition(file.children);
    }
  }
}

/**
 * Remove empty children arrays for cleaner output
 */
function cleanEmptyChildren(files: FileSnapshot[]): void {
  for (const file of files) {
    if (file.children && file.children.length === 0) {
      delete file.children;
    } else if (file.children) {
      cleanEmptyChildren(file.children);
    }
  }
}

/**
 * Format nested file tree as display string
 *
 * @param files - Nested file structure (with children)
 * @param indent - Current indentation level
 * @returns Formatted tree string
 */
export function formatFileTree(files: FileSnapshot[], indent = 0): string {
  return files
    .sort((a, b) => a.position - b.position)
    .map((f) => {
      const prefix = '  '.repeat(indent);
      const icon = f.kind === 'folder' ? '📁' : '📄';
      const words = f.kind !== 'folder' && f.wordCount ? ` (${f.wordCount} words)` : '';
      const manuscript = f.isManuscript ? ' [M]' : '';
      let line = `${prefix}${icon} ${f.name}${words}${manuscript}`;

      if (f.children && f.children.length > 0) {
        line += '\n' + formatFileTree(f.children, indent + 1);
      }

      return line;
    })
    .join('\n');
}
