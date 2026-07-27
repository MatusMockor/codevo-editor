export interface WorkspaceJavaScriptSourceFileEnumeration {
  readonly files: readonly string[];
  readonly truncated: boolean;
  readonly visited: number;
}

export interface WorkspacePackageJsonFileEnumeration {
  readonly files: readonly string[];
  readonly truncated: boolean;
  readonly visited: number;
}

export type BoundedWorkspaceSourceRead =
  | { readonly status: "ok"; readonly content: string }
  | { readonly status: "tooLarge" }
  | { readonly status: "changed" }
  | { readonly status: "notFound" };

export interface WorkspaceSourceDiscoveryGateway {
  enumeratePackageJsonFiles?(
    workspaceRoot: string,
    limits: { readonly maxFiles: number; readonly maxVisited: number },
  ): Promise<WorkspacePackageJsonFileEnumeration>;
  enumerateJavaScriptSourceFiles(
    workspaceRoot: string,
    limits: { readonly maxFiles: number; readonly maxVisited: number },
  ): Promise<WorkspaceJavaScriptSourceFileEnumeration>;
  readSourceTextBounded(
    workspaceRoot: string,
    relativePath: string,
    maxBytes: number,
  ): Promise<BoundedWorkspaceSourceRead>;
}
