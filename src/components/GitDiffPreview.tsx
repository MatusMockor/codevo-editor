import { DiffEditor } from "@monaco-editor/react";
import { ChevronDown, ChevronUp, RotateCcw, X } from "lucide-react";
import {
  type ComponentProps,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type * as Monaco from "monaco-editor";
import {
  defaultEditorFontFamily,
  defaultEditorFontLigatures,
  defaultEditorFontSize,
  monacoFontLigaturesForEditorSetting,
  type MonacoAppTheme,
} from "../domain/settings";
import type {
  GitChangedFile,
  GitChangeStatus,
  GitDiffHunk,
  GitFileDiff,
} from "../domain/git";
import {
  applyImmediateFallbackTheme,
  setupShikiTokenization,
} from "../infrastructure/shikiHighlighter";

interface GitDiffPreviewProps {
  diff: GitFileDiff | null;
  isLoading: boolean;
  monacoTheme: MonacoAppTheme;
  previewIdentity?: string;
  editorFontFamily?: string;
  editorFontLigatures?: boolean;
  editorFontSize?: number;
  gitOperationLoading?: boolean;
  onClose(): void;
  onRevertFile?(change: GitChangedFile): void;
  loadFileHunks?(change: GitChangedFile, staged: boolean): Promise<GitDiffHunk[]>;
  onStageHunk?(change: GitChangedFile, hunkIndex: number, expectedIdentity: string): void;
  onUnstageHunk?(change: GitChangedFile, hunkIndex: number, expectedIdentity: string): void;
}

type DiffNavigationTarget = "next" | "previous";
type DiffFallbackReason = "binary" | "large" | "metadata" | "unchanged" | null;

const MAX_DIFF_CONTENT_BYTES = 2_000_000;
const MAX_DIFF_LINE_COUNT = 50_000;

interface LoadedGitDiffHunks {
  hunks: GitDiffHunk[];
  selectionIdentity: string | null;
}

export function GitDiffPreview({
  diff,
  isLoading,
  monacoTheme,
  previewIdentity,
  editorFontFamily = defaultEditorFontFamily,
  editorFontLigatures = defaultEditorFontLigatures,
  editorFontSize = defaultEditorFontSize,
  gitOperationLoading = false,
  onClose,
  onRevertFile,
  loadFileHunks,
  onStageHunk,
  onUnstageHunk,
}: GitDiffPreviewProps) {
  const [loadedHunks, setLoadedHunks] = useState<LoadedGitDiffHunks>({
    hunks: [],
    selectionIdentity: null,
  });
  const [lineChanges, setLineChanges] = useState<Monaco.editor.ILineChange[]>([]);
  const [activeChangeIndex, setActiveChangeIndex] = useState(-1);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const diffEditorRef = useRef<Monaco.editor.IStandaloneDiffEditor | null>(null);
  const diffListenerRef = useRef<Monaco.IDisposable | null>(null);
  const hunkWidgetsRef = useRef<GitDiffHunkWidgetRegistration[]>([]);
  const monacoRef = useRef<Parameters<typeof setupShikiTokenization>[0] | null>(
    null,
  );
  const requestedThemeRef = useRef<MonacoAppTheme | null>(null);
  const themeRequestRef = useRef(0);
  const previewInstanceId = useId();
  const changeRelativePath = diff?.change.relativePath ?? null;
  const changeIsStaged = diff?.change.isStaged ?? false;
  const changeStatus = diff?.change.status ?? null;
  const hunkSelectionIdentity = gitDiffHunkSelectionIdentity(
    diff?.change ?? null,
    previewIdentity,
  );
  const currentHunkSelectionIdentityRef = useRef(hunkSelectionIdentity);
  currentHunkSelectionIdentityRef.current = hunkSelectionIdentity;
  const loadedHunkSelectionIdentityRef = useRef(loadedHunks.selectionIdentity);
  loadedHunkSelectionIdentityRef.current = loadedHunks.selectionIdentity;
  const hunks =
    loadedHunks.selectionIdentity === hunkSelectionIdentity
      ? loadedHunks.hunks
      : [];
  const originalContent = safeDiffContent(diff?.originalContent);
  const modifiedContent = safeDiffContent(diff?.modifiedContent);
  const fallbackReason = useMemo(
    () => diffFallbackReason(diff, originalContent, modifiedContent),
    [diff, modifiedContent, originalContent],
  );
  const supportsHunkStaging =
    !diff?.previewUnavailableReason &&
    Boolean(loadFileHunks) &&
    changeStatus !== null &&
    changeStatus !== "untracked" &&
    changeStatus !== "conflicted";
  const modelPaths = useMemo(
    () =>
      gitDiffModelPaths(
        diff?.change ?? null,
        previewInstanceId,
        previewIdentity,
      ),
    [
      changeIsStaged,
      changeRelativePath,
      diff?.change.path,
      previewIdentity,
      previewInstanceId,
    ],
  );
  const fontLigatures = monacoFontLigaturesForEditorSetting(
    editorFontLigatures,
  );

  const disposeHunkWidgets = useCallback(() => {
    for (const registration of hunkWidgetsRef.current) {
      registration.dispose();
    }

    hunkWidgetsRef.current = [];
  }, []);

  const requestThemeSetup = useCallback(
    (
      monaco: Parameters<typeof setupShikiTokenization>[0],
      theme: MonacoAppTheme,
    ) => {
      const request = ++themeRequestRef.current;
      monacoRef.current = monaco;
      requestedThemeRef.current = theme;
      applyImmediateFallbackTheme(monaco, theme);

      setupShikiTokenization(monaco, theme, {
        shouldApply: () =>
          request === themeRequestRef.current && monacoRef.current === monaco,
      }).catch((error) => {
        if (request !== themeRequestRef.current) {
          return;
        }

        console.error("Shiki tokenization setup failed", error);
      });
    },
    [],
  );

  useEffect(() => {
    setActiveChangeIndex(-1);
    setLineChanges([]);
  }, [changeIsStaged, changeRelativePath, modifiedContent, originalContent]);

  useLayoutEffect(() => {
    const change = diff?.change;

    setLoadedHunks({ hunks: [], selectionIdentity: null });
    if (
      !loadFileHunks ||
      !change ||
      !supportsHunkStaging ||
      !hunkSelectionIdentity
    ) {
      return;
    }

    let cancelled = false;
    const staged = changeIsStaged;
    const selectionIdentity = hunkSelectionIdentity;

    void Promise.resolve()
      .then(() => loadFileHunks(change, staged))
      .then((loaded) => {
        if (
          cancelled ||
          currentHunkSelectionIdentityRef.current !== selectionIdentity
        ) {
          return;
        }

        setLoadedHunks({
          hunks: normalizeGitDiffHunks(loaded),
          selectionIdentity,
        });
      })
      .catch((error) => {
        console.error("Loading git file hunks failed", error);

        if (cancelled) {
          return;
        }

        if (currentHunkSelectionIdentityRef.current !== selectionIdentity) {
          return;
        }

        setLoadedHunks({ hunks: [], selectionIdentity: null });
      });

    return () => {
      cancelled = true;
    };
  }, [
    changeIsStaged,
    changeRelativePath,
    hunkSelectionIdentity,
    modifiedContent,
    originalContent,
    loadFileHunks,
    supportsHunkStaging,
  ]);

  useEffect(
    () => () => {
      themeRequestRef.current += 1;
      monacoRef.current = null;
      requestedThemeRef.current = null;
      diffListenerRef.current?.dispose();
      diffListenerRef.current = null;
      disposeHunkWidgets();
      diffEditorRef.current = null;
    },
    [disposeHunkWidgets],
  );

  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco || requestedThemeRef.current === monacoTheme) {
      return;
    }

    requestThemeSetup(monaco, monacoTheme);
  }, [monacoTheme, requestThemeSetup]);

  const refreshLineChanges = useCallback(
    (editor: Monaco.editor.IStandaloneDiffEditor) => {
      const next = editor.getLineChanges() ?? [];
      setLineChanges(next);
      setActiveChangeIndex((current) => {
        if (next.length === 0) {
          return -1;
        }

        return Math.min(Math.max(current, 0), next.length - 1);
      });

      for (const registration of hunkWidgetsRef.current) {
        registration.editor.layoutContentWidget(registration.widget);
      }
    },
    [],
  );

  const onDiffEditorMount = useCallback(
    (editor: Monaco.editor.IStandaloneDiffEditor) => {
      diffListenerRef.current?.dispose();
      disposeHunkWidgets();
      diffEditorRef.current = editor;
      setEditorEpoch((current) => current + 1);
      refreshLineChanges(editor);
      diffListenerRef.current = editor.onDidUpdateDiff(() => {
        refreshLineChanges(editor);
      });
    },
    [disposeHunkWidgets, refreshLineChanges],
  );

  const onDiffEditorRelease = useCallback(
    (editor: Monaco.editor.IStandaloneDiffEditor) => {
      if (diffEditorRef.current !== editor) {
        return;
      }

      diffListenerRef.current?.dispose();
      diffListenerRef.current = null;
      disposeHunkWidgets();
      diffEditorRef.current = null;
    },
    [disposeHunkWidgets],
  );

  const goToChange = useCallback(
    (target: DiffNavigationTarget) => {
      const editor = diffEditorRef.current;
      if (!editor || lineChanges.length === 0) {
        return;
      }

      const direction = target === "next" ? 1 : -1;
      const current = activeChangeIndex < 0 ? (target === "next" ? -1 : 0) : activeChangeIndex;
      const nextIndex = (current + direction + lineChanges.length) % lineChanges.length;
      const lineChange = lineChanges[nextIndex];
      if (!lineChange) {
        return;
      }

      setActiveChangeIndex(nextIndex);
      revealLogicalChange(editor, lineChange);
    },
    [activeChangeIndex, lineChanges],
  );

  const onToggleHunk = useCallback(
    (hunkIndex: number, hunkIdentity: string, selectionIdentity: string) => {
      const change = diff?.change;
      if (
        !change ||
        gitOperationLoading ||
        selectionIdentity !== currentHunkSelectionIdentityRef.current ||
        selectionIdentity !== loadedHunkSelectionIdentityRef.current
      ) {
        return;
      }

      if (change.isStaged) {
        onUnstageHunk?.(change, hunkIndex, hunkIdentity);
        return;
      }

      onStageHunk?.(change, hunkIndex, hunkIdentity);
    },
    [diff?.change, gitOperationLoading, onStageHunk, onUnstageHunk],
  );

  useLayoutEffect(() => {
    disposeHunkWidgets();
    const editor = diffEditorRef.current;
    if (
      !editor ||
      !supportsHunkStaging ||
      !hunkSelectionIdentity ||
      hunks.length === 0
    ) {
      return;
    }

    hunkWidgetsRef.current = createGitDiffHunkWidgets(
      editor.getModifiedEditor(),
      hunks,
      changeIsStaged,
      gitOperationLoading,
      hunkSelectionIdentity,
      onToggleHunk,
    );

    return disposeHunkWidgets;
  }, [
    changeIsStaged,
    disposeHunkWidgets,
    editorEpoch,
    gitOperationLoading,
    hunkSelectionIdentity,
    hunks,
    onToggleHunk,
    supportsHunkStaging,
  ]);

  const onRevert = useCallback(() => {
    if (!diff || !onRevertFile) {
      return;
    }

    onRevertFile(diff.change);
  }, [diff, onRevertFile]);

  if (isLoading) {
    return <EmptyDiff message="Loading diff" />;
  }

  if (!diff) {
    return <EmptyDiff message="Select a changed file to preview diff." />;
  }

  return (
    <section className="git-diff-preview" aria-label="Git diff">
      <header className="git-diff-header">
        <div>
          <strong>{diff.change.relativePath}</strong>
          <span>{diff.change.status}</span>
        </div>
        <div className="git-diff-toolbar" aria-label="Diff actions">
          <button
            aria-label="Previous change"
            disabled={lineChanges.length === 0}
            onClick={() => goToChange("previous")}
            title="Previous change"
            type="button"
          >
            <ChevronUp aria-hidden="true" size={14} />
          </button>
          <button
            aria-label="Next change"
            disabled={lineChanges.length === 0}
            onClick={() => goToChange("next")}
            title="Next change"
            type="button"
          >
            <ChevronDown aria-hidden="true" size={14} />
          </button>
          {onRevertFile ? (
            <button aria-label="Revert file" onClick={onRevert} title="Revert file" type="button">
              <RotateCcw aria-hidden="true" size={14} />
            </button>
          ) : null}
          <button aria-label="Close diff" onClick={onClose} title="Close diff" type="button">
            <X aria-hidden="true" size={14} />
          </button>
        </div>
      </header>
      <div className="git-diff-pane-labels" aria-label="Compared versions">
        <span>{changeIsStaged ? "HEAD" : "Index"}</span>
        <span>{changeIsStaged ? "Staged" : "Working tree"}</span>
      </div>
      <div className="git-diff-editor" data-testid="git-monaco-diff">
        {fallbackReason ? (
          <GitDiffFallback change={diff.change} reason={fallbackReason} />
        ) : (
          <ManagedGitDiffEditor
            beforeMount={(monaco) => requestThemeSetup(monaco, monacoTheme)}
            height="100%"
            key={`${modelPaths.original}:${modelPaths.modified}`}
            language={diff.language || "plaintext"}
            modified={modifiedContent}
            modifiedModelPath={modelPaths.modified}
            onMount={onDiffEditorMount}
            onRelease={onDiffEditorRelease}
            options={{
              automaticLayout: true,
              diffAlgorithm: "advanced",
              enableSplitViewResizing: true,
              fontFamily: editorFontFamily,
              fontLigatures,
              fontSize: editorFontSize,
              ignoreTrimWhitespace: false,
              lineHeight: 20,
              minimap: { enabled: false },
              modifiedAriaLabel: "Current file content",
              originalAriaLabel: "Base file content",
              originalEditable: false,
              readOnly: true,
              renderIndicators: true,
              renderMarginRevertIcon: false,
              renderOverviewRuler: true,
              renderSideBySide: true,
              scrollBeyondLastLine: false,
              useInlineViewWhenSpaceIsLimited: false,
            }}
            original={originalContent}
            originalModelPath={modelPaths.original}
            theme={monacoTheme}
          />
        )}
      </div>
    </section>
  );
}

interface ManagedGitDiffEditorProps
  extends ComponentProps<typeof DiffEditor> {
  onRelease(editor: Monaco.editor.IStandaloneDiffEditor): void;
}

function ManagedGitDiffEditor({
  onMount,
  onRelease,
  ...props
}: ManagedGitDiffEditorProps) {
  const editorRef = useRef<Monaco.editor.IStandaloneDiffEditor | null>(null);
  const onReleaseRef = useRef(onRelease);
  onReleaseRef.current = onRelease;

  const handleMount = useCallback<NonNullable<ManagedGitDiffEditorProps["onMount"]>>(
    (editor, monaco) => {
      if (!editorRef.current) {
        editorRef.current = editor;
      }

      onMount?.(editor, monaco);
    },
    [onMount],
  );

  useLayoutEffect(
    () => () => {
      const editor = editorRef.current;
      editorRef.current = null;
      if (!editor) {
        return;
      }

      onReleaseRef.current(editor);
      resetAndDisposeGitDiffModels(editor);
    },
    [],
  );

  return (
    <DiffEditor
      {...props}
      keepCurrentModifiedModel
      keepCurrentOriginalModel
      onMount={handleMount}
    />
  );
}

function resetAndDisposeGitDiffModels(
  editor: Monaco.editor.IStandaloneDiffEditor,
): void {
  const models = editor.getModel();
  editor.setModel(null);
  if (!models) {
    return;
  }

  disposeTextModel(models.original);
  if (models.modified === models.original) {
    return;
  }

  disposeTextModel(models.modified);
}

function disposeTextModel(model: Monaco.editor.ITextModel): void {
  if (model.isDisposed()) {
    return;
  }

  model.dispose();
}

function EmptyDiff({ message }: { message: string }) {
  return (
    <div className="empty-editor">
      <p>{message}</p>
    </div>
  );
}

function GitDiffFallback({
  change,
  reason,
}: {
  change: GitChangedFile;
  reason: Exclude<DiffFallbackReason, null>;
}) {
  if (reason === "metadata") {
    return (
      <div className="git-diff-fallback" role="status">
        <strong>File metadata changed</strong>
        <span>{metadataOnlyDiffText(change)}</span>
      </div>
    );
  }

  if (reason === "unchanged") {
    return (
      <div className="git-diff-fallback" role="status">
        <strong>No differences</strong>
        <span>The compared file contents are identical.</span>
      </div>
    );
  }

  return (
    <div className="git-diff-fallback" role="status">
      <strong>{reason === "binary" ? "Binary diff" : "Large diff"}</strong>
      <span>
        {reason === "binary"
          ? "Binary file contents cannot be previewed."
          : "This file is too large for an interactive diff preview."}
      </span>
    </div>
  );
}

interface GitDiffHunkWidgetRegistration {
  dispose(): void;
  editor: Monaco.editor.IStandaloneCodeEditor;
  widget: Monaco.editor.IContentWidget;
}

function createGitDiffHunkWidgets(
  editor: Monaco.editor.IStandaloneCodeEditor,
  hunks: GitDiffHunk[],
  staged: boolean,
  disabled: boolean,
  selectionIdentity: string,
  onToggleHunk: (
    hunkIndex: number,
    hunkIdentity: string,
    selectionIdentity: string,
  ) => void,
): GitDiffHunkWidgetRegistration[] {
  const registrations: GitDiffHunkWidgetRegistration[] = [];
  const actionVerb = staged ? "Unstage" : "Stage";
  const lineCount = editor.getModel()?.getLineCount() ?? Number.MAX_SAFE_INTEGER;

  for (const hunk of hunks) {
    const domNode = document.createElement("label");
    const label = `${actionVerb} hunk ${hunk.index + 1}`;
    domNode.className = "git-diff-hunk";
    domNode.title = `${label}: ${hunk.header}`;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = staged;
    checkbox.disabled = disabled;
    checkbox.setAttribute("aria-label", label);
    checkbox.title = label;

    const icon = document.createElement("span");
    icon.className = "git-diff-hunk-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = staged ? "-" : "+";
    domNode.append(checkbox, icon);

    const handleChange = () =>
      onToggleHunk(hunk.index, hunk.identity, selectionIdentity);
    checkbox.addEventListener("change", handleChange);
    const lineNumber = Math.min(Math.max(hunk.modifiedStart, 1), lineCount);
    const widget: Monaco.editor.IContentWidget = {
      allowEditorOverflow: false,
      getDomNode: () => domNode,
      getId: () => `git-diff-hunk-${hunk.index}`,
      getPosition: () => ({
        position: { column: 1, lineNumber },
        preference: [0],
      }),
      suppressMouseDown: true,
    };

    editor.addContentWidget(widget);
    registrations.push({
      dispose: () => {
        checkbox.removeEventListener("change", handleChange);
        editor.removeContentWidget(widget);
        domNode.remove();
      },
      editor,
      widget,
    });
  }

  return registrations;
}

function revealLogicalChange(
  editor: Monaco.editor.IStandaloneDiffEditor,
  change: Monaco.editor.ILineChange,
): void {
  const originalLine = Math.max(1, change.originalStartLineNumber);
  const modifiedLine = Math.max(1, change.modifiedStartLineNumber);
  const originalEditor = editor.getOriginalEditor();
  const modifiedEditor = editor.getModifiedEditor();

  originalEditor.revealLineInCenter(originalLine);
  modifiedEditor.revealLineInCenter(modifiedLine);
  modifiedEditor.setPosition({ column: 1, lineNumber: modifiedLine });
  modifiedEditor.focus();
}

function gitDiffModelPaths(
  change: GitChangedFile | null,
  previewInstanceId: string,
  previewIdentity?: string,
): { modified: string; original: string } {
  const owner = encodeURIComponent(previewInstanceId);
  const revision = encodeURIComponent(previewIdentity ?? "current");
  if (!change) {
    return {
      modified: `codevo-git-diff:///empty/modified/${owner}/${revision}`,
      original: `codevo-git-diff:///empty/original/${owner}/${revision}`,
    };
  }

  const scope = encodeURIComponent(change.path || change.relativePath);
  const surface = change.isStaged ? "staged" : "worktree";
  return {
    modified: `codevo-git-diff:///${surface}/modified/${owner}/${revision}/${scope}`,
    original: `codevo-git-diff:///${surface}/original/${owner}/${revision}/${scope}`,
  };
}

function gitDiffHunkSelectionIdentity(
  change: GitChangedFile | null,
  previewIdentity?: string,
): string | null {
  if (!change) {
    return null;
  }

  return JSON.stringify([
    previewIdentity ?? "",
    change.path,
    change.relativePath,
    change.isStaged,
  ]);
}

function diffFallbackReason(
  diff: GitFileDiff | null,
  originalContent: string,
  modifiedContent: string,
): DiffFallbackReason {
  if (!diff) {
    return null;
  }

  if (diff.previewUnavailableReason) {
    return diff.previewUnavailableReason;
  }

  if (originalContent.includes("\0") || modifiedContent.includes("\0")) {
    return "binary";
  }

  const combinedLength = originalContent.length + modifiedContent.length;
  if (combinedLength > MAX_DIFF_CONTENT_BYTES) {
    return "large";
  }

  const lineCount = countLines(originalContent) + countLines(modifiedContent);
  if (lineCount > MAX_DIFF_LINE_COUNT) {
    return "large";
  }

  if (originalContent === modifiedContent) {
    if (shouldRenderMetadataOnlyDiff(diff.change)) {
      return "metadata";
    }

    return "unchanged";
  }

  return null;
}

function countLines(content: string): number {
  if (content.length === 0) {
    return 0;
  }

  let count = 1;
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) {
      count += 1;
    }
  }

  return count;
}

function safeDiffContent(content: unknown): string {
  return typeof content === "string" ? content : "";
}

function normalizeGitDiffHunks(loaded: unknown): GitDiffHunk[] {
  if (!Array.isArray(loaded)) {
    return [];
  }

  const hunks: GitDiffHunk[] = [];
  for (const hunk of loaded) {
    if (!isRenderableGitDiffHunk(hunk)) {
      continue;
    }

    hunks.push({
      header: hunk.header,
      identity: hunk.identity,
      index: hunk.index,
      isStaged: hunk.isStaged,
      lines: hunk.lines.filter((line): line is string => typeof line === "string"),
      modifiedCount: hunk.modifiedCount,
      modifiedStart: hunk.modifiedStart,
      originalCount: hunk.originalCount,
      originalStart: hunk.originalStart,
    });
  }

  return hunks;
}

function isRenderableGitDiffHunk(hunk: unknown): hunk is GitDiffHunk {
  if (!hunk || typeof hunk !== "object") {
    return false;
  }

  const candidate = hunk as Partial<GitDiffHunk>;
  return (
    typeof candidate.header === "string" &&
    typeof candidate.identity === "string" &&
    candidate.identity.length > 0 &&
    typeof candidate.index === "number" &&
    Number.isInteger(candidate.index) &&
    candidate.index >= 0 &&
    Array.isArray(candidate.lines) &&
    typeof candidate.isStaged === "boolean" &&
    isNonNegativeInteger(candidate.originalStart) &&
    isNonNegativeInteger(candidate.originalCount) &&
    isNonNegativeInteger(candidate.modifiedStart) &&
    isNonNegativeInteger(candidate.modifiedCount)
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function shouldRenderMetadataOnlyDiff(change: GitChangedFile): boolean {
  return change.status !== "modified" || Boolean(change.oldRelativePath);
}

function metadataOnlyDiffText(change: GitChangedFile): string {
  if (change.status === "renamed") {
    const from = change.oldRelativePath ?? change.oldPath ?? "previous path";
    return `Renamed: ${from} -> ${change.relativePath}`;
  }

  return `${metadataOnlyDiffStatusLabel(change.status)}: ${change.relativePath}`;
}

function metadataOnlyDiffStatusLabel(status: GitChangeStatus): string {
  if (status === "added") {
    return "Added";
  }

  if (status === "deleted") {
    return "Deleted";
  }

  if (status === "untracked") {
    return "Untracked";
  }

  if (status === "conflicted") {
    return "Conflicted";
  }

  return "Changed";
}
