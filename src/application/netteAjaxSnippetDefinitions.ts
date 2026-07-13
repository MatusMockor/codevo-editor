import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  findNetteRedrawControlCall,
  type NetteLatteSnippetReference,
} from "../domain/netteAjaxSnippets";
import {
  componentOwnerCandidatePathsForTemplate,
} from "./netteTemplateOwnerCandidates";

export interface NetteAjaxSnippetDefinitionDependencies {
  joinPath(rootPath: string, relativePath: string): string;
  openTarget(
    path: string,
    position: EditorPosition,
    label: string,
  ): Promise<boolean>;
  readFileContent(path: string): Promise<string>;
}

export interface NetteAjaxSnippetDefinitionContext {
  currentTemplateRelativePath: string;
  deps: NetteAjaxSnippetDefinitionDependencies;
  isRequestedRootActive(): boolean;
  requestedRoot: string;
}

export async function resolveNetteAjaxSnippetDefinition(
  context: NetteAjaxSnippetDefinitionContext,
  reference: NetteLatteSnippetReference | null,
): Promise<boolean> {
  if (!reference) {
    return false;
  }

  const {
    currentTemplateRelativePath,
    deps,
    isRequestedRootActive,
    requestedRoot,
  } = context;
  const candidatePaths = componentOwnerCandidatePathsForTemplate(
    currentTemplateRelativePath,
  );

  for (const relativePath of candidatePaths) {
    if (!isRequestedRootActive()) {
      return false;
    }

    const path = deps.joinPath(requestedRoot, relativePath);
    let content: string;

    try {
      content = await deps.readFileContent(path);
    } catch {
      if (!isRequestedRootActive()) {
        return false;
      }

      continue;
    }

    if (!isRequestedRootActive()) {
      return false;
    }

    const call = findNetteRedrawControlCall(content, reference.name);

    if (!call) {
      continue;
    }

    return deps.openTarget(
      path,
      editorPositionAtOffset(content, call.nameStart),
      reference.name,
    );
  }

  return false;
}

function editorPositionAtOffset(source: string, offset: number): EditorPosition {
  const before = source.slice(0, Math.max(0, offset));
  const lines = before.split("\n");

  return {
    column: (lines[lines.length - 1]?.length ?? 0) + 1,
    lineNumber: lines.length,
  };
}
