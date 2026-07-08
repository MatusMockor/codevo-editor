import { NEON_EXTENSION } from "./neonProjectConfigDiscovery";
import type { NeonDefinitionDependencies } from "./neonDefinitionProvider";

/**
 * Resolves an `includes:` entry to its `.neon` file (relative to the current
 * config's directory, how NEON resolves includes), verifies it exists via the
 * injected reader, and opens it. Conservative: a path that escapes the workspace
 * root, or a non-existent file, resolves to `false`. The live-root re-check
 * after the read drops a switched project's result.
 */
export async function resolveNeonIncludeDefinition(
  deps: NeonDefinitionDependencies,
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
  deps: NeonDefinitionDependencies,
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
