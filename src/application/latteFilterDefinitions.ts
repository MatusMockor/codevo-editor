import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  latteFilterReferenceAt,
  type LatteFilterReference,
} from "./latteExpressionDetection";
import type { LatteFilterRegistrationTarget } from "./latteFilterDiscovery";

export interface LatteFilterDefinitionDependencies {
  openTarget(
    path: string,
    position: EditorPosition,
    label: string,
  ): Promise<boolean>;
  readFileContent(path: string): Promise<string>;
}

export interface LatteFilterDefinitionContext {
  deps: LatteFilterDefinitionDependencies;
  isRequestedRootActive(): boolean;
  loadFilterRegistrations(): Promise<LatteFilterRegistrationTarget[]>;
}

export async function resolveLatteFilterDefinition(
  context: LatteFilterDefinitionContext,
  source: string,
  offset: number,
  reference: LatteFilterReference | null = latteFilterReferenceAt(source, offset),
): Promise<boolean> {
  if (!reference) {
    return false;
  }

  const registrations = await context.loadFilterRegistrations();

  if (!context.isRequestedRootActive()) {
    return false;
  }

  const target = registrations.find(
    (registration) => registration.name === reference.name,
  );

  if (!target) {
    return false;
  }

  let targetSource: string;

  try {
    targetSource = await context.deps.readFileContent(target.path);
  } catch {
    if (!context.isRequestedRootActive()) {
      return false;
    }

    return false;
  }

  if (!context.isRequestedRootActive()) {
    return false;
  }

  return context.deps.openTarget(
    target.path,
    editorPositionAtOffset(targetSource, target.offset),
    target.name,
  );
}

function editorPositionAtOffset(source: string, offset: number): EditorPosition {
  const clamped = Math.max(0, Math.min(offset, source.length));
  const before = source.slice(0, clamped);
  const lineStart = before.lastIndexOf("\n") + 1;

  return { column: clamped - lineStart + 1, lineNumber: before.split("\n").length };
}
