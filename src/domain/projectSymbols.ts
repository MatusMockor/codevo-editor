export type ProjectSymbolKind =
  | "array"
  | "boolean"
  | "class"
  | "constant"
  | "constructor"
  | "enum"
  | "enumMember"
  | "event"
  | "field"
  | "file"
  | "function"
  | "interface"
  | "key"
  | "method"
  | "module"
  | "namespace"
  | "null"
  | "number"
  | "object"
  | "operator"
  | "package"
  | "property"
  | "string"
  | "struct"
  | "trait"
  | "typeParameter"
  | "variable";

export interface ProjectSymbolSearchResult {
  column: number;
  containerName: string | null;
  fullyQualifiedName: string;
  kind: ProjectSymbolKind;
  lineNumber: number;
  name: string;
  path: string;
  relativePath: string;
}

export interface ProjectSymbolSearchGateway {
  searchProjectSymbols(
    root: string,
    query: string,
    limit: number,
  ): Promise<ProjectSymbolSearchResult[]>;
}

const typeSymbolKinds = new Set<ProjectSymbolKind>(["class", "enum", "interface", "trait"]);

export function isTypeProjectSymbol(symbol: Pick<ProjectSymbolSearchResult, "kind">): boolean {
  return typeSymbolKinds.has(symbol.kind);
}
