import type { EditorPosition } from "../domain/languageServerFeatures";
import type { LatteReference } from "../domain/latteNavigation";
import { parseLatteBlockSyntax } from "../domain/latteBlockSyntax";

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
  const declarations = parseLatteBlockSyntax(source).declarations;

  if (reference.tag !== "include") {
    const ownDeclaration = declarations.find(
      (declaration) =>
        declaration.name === reference.name &&
        declaration.nameSpan.start === reference.nameStart,
    );

    return ownDeclaration?.nameSpan.start ?? null;
  }

  return (
    declarations.find((declaration) => declaration.name === reference.name)
      ?.nameSpan.start ?? null
  );
}

function editorPositionAtOffset(source: string, offset: number): EditorPosition {
  const clamped = Math.max(0, Math.min(offset, source.length));
  const before = source.slice(0, clamped);
  const lineStart = before.lastIndexOf("\n") + 1;

  return { column: clamped - lineStart + 1, lineNumber: before.split("\n").length };
}
