import { getParentPath, joinWorkspacePath, workspaceRelativePath } from "./workspace";

export interface PackageToolSearchContext {
  rootPath: string;
  targetRelativePath: string;
}

export const MAX_PACKAGE_TOOL_SEARCH_CONTEXTS = 16;

export function packageToolSearchContexts(
  workspaceRoot: string,
  targetPath: string | null | undefined,
): PackageToolSearchContext[] {
  const normalizedRoot = joinWorkspacePath(workspaceRoot, "");
  const targetRelativePath = targetPath
    ? (workspaceRelativePath(normalizedRoot, targetPath) ?? normalizeRelativeTarget(targetPath))
    : null;

  if (!targetRelativePath || !isSafeRelativePath(targetRelativePath)) {
    return [{ rootPath: normalizedRoot, targetRelativePath: "" }];
  }

  const contexts: PackageToolSearchContext[] = [];
  let directory = getParentPath(targetRelativePath);
  while (
    directory &&
    directory !== targetRelativePath &&
    contexts.length < MAX_PACKAGE_TOOL_SEARCH_CONTEXTS - 1
  ) {
    contexts.push({
      rootPath: joinWorkspacePath(normalizedRoot, directory),
      targetRelativePath: targetRelativePath.slice(directory.length + 1),
    });
    const parent = getParentPath(directory);
    if (parent === directory) {
      break;
    }
    directory = parent;
  }

  contexts.push({ rootPath: normalizedRoot, targetRelativePath });
  return uniqueContexts(contexts);
}

function normalizeRelativeTarget(path: string): string | null {
  const normalized = path.trim().split("\\").join("/").replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("/")) {
    return null;
  }
  return normalized;
}

function isSafeRelativePath(path: string): boolean {
  return path
    .split("/")
    .every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function uniqueContexts(contexts: readonly PackageToolSearchContext[]): PackageToolSearchContext[] {
  const roots = new Set<string>();
  return contexts.filter((context) => {
    if (roots.has(context.rootPath)) {
      return false;
    }
    roots.add(context.rootPath);
    return true;
  });
}
