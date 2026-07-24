import { createConservativeWorkspaceRootFromPath, parseWorkspacePath } from "./workspacePath";
import { isWellFormedUnicode } from "./unicodeText";

const WINDOWS_ABSOLUTE_PATH = /^[A-Za-z]:\//;
const FILE_URI = /^file:/i;
const CONTROL_CHARACTER = /[\x00-\x1f\x7f]/;

/** Returns one lexical absolute path form, or null for ambiguous/unsafe input. */
export function canonicalPhpCoverageRootPath(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !value ||
    CONTROL_CHARACTER.test(value) ||
    !isWellFormedUnicode(value)
  ) {
    return null;
  }
  if (FILE_URI.test(value)) {
    if (!isLexicallySafeFileUri(value)) return null;
    const root = createConservativeWorkspaceRootFromPath(value);
    if (!root.ok) return null;
    return root.value.flavor === "windows-drive" && root.value.nativePath.startsWith("/")
      ? root.value.nativePath.slice(1)
      : root.value.nativePath;
  }
  return canonicalLexicalAbsolutePath(value, true);
}

/** Canonicalizes a safe workspace-relative coverage path. */
export function canonicalPhpCoverageRelativePath(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !value ||
    CONTROL_CHARACTER.test(value) ||
    !isWellFormedUnicode(value)
  ) {
    return null;
  }
  const normalized = value.replace(/\\/g, "/");
  if (isAbsolute(normalized)) return null;
  return normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")
    ? null
    : normalized;
}

/** Resolves an absolute file only when it is an exact descendant of root. */
export function phpCoverageRelativePath(
  workspaceRoot: unknown,
  absolutePath: unknown,
): string | null {
  const root = canonicalPhpCoverageRootPath(workspaceRoot);
  if (
    !root ||
    typeof absolutePath !== "string" ||
    CONTROL_CHARACTER.test(absolutePath) ||
    !isWellFormedUnicode(absolutePath)
  )
    return null;
  const candidatePath = FILE_URI.test(absolutePath)
    ? isLexicallySafeFileUri(absolutePath)
      ? absolutePath
      : null
    : canonicalLexicalAbsolutePath(absolutePath, false);
  if (!candidatePath) return null;
  const rootDescriptor = createConservativeWorkspaceRootFromPath(root);
  if (!rootDescriptor.ok) return null;
  const candidate = parseWorkspacePath(rootDescriptor.value, candidatePath);
  if (!candidate.ok || !candidate.value.relativePath) return null;
  return canonicalPhpCoverageRelativePath(candidate.value.relativePath);
}

export function joinPhpCoveragePath(workspaceRoot: unknown, relativePath: unknown): string | null {
  const root = canonicalPhpCoverageRootPath(workspaceRoot);
  const relative = canonicalPhpCoverageRelativePath(relativePath);
  if (!root || !relative) return null;
  return root.endsWith("/") ? `${root}${relative}` : `${root}/${relative}`;
}

/** Compares two safe report-relative paths under the root's filesystem identity policy. */
export function phpCoverageRelativePathsEqual(
  workspaceRoot: unknown,
  left: unknown,
  right: unknown,
): boolean {
  const leftKey = phpCoverageRelativePathIdentityKey(workspaceRoot, left);
  const rightKey = phpCoverageRelativePathIdentityKey(workspaceRoot, right);
  return leftKey !== null && rightKey !== null && leftKey === rightKey;
}

/** Stable comparison key for one safe report-relative path under a workspace root. */
export function phpCoverageRelativePathIdentityKey(
  workspaceRoot: unknown,
  relativePath: unknown,
): string | null {
  const root = canonicalPhpCoverageRootPath(workspaceRoot);
  const absolutePath = joinPhpCoveragePath(root, relativePath);
  if (!root || !absolutePath) return null;
  const descriptor = createConservativeWorkspaceRootFromPath(root);
  if (!descriptor.ok) return null;
  const parsed = parseWorkspacePath(descriptor.value, absolutePath);
  return parsed.ok ? parsed.value.key : null;
}

function isAbsolute(value: string): boolean {
  return value.startsWith("/") || WINDOWS_ABSOLUTE_PATH.test(value) || FILE_URI.test(value);
}

function canonicalLexicalAbsolutePath(value: string, allowRoot: boolean): string | null {
  const normalized = value.replace(/\\/g, "/");
  const windows = WINDOWS_ABSOLUTE_PATH.test(normalized);
  const unc = normalized.startsWith("//");
  if (!windows && !unc && !normalized.startsWith("/")) return null;
  const minimumLength = windows ? 3 : unc ? 2 : 1;
  let end = normalized.length;
  while (end > minimumLength && normalized[end - 1] === "/") end -= 1;
  const canonical = normalized.slice(0, end);
  if (canonical.length === minimumLength) return allowRoot && !unc ? canonical : null;
  const segments = canonical.slice(minimumLength).split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
  if (unc && segments.length < 2) return null;
  return allowRoot || segments.length > (unc ? 2 : 0) ? canonical : null;
}

function isLexicallySafeFileUri(value: string): boolean {
  try {
    const decodedRaw = decodeURIComponent(value).replace(/\\/g, "/");
    if (/(?:^|\/)\.{1,2}(?:\/|$)/.test(decodedRaw)) return false;
    const schemeBody = decodedRaw.slice(decodedRaw.indexOf(":") + 1);
    const path = schemeBody.startsWith("//")
      ? schemeBody.slice(schemeBody.indexOf("/", 2))
      : schemeBody;
    if (path.slice(1).includes("//")) return false;
    const uri = new URL(value);
    if (uri.protocol.toLowerCase() !== "file:") return false;
    const segments = decodeURIComponent(uri.pathname).replace(/\\/g, "/").split("/").slice(1);
    return !segments.some(
      (segment, index) =>
        segment === "." || segment === ".." || (segment === "" && index < segments.length - 1),
    );
  } catch {
    return false;
  }
}
