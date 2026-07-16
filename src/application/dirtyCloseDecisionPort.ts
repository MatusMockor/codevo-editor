import type { DirtyCloseDecision } from "../domain/dirtyClose";

export type DirtyCloseScope = "tab" | "group" | "workspace" | "quit";

export interface DirtyCloseDocumentDescriptor {
  readonly id: string;
  readonly name: string;
  readonly relativePath: string;
  readonly workspaceLabel: string;
}

export interface DirtyCloseDecisionRequest {
  readonly scope: DirtyCloseScope;
  readonly documents?: readonly DirtyCloseDocumentDescriptor[];
  /** @deprecated Compatibility input for callers outside the typed UI host. */
  readonly documentNames: readonly string[];
}

export function dirtyCloseRequestDocuments(
  request: DirtyCloseDecisionRequest,
): readonly DirtyCloseDocumentDescriptor[] {
  if (request.documents) {
    return request.documents;
  }

  return request.documentNames.map((name, index) => ({
    id: `legacy:${index}:${name}`,
    name,
    relativePath: name,
    workspaceLabel: "",
  }));
}

export function createDirtyCloseDocumentDescriptor(
  id: string,
  workspaceRoot: string,
  relativePath: string,
  name: string,
): DirtyCloseDocumentDescriptor {
  return {
    id,
    name,
    relativePath: relativePath || name,
    workspaceLabel: workspacePathName(workspaceRoot),
  };
}

function workspacePathName(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).pop() ?? normalized;
}

/** Application boundary for deciding what to do with unsaved close targets. */
export interface DirtyCloseDecisionPort {
  decideDirtyClose(
    request: DirtyCloseDecisionRequest,
  ): Promise<DirtyCloseDecision>;
}
