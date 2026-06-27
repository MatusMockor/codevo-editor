import type { LanguageServerWorkspaceEdit } from "./languageServerFeatures";

export type FileEntryKind = "directory" | "file";

export interface FileEntry {
  name: string;
  path: string;
  kind: FileEntryKind;
}

export interface FileSearchResult {
  name: string;
  path: string;
  relativePath: string;
}

export interface TextSearchResult {
  path: string;
  relativePath: string;
  lineNumber: number;
  column: number;
  lineText: string;
  /**
   * 0-based char offset of the match start within `lineText`. The backend always
   * supplies this; it is optional so legacy/internal mock results without a span
   * still type-check (the preview then renders the line without a highlight).
   */
  matchStart?: number;
  /** 0-based char offset of the match end (exclusive) within `lineText`. */
  matchEnd?: number;
}

/** One file changed by a Replace-in-Path run. */
export interface ReplaceInPathFileResult {
  path: string;
  relativePath: string;
  replacements: number;
}

/**
 * Outcome of a Replace-in-Path run: the files actually changed plus the total
 * number of replacements applied. Files whose content was unchanged are omitted.
 */
export interface ReplaceInPathResult {
  files: ReplaceInPathFileResult[];
  totalReplacements: number;
}

/**
 * Find-in-Path filters. All-default ({@link defaultTextSearchOptions})
 * reproduces a literal, case-insensitive, unfiltered search so existing callers
 * (Laravel magic resolution, etc.) keep their original behaviour.
 */
export interface TextSearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  isRegex: boolean;
  /**
   * Comma- or newline-separated glob list. A leading `!` excludes. Examples:
   * `*.php`, `app/**`, `!vendor`, `*.php,!**\/migrations\/**`.
   */
  fileMask: string;
}

export function defaultTextSearchOptions(): TextSearchOptions {
  return {
    caseSensitive: false,
    wholeWord: false,
    isRegex: false,
    fileMask: "",
  };
}

export interface WorkspaceDescriptor {
  rootPath: string;
  php: PhpProjectDescriptor | null;
  javaScriptTypeScript: JavaScriptTypeScriptProjectDescriptor | null;
}

export interface PhpProjectDescriptor {
  classmapRoots: ClassmapRoot[];
  hasComposer: boolean;
  packageName: string | null;
  packages: ComposerPackageDescriptor[];
  phpPlatformVersion: string | null;
  phpVersionConstraint: string | null;
  psr4Roots: Psr4Root[];
}

export interface ClassmapRoot {
  paths: string[];
  dev: boolean;
}

export interface ComposerPackageDescriptor {
  classmapRoots: ClassmapRoot[];
  dev: boolean;
  installPath: string | null;
  name: string;
  packageType: string | null;
  psr4Roots: Psr4Root[];
  version: string | null;
}

export interface Psr4Root {
  namespace: string;
  paths: string[];
  dev: boolean;
}

export interface JavaScriptTypeScriptProjectDescriptor {
  hasPackageJson: boolean;
  hasTsconfig: boolean;
  hasJsconfig: boolean;
  packageName: string | null;
  packageManager: string | null;
  frameworks: string[];
  typeScriptDependencyVersion: string | null;
  usesTypeScript: boolean;
  workspaceTypeScriptVersion: string | null;
}

export function javaScriptTypeScriptWorkspaceLabel(
  descriptor: JavaScriptTypeScriptProjectDescriptor,
  typeScriptVersionPreference: string,
): string {
  const packageName = descriptor.packageName || "JavaScript/TypeScript";
  const frameworkLabel =
    descriptor.frameworks.length > 0
      ? descriptor.frameworks.slice(0, 3).join(" + ")
      : null;
  const typeScriptLabel = javaScriptTypeScriptVersionLabel(
    descriptor,
    typeScriptVersionPreference,
  );
  const languageLabel = descriptor.usesTypeScript
    ? "TypeScript"
    : descriptor.hasJsconfig
      ? "JavaScript"
      : "JS/TS";
  const parts = [
    packageName,
    frameworkLabel,
    languageLabel,
    javaScriptTypeScriptProjectScopeLabel(descriptor),
    typeScriptLabel,
    descriptor.packageManager,
  ].filter((part): part is string => Boolean(part));

  return parts.join(" · ");
}

export function javaScriptTypeScriptProjectScopeLabel(
  descriptor: JavaScriptTypeScriptProjectDescriptor,
): string {
  if (descriptor.hasTsconfig || descriptor.hasJsconfig) {
    return "Project-wide";
  }

  return "Inferred (partial)";
}

export function javaScriptTypeScriptVersionLabel(
  descriptor: JavaScriptTypeScriptProjectDescriptor,
  preference: string,
): string | null {
  if (!descriptor.usesTypeScript) {
    return null;
  }

  if (preference === "workspace") {
    if (descriptor.workspaceTypeScriptVersion) {
      return `TS ${descriptor.workspaceTypeScriptVersion} workspace`;
    }

    if (descriptor.typeScriptDependencyVersion) {
      return `TS ${descriptor.typeScriptDependencyVersion} dependency`;
    }

    return "TS workspace missing";
  }

  if (descriptor.workspaceTypeScriptVersion) {
    return `TS bundled · workspace ${descriptor.workspaceTypeScriptVersion}`;
  }

  return "TS bundled";
}

export interface PhpToolAvailability {
  phpactor: ToolLocation | null;
  intelephense: ToolLocation | null;
}

export interface ToolLocation {
  executable: string;
  path: string;
  source:
    | "bundledNodeModulesBin"
    | "managed"
    | "path"
    | "workspaceNodeModulesBin"
    | "workspaceVendorBin";
}

export interface EditorDocument {
  path: string;
  name: string;
  content: string;
  savedContent: string;
  language: string;
  readOnly?: boolean;
}

export type IntelligenceMode = "basic" | "lightSmart" | "fullSmart";

export interface WorkspaceFileGateway {
  applyWorkspaceEdit(
    rootPath: string,
    edit: LanguageServerWorkspaceEdit,
    skippedPaths: string[],
  ): Promise<number>;
  createDirectory(path: string): Promise<void>;
  createTextFile(path: string): Promise<void>;
  deletePath(path: string): Promise<void>;
  readDirectory(path: string): Promise<FileEntry[]>;
  readTextFile(path: string): Promise<string>;
  renamePath(from: string, to: string): Promise<void>;
  writeTextFile(path: string, content: string): Promise<void>;
}

export interface WorkspaceDetectionGateway {
  detectWorkspace(path: string): Promise<WorkspaceDescriptor>;
}

export type ManagedPhpactorInstallUnsubscribeFn = () => void;

export interface ManagedPhpactorInstallCompletionEvent {
  root: string;
  error: string | null;
}

export interface PhpToolGateway {
  detectPhpTools(workspaceRoot: string | null): Promise<PhpToolAvailability>;
  /**
   * Starts the managed PHPactor install on a background thread and resolves as
   * soon as the work has been scheduled. The long-running composer steps run
   * off the UI thread; completion (success or failure) is delivered through
   * {@link subscribeManagedPhpactorInstall}.
   */
  installManagedPhpactor(root: string): Promise<void>;
  subscribeManagedPhpactorInstall(
    listener: (event: ManagedPhpactorInstallCompletionEvent) => void,
  ): Promise<ManagedPhpactorInstallUnsubscribeFn>;
}

export interface FileSearchGateway {
  searchFiles(
    root: string,
    query: string,
    limit: number,
  ): Promise<FileSearchResult[]>;
}

export interface TextSearchGateway {
  searchText(
    root: string,
    query: string,
    limit: number,
    options?: TextSearchOptions,
  ): Promise<TextSearchResult[]>;
  replaceInPath(
    root: string,
    query: string,
    replacement: string,
    options?: TextSearchOptions,
    scopePath?: string,
  ): Promise<ReplaceInPathResult>;
}

export function getFileName(path: string): string {
  const normalized = path.split("\\").join("/").replace(/\/+$/, "");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || path;
}

export function detectLanguage(path: string): string {
  const fileName = getFileName(path).toLowerCase();

  if (fileName.endsWith(".blade.php")) {
    return "blade";
  }

  const parts = fileName.split(".");
  const extension = parts[parts.length - 1]?.toLowerCase();

  if (!extension) {
    return "plaintext";
  }

  const languages: Record<string, string> = {
    css: "css",
    html: "html",
    cjs: "javascript",
    cts: "typescript",
    js: "javascript",
    json: "json",
    jsx: "javascript",
    md: "markdown",
    mjs: "javascript",
    mts: "typescript",
    php: "php",
    rs: "rust",
    ts: "typescript",
    tsx: "typescript",
    xml: "xml",
    yaml: "yaml",
    yml: "yaml",
  };

  return languages[extension] || "plaintext";
}

export function isDirty(document: EditorDocument): boolean {
  return document.content !== document.savedContent;
}

export function visibleEditorPaths(
  openPaths: string[],
  previewPath: string | null,
): string[] {
  if (!previewPath) {
    return openPaths;
  }

  if (openPaths.includes(previewPath)) {
    return openPaths;
  }

  return [...openPaths, previewPath];
}

export function nextActiveEditorPathAfterClose(
  closedPath: string,
  openPaths: string[],
  previewPath: string | null,
): string | null {
  const remainingPaths = visibleEditorPaths(openPaths, previewPath).filter(
    (path) => path !== closedPath,
  );

  return remainingPaths[remainingPaths.length - 1] || null;
}

export function getParentPath(path: string): string {
  const normalized = path.split("\\").join("/");
  const index = normalized.lastIndexOf("/");

  if (index <= 0) {
    return normalized;
  }

  return normalized.slice(0, index);
}

export function joinWorkspacePath(rootPath: string, relativePath: string): string {
  const normalizedRootPath = rootPath
    .trim()
    .split("\\")
    .join("/")
    .replace(/\/+$/, "");
  const normalizedRelativePath = relativePath
    .trim()
    .split("\\")
    .join("/")
    .replace(/^\/+/, "");

  if (!normalizedRelativePath) {
    return normalizedRootPath;
  }

  return `${normalizedRootPath}/${normalizedRelativePath}`;
}

export function workspaceRelativePath(
  rootPath: string,
  absolutePath: string,
): string | null {
  const normalizedRootPath = rootPath
    .trim()
    .split("\\")
    .join("/")
    .replace(/\/+$/, "");
  const normalizedAbsolutePath = absolutePath
    .trim()
    .split("\\")
    .join("/")
    .replace(/\/+$/, "");
  const prefix = `${normalizedRootPath}/`;

  if (!normalizedAbsolutePath.startsWith(prefix)) {
    return null;
  }

  const relativePath = normalizedAbsolutePath.slice(prefix.length);

  return relativePath || null;
}
