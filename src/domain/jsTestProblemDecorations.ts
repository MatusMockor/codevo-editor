import type { JsTestExplorerCurrentFileIdentity } from "./jsTestExplorerFilter";
import {
  MAX_JS_TEST_PROBLEM_ENTRIES,
  validatedJsTestProblemsOwner,
  type JsTestProblemEntry,
  type JsTestProblemsSnapshot,
} from "./jsTestProblems";
import { normalizedJsTestRelativeFilePath } from "./jsTestRunScope";
import { joinWorkspacePath } from "./workspace";
import {
  createWorkspaceRoot,
  parseWorkspacePath,
  type WorkspacePathKey,
  type WorkspaceRootDescriptor,
} from "./workspacePath";

export interface JsTestProblemLineDecoration {
  readonly entries: readonly JsTestProblemEntry[];
  readonly lineNumber: number;
}

/**
 * Projects the current file's authoritative test problems into immutable line groups.
 * The snapshot stays ordered: the first matching problem on a line is the primary entry.
 */
export function jsTestProblemLineDecorations(
  snapshot: JsTestProblemsSnapshot,
  currentFile: JsTestExplorerCurrentFileIdentity,
): readonly JsTestProblemLineDecoration[] {
  try {
    const authority = decorationAuthority(snapshot, currentFile);
    if (!authority || !Array.isArray(snapshot.entries)) return Object.freeze([]);
    if (snapshot.entries.length > MAX_JS_TEST_PROBLEM_ENTRIES) return Object.freeze([]);

    const groups = new Map<number, JsTestProblemEntry[]>();
    for (const entry of snapshot.entries) {
      if (!entryMatchesCurrentFile(entry, authority.root, authority.pathKey)) continue;
      const entries = groups.get(entry.lineNumber);
      const frozenEntry = Object.freeze({ ...entry });
      if (entries) {
        entries.push(frozenEntry);
      } else {
        groups.set(entry.lineNumber, [frozenEntry]);
      }
    }

    return Object.freeze(
      [...groups].map(([lineNumber, entries]) =>
        Object.freeze({
          entries: Object.freeze(entries),
          lineNumber,
        }),
      ),
    );
  } catch {
    return Object.freeze([]);
  }
}

interface DecorationAuthority {
  readonly pathKey: WorkspacePathKey;
  readonly root: WorkspaceRootDescriptor;
}

function decorationAuthority(
  snapshot: JsTestProblemsSnapshot,
  currentFile: JsTestExplorerCurrentFileIdentity,
): DecorationAuthority | null {
  if (
    !snapshot ||
    typeof snapshot !== "object" ||
    !currentFile ||
    typeof currentFile !== "object"
  ) {
    return null;
  }
  const root = currentFile.root;
  if (!root || typeof root !== "object" || typeof currentFile.pathKey !== "string") return null;

  const recreated = createWorkspaceRoot(root.workspaceId, root.nativePath, root.policy);
  if (!recreated.ok || !sameRootDescriptor(recreated.value, root)) return null;

  const owner = validatedJsTestProblemsOwner(snapshot.owner);
  if (
    owner.workspaceId !== snapshot.owner.workspaceId ||
    owner.rootKey !== snapshot.owner.rootKey ||
    owner.workspaceId !== root.workspaceId
  ) {
    return null;
  }
  const ownerRoot = parseWorkspacePath(recreated.value, owner.rootKey);
  if (!ownerRoot.ok || ownerRoot.value.relativePath !== "") return null;

  const relativeFilePath = normalizedJsTestRelativeFilePath(currentFile.relativeFilePath);
  if (relativeFilePath !== currentFile.relativeFilePath) return null;
  const parsedFile = parseWorkspacePath(
    recreated.value,
    joinWorkspacePath(recreated.value.nativePath, relativeFilePath),
  );
  if (
    !parsedFile.ok ||
    !parsedFile.value.relativePath ||
    parsedFile.value.key !== currentFile.pathKey
  ) {
    return null;
  }
  return Object.freeze({ pathKey: parsedFile.value.key, root: recreated.value });
}

function sameRootDescriptor(
  recreated: WorkspaceRootDescriptor,
  supplied: WorkspaceRootDescriptor,
): boolean {
  return (
    recreated.workspaceId === supplied.workspaceId &&
    recreated.anchor === supplied.anchor &&
    recreated.flavor === supplied.flavor &&
    recreated.nativePath === supplied.nativePath &&
    recreated.fileUri === supplied.fileUri &&
    recreated.policy.caseSensitive === supplied.policy.caseSensitive &&
    recreated.policy.unicodeNormalization === supplied.policy.unicodeNormalization
  );
}

function entryMatchesCurrentFile(
  entry: JsTestProblemEntry,
  root: WorkspaceRootDescriptor,
  currentPathKey: WorkspacePathKey,
): boolean {
  if (
    !entry ||
    typeof entry !== "object" ||
    !Number.isSafeInteger(entry.lineNumber) ||
    entry.lineNumber <= 0 ||
    typeof entry.filePath !== "string" ||
    typeof entry.message !== "string" ||
    (entry.name !== null && typeof entry.name !== "string") ||
    (entry.status !== "error" && entry.status !== "failed")
  ) {
    return false;
  }
  try {
    const relativeFilePath = normalizedJsTestRelativeFilePath(entry.filePath);
    if (relativeFilePath !== entry.filePath) return false;
    const parsed = parseWorkspacePath(root, joinWorkspacePath(root.nativePath, relativeFilePath));
    return parsed.ok && parsed.value.relativePath !== "" && parsed.value.key === currentPathKey;
  } catch {
    return false;
  }
}
