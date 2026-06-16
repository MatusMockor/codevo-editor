import type { FileEntry } from "./workspace";

export type PhpFileOutlineNodeKind =
  | "class"
  | "container"
  | "constant"
  | "enum"
  | "function"
  | "interface"
  | "method"
  | "property"
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

export type PhpFileStructureScope = "current" | "inherited";

export interface FlatPhpFileOutlineNode {
  depth: number;
  node: PhpFileOutlineNode;
}

export interface PhpFileOutlineGateway {
  getPhpFileOutline(root: string, path: string): Promise<PhpFileOutline>;
  parsePhpFileOutline(path: string, source: string): Promise<PhpFileOutline>;
}

export function emptyPhpFileOutline(): PhpFileOutline {
  return { nodes: [] };
}

export function flattenPhpFileOutlineNodes(
  nodes: PhpFileOutlineNode[],
  depth = 0,
): FlatPhpFileOutlineNode[] {
  return nodes.flatMap((node) => [
    { depth, node },
    ...flattenPhpFileOutlineNodes(node.children, depth + 1),
  ]);
}

export function isNavigablePhpFileOutlineNode(
  node: PhpFileOutlineNode,
): boolean {
  return Boolean(node.path && node.lineNumber && node.column);
}

export function canExpandPhpFileEntry(entry: FileEntry): boolean {
  if (entry.kind !== "file") {
    return false;
  }

  return entry.name.toLowerCase().endsWith(".php");
}
