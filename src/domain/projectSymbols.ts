export type ProjectSymbolKind =
  | "class"
  | "constant"
  | "enum"
  | "function"
  | "interface"
  | "method"
  | "trait";

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

const typeSymbolKinds = new Set<ProjectSymbolKind>([
  "class",
  "enum",
  "interface",
  "trait",
]);

export function isTypeProjectSymbol(
  symbol: Pick<ProjectSymbolSearchResult, "kind">,
): boolean {
  return typeSymbolKinds.has(symbol.kind);
}
