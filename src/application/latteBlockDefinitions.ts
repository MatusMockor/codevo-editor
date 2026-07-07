import type { EditorPosition } from "../domain/languageServerFeatures";
import type { LatteReference } from "../domain/latteNavigation";

export interface LatteBlockDefinitionActiveDocument {
  path: string;
}

export interface LatteBlockDefinitionDependencies {
  getActiveDocument(): LatteBlockDefinitionActiveDocument | null;
  openTarget(
    path: string,
    position: EditorPosition,
    label: string,
  ): Promise<boolean>;
}

export function resolveLatteBlockDefinition(
  deps: LatteBlockDefinitionDependencies,
  source: string,
  reference: LatteReference,
  currentTemplateRelativePath: string | null,
): Promise<boolean> {
  if (!currentTemplateRelativePath) {
    return Promise.resolve(false);
  }

  const definitionOffset = latteBlockDefinitionOffset(source, reference);

  if (definitionOffset === null) {
    return Promise.resolve(false);
  }

  const activeDocumentPath = deps.getActiveDocument()?.path ?? null;

  if (!activeDocumentPath) {
    return Promise.resolve(false);
  }

  return deps.openTarget(
    activeDocumentPath,
    editorPositionAtOffset(source, definitionOffset),
    reference.name,
  );
}

export function latteBlockDefinitionOffset(
  source: string,
  reference: LatteReference,
): number | null {
  const blockReference = new RegExp(
    String.raw`\{(?:block|define)\s+#?${escapeRegExp(reference.name)}(?=[\s,}/])`,
    "g",
  );

  for (const match of source.matchAll(blockReference)) {
    const start = match.index ?? 0;
    const nameStart = start + match[0].lastIndexOf(reference.name);

    if (reference.tag !== "include" && nameStart === reference.nameStart) {
      return nameStart;
    }

    if (reference.tag === "include") {
      return nameStart;
    }
  }

  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function editorPositionAtOffset(source: string, offset: number): EditorPosition {
  const clamped = Math.max(0, Math.min(offset, source.length));
  const before = source.slice(0, clamped);
  const lineStart = before.lastIndexOf("\n") + 1;

  return { column: clamped - lineStart + 1, lineNumber: before.split("\n").length };
}
