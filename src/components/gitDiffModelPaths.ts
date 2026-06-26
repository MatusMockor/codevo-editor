import type { GitFileDiff } from "../domain/git";

// The @monaco-editor/react DiffEditor resolves its original/modified models by
// Uri (monaco.Uri.parse(modelPath)). When no paths are passed it resolves BOTH
// sides to Uri.parse("") and reuses whatever model already lives at that empty
// Uri, so the two editors collide and switching files can pick up a stale model
// from the previously viewed diff. Giving each side a distinct, stable,
// per-change Uri keeps every file's diff models isolated (one model per
// original/modified side per change).
//
// Per-tab isolation: Monaco's model registry is a process-wide singleton shared
// by every open project tab, so the key must be unique per workspace. We key on
// the change's ABSOLUTE path (`change.path`), which already embeds the workspace
// root, so two project tabs that each have a `README.md` never resolve to the
// same model (which would show one project's content in the other). The path is
// percent-encoded so path separators / special characters cannot reshape the
// derived Uri or collide.

function changeKey(diff: GitFileDiff): string {
  const side = diff.change.isStaged ? "staged" : "worktree";
  // Prefer the absolute path for workspace isolation; fall back to the relative
  // path only if an absolute path is somehow unavailable.
  const fileKey = diff.change.path || diff.change.relativePath;
  return `${side}/${encodeURIComponent(fileKey)}`;
}

export function gitDiffOriginalModelPath(diff: GitFileDiff): string {
  return `git-diff/original/${changeKey(diff)}`;
}

export function gitDiffModifiedModelPath(diff: GitFileDiff): string {
  return `git-diff/modified/${changeKey(diff)}`;
}
