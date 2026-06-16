export type PhpTreeNodeKind =
  | "class"
  | "container"
  | "constant"
  | "enum"
  | "function"
  | "interface"
  | "method"
  | "namespace"
  | "trait";

export interface PhpTreeNode {
  children: PhpTreeNode[];
  column: number | null;
  fullyQualifiedName: string | null;
  id: string;
  kind: PhpTreeNodeKind;
  label: string;
  lineNumber: number | null;
  path: string | null;
  relativePath: string | null;
}

export interface PhpTree {
  nodes: PhpTreeNode[];
}

export interface PhpTreeGateway {
  getPhpTree(root: string): Promise<PhpTree>;
}

export function emptyPhpTree(): PhpTree {
  return { nodes: [] };
}
