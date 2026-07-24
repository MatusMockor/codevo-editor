import type { EditorPosition } from "./languageServerFeatures";
import { validatedJsTestRunScope, type JsTestRunScope } from "./jsTestRunScope";
import { jsTestSelectionAtCursor } from "./jsTestSelectionAtCursor";

export type JsTestRunnableScope = Exclude<JsTestRunScope, { readonly kind: "all" }>;

/** Maps the neutral cursor selection to the canonical run contract. */
export function jsTestRunScopeAtCursor(
  source: string,
  position: EditorPosition,
  relativeFilePath: string,
): JsTestRunnableScope | null {
  const selection = jsTestSelectionAtCursor(source, position);
  if (!selection) return null;

  return safelyValidatedRunnableScope(
    selection.kind === "suite"
      ? { fullName: selection.fullName, kind: "suite", relativeFilePath }
      : {
          fullName: selection.fullName,
          kind: "test",
          ...(selection.nameMatch === "prefix" ? { nameMatch: "prefix" as const } : {}),
          relativeFilePath,
        },
  );
}

/** Maps an active file to the same canonical run contract. */
export function jsTestRunScopeForFile(relativeFilePath: string): JsTestRunnableScope | null {
  return safelyValidatedRunnableScope({ kind: "file", relativeFilePath });
}

function safelyValidatedRunnableScope(scope: JsTestRunnableScope): JsTestRunnableScope | null {
  try {
    const validated = validatedJsTestRunScope(scope);
    return validated.kind === "all" ? null : validated;
  } catch {
    return null;
  }
}
