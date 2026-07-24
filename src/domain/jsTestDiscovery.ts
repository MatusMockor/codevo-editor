export interface WorkspaceJsTestFileEnumeration {
  readonly files: readonly string[];
  readonly truncated: boolean;
  readonly visited: number;
}

export type BoundedWorkspaceTextRead =
  { readonly status: "ok"; readonly content: string } | { readonly status: "tooLarge" };

export interface WorkspaceTestDiscoveryGateway {
  enumerateJsTestFiles(
    workspaceRoot: string,
    limits: { readonly maxFiles: number; readonly maxVisited: number },
  ): Promise<WorkspaceJsTestFileEnumeration>;
  readTextFileBounded(
    workspaceRoot: string,
    relativePath: string,
    maxBytes: number,
  ): Promise<BoundedWorkspaceTextRead>;
}
