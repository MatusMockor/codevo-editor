import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  findNetteLatteSnippetReference,
  findNetteRedrawControlCall,
  type NetteLatteSnippetReference,
  type NetteRedrawControlCall,
} from "../domain/netteAjaxSnippets";
import { componentTemplateCandidatePathsForClass } from "../domain/nettePathResolution";
import {
  componentOwnerCandidatePathsForTemplate,
} from "./netteTemplateOwnerCandidates";

export interface NetteRedrawControlSnippetDefinitionTargetFinderDependencies {
  joinPath(rootPath: string, relativePath: string): string;
  readFileContent(path: string): Promise<string>;
}

export interface NetteAjaxSnippetDefinitionDependencies
  extends NetteRedrawControlSnippetDefinitionTargetFinderDependencies {
  openTarget(
    path: string,
    position: EditorPosition,
    label: string,
  ): Promise<boolean>;
}

export interface NetteRedrawControlSnippetDefinitionTarget {
  name: string;
  path: string;
  position: EditorPosition;
  relativePath: string;
}

export interface NetteAjaxSnippetDefinitionContext {
  currentTemplateRelativePath: string;
  deps: NetteAjaxSnippetDefinitionDependencies;
  isRequestedRootActive(): boolean;
  requestedRoot: string;
}

export interface NetteRedrawControlSnippetDefinitionContext {
  currentPhpRelativePath: string;
  deps: NetteAjaxSnippetDefinitionDependencies;
  isRequestedRootActive(): boolean;
  requestedRoot: string;
}

export interface NetteRedrawControlSnippetDefinitionTargetFinderContext {
  currentPhpRelativePath: string;
  deps: NetteRedrawControlSnippetDefinitionTargetFinderDependencies;
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

export async function resolveNetteRedrawControlSnippetDefinition(
  context: NetteRedrawControlSnippetDefinitionContext,
  reference: NetteRedrawControlCall | null,
): Promise<boolean> {
  if (!reference) {
    return false;
  }

  const target = await findNetteRedrawControlSnippetDefinitionTarget(
    context,
    reference.name,
  );

  if (!target) {
    return false;
  }

  return context.deps.openTarget(target.path, target.position, reference.name);
}

export async function findNetteRedrawControlSnippetDefinitionTarget(
  context: NetteRedrawControlSnippetDefinitionTargetFinderContext,
  snippetName: string,
): Promise<NetteRedrawControlSnippetDefinitionTarget | null> {
  const {
    currentPhpRelativePath,
    deps,
    isRequestedRootActive,
    requestedRoot,
  } = context;
  const candidatePaths =
    componentTemplateCandidatePathsForClass(currentPhpRelativePath);

  for (const relativePath of candidatePaths) {
    if (!isRequestedRootActive()) {
      return null;
    }

    const path = deps.joinPath(requestedRoot, relativePath);
    let content: string;

    try {
      content = await deps.readFileContent(path);
    } catch {
      if (!isRequestedRootActive()) {
        return null;
      }

      continue;
    }

    if (!isRequestedRootActive()) {
      return null;
    }

    const snippet = findNetteLatteSnippetReference(content, snippetName);

    if (!snippet) {
      continue;
    }

    return {
      name: snippet.name,
      path,
      position: editorPositionAtOffset(content, snippet.nameStart),
      relativePath,
    };
  }

  return null;
}

function editorPositionAtOffset(source: string, offset: number): EditorPosition {
  const before = source.slice(0, Math.max(0, offset));
  const lines = before.split("\n");

  return {
    column: (lines[lines.length - 1]?.length ?? 0) + 1,
    lineNumber: lines.length,
  };
}
