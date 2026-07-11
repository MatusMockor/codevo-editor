import { detectLanguage, workspaceRelativePath } from "./workspace";

export function shouldOpenPhpNavigationTargetReadOnly(
  rootPath: string,
  path: string,
): boolean {
  if (detectLanguage(path) !== "php") {
    return false;
  }

  const relativePath = workspaceRelativePath(rootPath, path);

  if (relativePath === null) {
    return !sessionPathsEqual(rootPath, path);
  }

  return relativePath.split("/").some(isPhpDependencyPathSegment);
}

function isPhpDependencyPathSegment(segment: string): boolean {
  return segment === "vendor";
}

function sessionPathsEqual(left: string, right: string): boolean {
  return normalizedSessionPath(left) === normalizedSessionPath(right);
}

function normalizedSessionPath(path: string): string {
  return path.trim().split("\\").join("/").replace(/\/+$/, "");
}
