export interface TransientEditorDocumentScheme {
  readonly persistable: false;
  readonly prefix: string;
  readonly scheme: string;
}

export type GitDiffDocumentSide = "staged" | "worktree";

const gitDiffDocumentScheme: TransientEditorDocumentScheme = {
  persistable: false,
  prefix: "mockor-git-diff:",
  scheme: "mockor-git-diff",
};

const gitHistoryDiffDocumentScheme: TransientEditorDocumentScheme = {
  persistable: false,
  prefix: "mockor-git-history-diff:",
  scheme: "mockor-git-history-diff",
};

const markdownPreviewDocumentScheme: TransientEditorDocumentScheme = {
  persistable: false,
  prefix: "mockor-markdown-preview:",
  scheme: "mockor-markdown-preview",
};

export const transientEditorDocumentSchemes: readonly TransientEditorDocumentScheme[] =
  [
    gitDiffDocumentScheme,
    gitHistoryDiffDocumentScheme,
    markdownPreviewDocumentScheme,
  ];

function matchesTransientScheme(
  scheme: TransientEditorDocumentScheme,
  path: string,
): boolean {
  return path.startsWith(scheme.prefix);
}

export function buildGitDiffDocumentPath(
  side: GitDiffDocumentSide,
  filePath: string,
): string {
  return `${gitDiffDocumentScheme.prefix}${side}:${filePath}`;
}

export function buildGitHistoryDiffDocumentPath(
  commitHash: string,
  filePath: string,
  previousFilePath: string | null,
): string {
  const suffix = previousFilePath && previousFilePath !== filePath
    ? `${previousFilePath}->${filePath}`
    : filePath;

  return `${gitHistoryDiffDocumentScheme.prefix}${commitHash}:${suffix}`;
}

export function buildMarkdownPreviewDocumentPath(sourcePath: string): string {
  return `${markdownPreviewDocumentScheme.prefix}${sourcePath}`;
}

export function isGitDiffDocumentPath(path: string): boolean {
  return matchesTransientScheme(gitDiffDocumentScheme, path);
}

export function isGitHistoryDiffDocumentPath(path: string): boolean {
  return matchesTransientScheme(gitHistoryDiffDocumentScheme, path);
}

export function isMarkdownPreviewDocumentPath(path: string): boolean {
  return matchesTransientScheme(markdownPreviewDocumentScheme, path);
}

export function isPersistableEditorDocumentPath(path: string): boolean {
  return transientEditorDocumentSchemes.every(
    (scheme) => !matchesTransientScheme(scheme, path),
  );
}
