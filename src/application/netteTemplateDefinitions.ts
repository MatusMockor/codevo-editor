import type { EditorPosition } from "../domain/languageServerFeatures";
import type { LatteReference } from "../domain/latteNavigation";
import {
  latteLayoutCandidatePaths,
  resolveLatteTemplateCandidatePaths,
} from "../domain/nettePathResolution";
import type { LatteDirectoryEntry } from "./netteTemplateDiscovery";

export interface NetteTemplateDependencies {
  joinPath(rootPath: string, relativePath: string): string;
  listDirectory(path: string): Promise<LatteDirectoryEntry[]>;
  openTarget(
    path: string,
    position: EditorPosition,
    label: string,
  ): Promise<boolean>;
  readFileContent(path: string): Promise<string>;
  toRelativePath(rootPath: string, path: string): string;
}

export interface NetteTemplateResolutionContext {
  currentTemplateRelativePath: string;
  deps: NetteTemplateDependencies;
  isRequestedRootActive(): boolean;
  requestedRoot: string;
}

const LAYOUT_NAVIGATION_LABEL = "@layout";
const MAX_BARE_LAYOUT_SCAN = 2_000;

export async function resolveLatteTemplateDefinition(
  context: NetteTemplateResolutionContext,
  reference: LatteReference | null,
  source: string,
  offset: number,
): Promise<boolean> {
  const { currentTemplateRelativePath, deps, isRequestedRootActive, requestedRoot } =
    context;
  const candidatePaths = reference
    ? resolveLatteTemplateCandidatePaths(
        reference.name,
        currentTemplateRelativePath,
      )
    : bareLayoutTagAt(source, offset)
      ? latteLayoutCandidatePaths(currentTemplateRelativePath)
      : [];
  const label = reference ? reference.name : LAYOUT_NAVIGATION_LABEL;

  for (const relativePath of candidatePaths) {
    if (!isRequestedRootActive()) {
      return false;
    }

    const path = deps.joinPath(requestedRoot, relativePath);
    const exists = await fileExists(deps, path);

    if (!isRequestedRootActive()) {
      return false;
    }

    if (!exists) {
      continue;
    }

    return deps.openTarget(path, { column: 1, lineNumber: 1 }, label);
  }

  return false;
}

async function fileExists(
  deps: NetteTemplateDependencies,
  path: string,
): Promise<boolean> {
  try {
    await deps.readFileContent(path);
    return true;
  } catch {
    return false;
  }
}

function bareLayoutTagAt(source: string, offset: number): boolean {
  if (offset < 0 || offset > source.length) {
    return false;
  }

  const braceStart = macroOpenBefore(source, offset);

  if (braceStart === null || source[braceStart + 1] === "/") {
    return false;
  }

  let index = braceStart + 1;

  while (index < source.length && isTagNameChar(source[index] ?? "")) {
    index += 1;
  }

  if (source.slice(braceStart + 1, index) !== "layout") {
    return false;
  }

  const limit = Math.min(source.length, braceStart + MAX_BARE_LAYOUT_SCAN);

  for (let scan = index; scan < limit; scan += 1) {
    const character = source[scan];

    if (character === "\n") {
      return false;
    }

    if (character === "}") {
      return offset <= scan;
    }

    if (character !== " " && character !== "\t") {
      return false;
    }
  }

  return false;
}

function macroOpenBefore(source: string, offset: number): number | null {
  const min = Math.max(0, offset - MAX_BARE_LAYOUT_SCAN);

  for (let index = offset - 1; index >= min; index -= 1) {
    const character = source[index];

    if (character === "\n" || character === "}") {
      return null;
    }

    if (character === "{") {
      return index;
    }
  }

  return null;
}

function isTagNameChar(character: string): boolean {
  return /[A-Za-z0-9_]/.test(character);
}
