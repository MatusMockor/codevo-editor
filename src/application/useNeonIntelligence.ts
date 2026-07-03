/**
 * Nette **NEON** config navigation + completion intelligence (spec §4.8, Slice
 * 8), a sibling of `useLatteIntelligence`: the workbench controller mounts it
 * with a thin dependency surface (strangler pattern), while every decision lives
 * here so the logic is unit-testable WITHOUT the controller, Monaco, or React.
 *
 * Responsibilities:
 *   - `provideNeonDefinition` (Cmd+B): a service-class reference
 *     (`App\Model\Foo`, entity `Foo(`, `factory: Foo::method`) resolves to its
 *     PHP file through the injected `openClassTarget` (the SAME index + PSR-4
 *     resolver a Laravel `use Foo\Bar;` jump uses); an `includes:` entry resolves
 *     to the referenced `.neon` file, relative to the current config's directory.
 *   - `provideNeonCompletions`: class-name completion inside a `services:` value
 *     position, sourced from the injected workspace class-name search (the
 *     project symbol index, filtered to type symbols).
 *
 * GATING (spec §4.9): every entry point is inert unless BOTH the Nette framework
 * profile is active AND the semantic tier (`fullSmart`) is on. Highlighting runs
 * independently, so a `.neon` file in a non-Nette project (or `basic` mode) gets
 * nothing from here.
 *
 * ISOLATION (project rule): each async flow captures the requested workspace root
 * up front and re-checks the LIVE root after every `await`, dropping stale
 * results so nothing leaks across project tabs. The class-resolution and
 * class-name-search dependencies carry their OWN isolation guards inside the
 * controller; this hook additionally re-checks before its own `openTarget`.
 */

import { useRef } from "react";
import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  detectNeonClassReferenceAt,
  detectNeonIncludeAt,
  neonServiceClassCompletionContextAt,
} from "../domain/neonConfig";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

/** The Monaco icon bucket a NEON completion maps to (only class names today). */
export type NeonCompletionItemKind = "class";

/**
 * A NEON completion the hook hands to the Monaco "neon" provider. Structurally
 * compatible with the provider's `NeonCompletion`; kept local so the application
 * layer does not depend on the components layer (mirrors `LatteCompletionItem`).
 */
export interface NeonCompletionItem {
  detail?: string;
  insertText: string;
  kind: NeonCompletionItemKind;
  label: string;
  replaceStart?: number;
  replaceEnd?: number;
}

/** The minimal shape of the active editor document the hook reads (its path). */
export interface NeonIntelligenceActiveDocument {
  path: string;
}

/**
 * The injected surface the hook needs. Every member is a value or a tiny
 * function so the logic can be exercised with plain fakes - no controller, no
 * Monaco, no React. The controller mount supplies the real collaborators
 * (class resolver, workspace symbol search, navigation opener, path helpers,
 * framework/tier flags) and the live workspace-root ref used for the post-await
 * isolation re-checks.
 */
export interface NeonIntelligenceDependencies {
  /** Live workspace root, read AFTER each await to drop stale results. */
  currentWorkspaceRootRef: { readonly current: string | null };
  getActiveDocument(): NeonIntelligenceActiveDocument | null;
  isNetteFrameworkActive: boolean;
  isSemanticIntelligenceActive: boolean;
  joinPath(rootPath: string, relativePath: string): string;
  /**
   * Resolves a PHP class name (a NEON reference is already fully qualified) to
   * its source file and opens it, resolving `true` when it navigated. A
   * pass-through of the controller's `openPhpClassTarget` - the SAME index +
   * PSR-4 resolver a plain `use Foo\Bar;` / `new Foo()` jump uses - so a NEON
   * service class navigates exactly like a PHP class reference.
   */
  openClassTarget(className: string): Promise<boolean>;
  openTarget(
    path: string,
    position: EditorPosition,
    label: string,
  ): Promise<boolean>;
  readFileContent(path: string): Promise<string>;
  /**
   * Workspace class-name search for `services:` completion: returns candidate
   * fully-qualified class names for a typed prefix. A pass-through of the
   * controller's project-symbol index (filtered to type symbols); an empty
   * result (indexing off) simply yields no completions - conservative.
   */
  searchClassNames(
    rootPath: string,
    prefix: string,
    maxResults: number,
  ): Promise<string[]>;
  toRelativePath(rootPath: string, path: string): string;
  /** The requested workspace root, captured up front by each async flow. */
  workspaceRoot: string | null;
}

export interface NeonIntelligence {
  provideNeonCompletions(
    source: string,
    position: EditorPosition,
  ): Promise<NeonCompletionItem[]>;
  provideNeonDefinition(source: string, offset: number): Promise<boolean>;
}

const NEON_MAX_COMPLETIONS = 100;
const NEON_EXTENSION = ".neon";

/**
 * Builds the NEON intelligence API from an accessor to the current dependencies
 * (read fresh on every call so gating flags and the workspace root are always
 * current). Exported for direct unit testing; the React hook is a thin, stable
 * wrapper around it.
 */
export function createNeonIntelligence(
  getDependencies: () => NeonIntelligenceDependencies,
): NeonIntelligence {
  const provideNeonDefinition = async (
    source: string,
    offset: number,
  ): Promise<boolean> => {
    const deps = getDependencies();

    if (!isNeonSemanticActive(deps)) {
      return false;
    }

    const requestedRoot = deps.workspaceRoot;

    if (!requestedRoot) {
      return false;
    }

    const isRequestedRootActive = () =>
      workspaceRootKeysEqual(deps.currentWorkspaceRootRef.current, requestedRoot);
    const classReference = detectNeonClassReferenceAt(source, offset);

    if (classReference) {
      return deps.openClassTarget(classReference.className);
    }

    const include = detectNeonIncludeAt(source, offset);

    if (include) {
      return resolveNeonInclude(
        deps,
        requestedRoot,
        isRequestedRootActive,
        include.path,
      );
    }

    return false;
  };

  const provideNeonCompletions = async (
    source: string,
    position: EditorPosition,
  ): Promise<NeonCompletionItem[]> => {
    const deps = getDependencies();

    if (!isNeonSemanticActive(deps)) {
      return [];
    }

    const requestedRoot = deps.workspaceRoot;

    if (!requestedRoot) {
      return [];
    }

    const isRequestedRootActive = () =>
      workspaceRootKeysEqual(deps.currentWorkspaceRootRef.current, requestedRoot);
    const offset = offsetAtEditorPosition(source, position);
    const context = neonServiceClassCompletionContextAt(source, offset);

    if (!context) {
      return [];
    }

    const names = await deps.searchClassNames(
      requestedRoot,
      context.prefix,
      NEON_MAX_COMPLETIONS,
    );

    if (!isRequestedRootActive()) {
      return [];
    }

    return names.slice(0, NEON_MAX_COMPLETIONS).map((name) => ({
      detail: "Nette service class",
      insertText: name,
      kind: "class" as const,
      label: name,
      replaceEnd: context.span.end,
      replaceStart: context.span.start,
    }));
  };

  return { provideNeonCompletions, provideNeonDefinition };
}

/**
 * Thin React wrapper: keeps a live dependency ref (so the stable API always sees
 * the latest gating flags / root), then builds the intelligence API exactly once
 * so its callback identities never churn across renders.
 */
export function useNeonIntelligence(
  dependencies: NeonIntelligenceDependencies,
): NeonIntelligence {
  const dependenciesRef = useRef(dependencies);
  dependenciesRef.current = dependencies;
  const apiRef = useRef<NeonIntelligence | null>(null);

  if (!apiRef.current) {
    apiRef.current = createNeonIntelligence(() => dependenciesRef.current);
  }

  return apiRef.current;
}

function isNeonSemanticActive(deps: NeonIntelligenceDependencies): boolean {
  return deps.isNetteFrameworkActive && deps.isSemanticIntelligenceActive;
}

/**
 * Resolves an `includes:` entry to its `.neon` file (relative to the current
 * config's directory, how NEON resolves includes), verifies it exists via the
 * injected reader, and opens it. Conservative: a path that escapes the workspace
 * root, or a non-existent file, resolves to `false`. The live-root re-check
 * after the read drops a switched project's result.
 */
async function resolveNeonInclude(
  deps: NeonIntelligenceDependencies,
  requestedRoot: string,
  isRequestedRootActive: () => boolean,
  includePath: string,
): Promise<boolean> {
  const currentRelativePath = currentNeonRelativePath(deps, requestedRoot);
  const relativePath = resolveNeonRelativePath(includePath, currentRelativePath);

  if (!relativePath) {
    return false;
  }

  const path = deps.joinPath(requestedRoot, relativePath);

  try {
    await deps.readFileContent(path);
  } catch {
    return false;
  }

  if (!isRequestedRootActive()) {
    return false;
  }

  return deps.openTarget(path, { column: 1, lineNumber: 1 }, includePath);
}

function currentNeonRelativePath(
  deps: NeonIntelligenceDependencies,
  requestedRoot: string,
): string {
  const document = deps.getActiveDocument();

  if (!document) {
    return "";
  }

  return deps.toRelativePath(requestedRoot, document.path);
}

/**
 * Resolves a NEON include reference to a workspace-relative path, against the
 * current config's directory (a leading `/` is workspace-root relative). `.`/
 * `..` segments are collapsed; a reference that escapes above the root, or is
 * blank, resolves to `null`. A `.neon` extension is appended when the reference
 * has none.
 */
function resolveNeonRelativePath(
  includePath: string,
  currentRelativePath: string,
): string | null {
  const reference = includePath.split("\\").join("/").trim();

  if (reference.length === 0) {
    return null;
  }

  const rootRelative = reference.startsWith("/");
  const base = rootRelative
    ? ""
    : dirnameOf(currentRelativePath.split("\\").join("/").trim());
  const body = rootRelative ? reference.replace(/^\/+/, "") : reference;
  const combined = base.length > 0 ? `${base}/${body}` : body;
  const segments = collapseRelative(combined);

  if (!segments) {
    return null;
  }

  const path = segments.join("/");
  const lastSegment = segments[segments.length - 1] ?? "";

  return lastSegment.includes(".") ? path : `${path}${NEON_EXTENSION}`;
}

function dirnameOf(path: string): string {
  const index = path.lastIndexOf("/");

  if (index < 0) {
    return "";
  }

  return path.slice(0, index);
}

/**
 * Collapses `.`/`..`/empty segments. Returns `null` when the path escapes above
 * the workspace root or collapses to nothing.
 */
function collapseRelative(path: string): string[] | null {
  const result: string[] = [];

  for (const segment of path.split("/")) {
    if (segment.length === 0 || segment === ".") {
      continue;
    }

    if (segment === "..") {
      if (result.length === 0) {
        return null;
      }

      result.pop();
      continue;
    }

    result.push(segment);
  }

  return result.length > 0 ? result : null;
}

function offsetAtEditorPosition(source: string, position: EditorPosition): number {
  const lines = source.split("\n");
  const targetLine = Math.max(0, position.lineNumber - 1);

  if (targetLine >= lines.length) {
    return source.length;
  }

  let offset = 0;

  for (let line = 0; line < targetLine; line += 1) {
    offset += (lines[line]?.length ?? 0) + 1;
  }

  const column = Math.max(0, position.column - 1);

  return offset + Math.min(column, lines[targetLine]?.length ?? 0);
}
