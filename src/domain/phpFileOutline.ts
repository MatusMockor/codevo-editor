import type { FileEntry } from "./workspace";

export type PhpFileOutlineNodeKind =
  | "class"
  | "container"
  | "constant"
  | "enum"
  | "function"
  | "interface"
  | "method"
  | "trait";

export interface PhpFileOutlineNode {
  children: PhpFileOutlineNode[];
  column: number | null;
  fullyQualifiedName: string | null;
  id: string;
  kind: PhpFileOutlineNodeKind;
  label: string;
  lineNumber: number | null;
  path: string | null;
  relativePath: string | null;
}

export interface PhpFileOutline {
  nodes: PhpFileOutlineNode[];
}

export interface PhpFileOutlineGateway {
  getPhpFileOutline(root: string, path: string): Promise<PhpFileOutline>;
}

export function emptyPhpFileOutline(): PhpFileOutline {
  return { nodes: [] };
}

export function canExpandPhpFileEntry(entry: FileEntry): boolean {
  if (entry.kind !== "file") {
    return false;
  }

  return entry.name.toLowerCase().endsWith(".php");
}
