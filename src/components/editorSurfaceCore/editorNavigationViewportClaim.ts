import type * as Monaco from "monaco-editor";

export interface EditorNavigationViewportClaim {
  readonly path: string;
  readonly model: Monaco.editor.ITextModel | null;
}

export function pendingNavigationViewportClaim(path: string): EditorNavigationViewportClaim {
  return { model: null, path };
}

export function appliedNavigationViewportClaim(
  path: string,
  model: Monaco.editor.ITextModel,
): EditorNavigationViewportClaim {
  return { model, path };
}

export function withoutPendingNavigationViewportClaim(
  claim: EditorNavigationViewportClaim | null,
): EditorNavigationViewportClaim | null {
  if (claim?.model === null) {
    return null;
  }
  return claim;
}

export function withoutForeignNavigationViewportClaim(
  claim: EditorNavigationViewportClaim | null,
  activePath: string | null,
): EditorNavigationViewportClaim | null {
  if (claim && claim.path !== activePath) {
    return null;
  }
  return claim;
}

export function navigationOwnsViewport(
  claim: EditorNavigationViewportClaim | null,
  path: string,
  model: Monaco.editor.ITextModel,
): boolean {
  if (!claim || claim.path !== path) {
    return false;
  }
  return claim.model === null || claim.model === model;
}
