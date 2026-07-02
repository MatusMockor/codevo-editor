export function normalizedWorkspaceRootKey(
  root: string | null | undefined,
): string {
  if (!root) {
    return "";
  }

  const minimumLength = minimumWorkspaceRootKeyLength(root);
  let end = root.length;

  while (end > minimumLength && isWorkspaceRootSeparator(root[end - 1])) {
    end -= 1;
  }

  return root.slice(0, end);
}

export function workspaceRootKeysEqual(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  return normalizedWorkspaceRootKey(left) === normalizedWorkspaceRootKey(right);
}

/// Human-readable project name for status/toast copy (e.g. "Stopping
/// PHPactor + index for my-project"): the last path segment, tolerant of a
/// trailing slash and Windows-style backslashes. Falls back to the raw path
/// when no segment can be extracted (e.g. a bare "/").
export function workspaceDisplayName(root: string): string {
  const normalized = root.split("\\").join("/").replace(/\/+$/, "");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || root;
}

function minimumWorkspaceRootKeyLength(root: string): number {
  if (/^[A-Za-z]:[\\/]/.test(root)) {
    return 3;
  }

  if (root.startsWith("/") || root.startsWith("\\")) {
    return 1;
  }

  return 0;
}

function isWorkspaceRootSeparator(character: string | undefined): boolean {
  return character === "/" || character === "\\";
}
