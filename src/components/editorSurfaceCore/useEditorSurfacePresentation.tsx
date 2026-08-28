import type { OnMount } from "@monaco-editor/react";
import { ChevronDown, ChevronUp, RotateCcw, X } from "lucide-react";
import {
  useCallback,
  useMemo,
  Suspense,
  type Dispatch,
  type MutableRefObject,
  type ReactElement,
  type SetStateAction,
} from "react";
import type * as Monaco from "monaco-editor";
import { breadcrumbPathFromCursorAndSymbols } from "../../domain/breadcrumbs";
import type { Breakpoint } from "../../domain/debug";
import type { DebugBreakpointManagement } from "../../application/useDebugBreakpointManagement";
import type { EditorSessionOwnerKey } from "../../domain/editorSessionOwnerKey";
import type {
  EditorPosition,
  LanguageServerDocumentSymbol,
} from "../../domain/languageServerFeatures";
import type { MonacoAppTheme } from "../../domain/settings";
import type { EditorDocument } from "../../domain/workspace";
import {
  LARGE_SMART_DOCUMENT_STATUS_LABEL,
  type LargeSmartDocumentStatus,
} from "../../domain/largeDocumentPolicy";
import { Breadcrumbs } from "../Breadcrumbs";
import { CursorAwareBreadcrumbs } from "../CursorAwareBreadcrumbs";
import {
  EditorBreakpointGutterMenu,
  type EditorBreakpointGutterActions,
} from "../EditorBreakpointGutterMenu";
import { type EditorRuntimeContextValue } from "../editorRuntimeContext";
import {
  editorSurfaceControlledValue,
  editorSurfaceModelPath,
} from "../editorSurfaceLiveModelContentAuthority";
import { modelForPath } from "../editorSurfaceModelIdentity";
import {
  changePreviewText,
  editorChangeKindLabel,
  editorChangePopoverStyle,
  navigateChangeHunkFromPopover,
} from "../editorChangeMonacoMappings";
import type { EditorCursorStorePort } from "../../application/editorCursorStore";
import {
  beforeMonacoMount,
  EDITOR_LOADING_PLACEHOLDER,
  EMPTY_BREADCRUMB_PATH,
  PLACEHOLDER_LANGUAGE,
  PLACEHOLDER_PATH,
} from "./presentation";
import type { EditorChangePreviewState } from "./useEditorMouseInteractions";
import { SurroundWithPicker } from "../SurroundWithPicker";
import { applySurroundWith, type SurroundWithRequest } from "./editorCommands";
import { getTabId, getTabPanelId } from "../tabIds";
import type { LargeSmartDocumentPresentationMode } from "./useLargeSmartDocumentMetricsLifecycle";
import { initializeMonacoRuntime } from "../monacoRuntimeLoader";
import { retryableLazy } from "../retryableLazy";

const LazyMonacoEditor = retryableLazy<
  import("react").ComponentProps<typeof import("@monaco-editor/react").default>
>(async () => {
  await initializeMonacoRuntime();
  const module = await import("@monaco-editor/react");
  return { default: module.default };
}, "editor");

interface EditorSurfacePresentationOptions {
  readonly activateEditorGroupFromInteraction: () => void;
  readonly activeDocument: EditorDocument | null;
  readonly activeDocumentContentReady: boolean;
  readonly activeDocumentIsLargeSmart: boolean;
  readonly activeDocumentLargeSmartMode?: LargeSmartDocumentPresentationMode;
  readonly beforeMountTheme: MonacoAppTheme;
  readonly breakpointActions?: Partial<DebugBreakpointManagement>;
  readonly breakpoints: readonly Breakpoint[];
  readonly breadcrumbSymbols: LanguageServerDocumentSymbol[];
  readonly changeHunksRef: MutableRefObject<
    readonly import("../../domain/editorChangeMarkers").EditorChangeHunk[]
  >;
  readonly changePreview: EditorChangePreviewState | null;
  readonly cursorColumn?: number;
  readonly cursorLineNumber?: number;
  readonly cursorStore?: EditorCursorStorePort | null;
  readonly cursorTrackingActive: boolean;
  readonly editor: Monaco.editor.IStandaloneCodeEditor | null;
  readonly editorFontFamily: string;
  readonly editorFontSize: number;
  readonly embeddedInGroupPanel: boolean;
  readonly formatOnPaste: boolean;
  readonly groupId: string;
  readonly handleMount: OnMount;
  readonly isOpeningFile: boolean;
  readonly minimapEnabled: boolean;
  readonly modelIdentity: Monaco.editor.ITextModel | null;
  readonly monaco: typeof Monaco | null;
  readonly monacoFontLigatures: boolean | string;
  readonly onMutationError: (error: unknown) => void;
  readonly onRevertChangeHunk: (
    hunk: import("../../domain/editorChangeMarkers").EditorChangeHunk,
  ) => void;
  readonly runtime: EditorRuntimeContextValue | null;
  readonly runtimeMembershipGroupId?: string;
  readonly editorSessionOwnerKey: EditorSessionOwnerKey | null;
  readonly setChangePreview: Dispatch<SetStateAction<EditorChangePreviewState | null>>;
  readonly setSurroundWithRequest: Dispatch<SetStateAction<SurroundWithRequest | null>>;
  readonly surroundWithRequest: SurroundWithRequest | null;
  readonly toggleBreakpointFallback?: EditorBreakpointGutterActions["toggleBreakpoint"];
  readonly wordWrapEnabled: boolean;
  readonly workspaceRoot: string | null;
}

type LargeDocumentMonacoOptions = Pick<
  Monaco.editor.IStandaloneEditorConstructionOptions,
  | "autoIndent"
  | "bracketPairColorization"
  | "codeLens"
  | "folding"
  | "minimap"
  | "occurrencesHighlight"
  | "parameterHints"
  | "quickSuggestions"
  | "selectionHighlight"
  | "semanticHighlighting.enabled"
  | "stickyScroll"
  | "suggestOnTriggerCharacters"
  | "wordBasedSuggestions"
>;

/**
 * Keeps Monaco's structural work aligned with Codevo's lower large-document
 * threshold. Monaco's built-in large-file cutoff is intentionally independent
 * and can leave expensive editor features enabled for files that Codevo has
 * already placed in degraded mode.
 */
export function largeDocumentMonacoOptions(
  large: boolean,
  minimapEnabled: boolean,
): LargeDocumentMonacoOptions {
  return {
    autoIndent: large ? "keep" : "full",
    bracketPairColorization: { enabled: !large },
    codeLens: !large,
    folding: !large,
    minimap: { enabled: !large && minimapEnabled },
    occurrencesHighlight: large ? "off" : "singleFile",
    parameterHints: { enabled: !large, cycle: true },
    quickSuggestions: large ? false : { other: true, comments: false, strings: true },
    selectionHighlight: !large,
    "semanticHighlighting.enabled": !large,
    stickyScroll: { enabled: !large },
    suggestOnTriggerCharacters: !large,
    wordBasedSuggestions: large ? "off" : "matchingDocuments",
  };
}

export function largeDocumentFeatureNotice(
  minimapEnabled: boolean,
  mode: LargeSmartDocumentPresentationMode = "large-non-javascript-typescript",
): string {
  if (mode === "editing-degraded-interactive-lsp") {
    return "Large file mode: automatic and document-wide JavaScript/TypeScript analysis is reduced to keep editing responsive. Manual completion, definition, references, and rename remain available.";
  }
  if (mode === "editing-only") {
    return "Large file mode: JavaScript/TypeScript language features are unavailable because this document exceeds hard synchronization safety limits. Essential editing remains available.";
  }

  const reducedFeatures = [
    "semantic highlighting",
    "code folding",
    ...(minimapEnabled ? ["the minimap"] : []),
    "CodeLens",
    "automatic suggestions",
  ];
  const finalFeature = reducedFeatures[reducedFeatures.length - 1];
  const leadingFeatures = reducedFeatures.slice(0, -1).join(", ");

  return `Large file mode: ${leadingFeatures}, and ${finalFeature} are turned off to keep editing responsive.`;
}

export function largeDocumentPresentationStatus(
  minimapEnabled: boolean,
  mode: LargeSmartDocumentPresentationMode,
): LargeSmartDocumentStatus | null {
  return mode === "eligible"
    ? null
    : {
        label: LARGE_SMART_DOCUMENT_STATUS_LABEL,
        title: largeDocumentFeatureNotice(minimapEnabled, mode),
      };
}

/**
 * Builds the stable Monaco presentation and its local overlays without adding
 * rendering concerns back to the lifecycle composition root.
 */
export function useEditorSurfacePresentation({
  activateEditorGroupFromInteraction,
  activeDocument,
  activeDocumentContentReady,
  activeDocumentIsLargeSmart,
  activeDocumentLargeSmartMode = activeDocumentIsLargeSmart
    ? "large-non-javascript-typescript"
    : "eligible",
  beforeMountTheme,
  breakpointActions,
  breakpoints,
  breadcrumbSymbols,
  changeHunksRef,
  changePreview,
  cursorColumn,
  cursorLineNumber,
  cursorStore,
  cursorTrackingActive,
  editor,
  editorFontFamily,
  editorFontSize,
  editorSessionOwnerKey,
  embeddedInGroupPanel,
  formatOnPaste,
  groupId,
  handleMount,
  isOpeningFile,
  minimapEnabled,
  modelIdentity,
  monaco,
  monacoFontLigatures,
  onMutationError,
  onRevertChangeHunk,
  runtime,
  runtimeMembershipGroupId,
  setChangePreview,
  setSurroundWithRequest,
  surroundWithRequest,
  toggleBreakpointFallback,
  wordWrapEnabled,
  workspaceRoot,
}: EditorSurfacePresentationOptions): ReactElement {
  const activeDocumentPath = activeDocument?.path;
  const breadcrumbPath = useMemo(
    () =>
      activeDocumentPath && cursorLineNumber !== undefined && cursorColumn !== undefined
        ? breadcrumbPathFromCursorAndSymbols(
            { column: cursorColumn, lineNumber: cursorLineNumber },
            breadcrumbSymbols,
          )
        : EMPTY_BREADCRUMB_PATH,
    [activeDocumentPath, breadcrumbSymbols, cursorColumn, cursorLineNumber],
  );

  const navigateToBreadcrumbSymbol = useCallback(
    (symbol: LanguageServerDocumentSymbol) => {
      if (!editor) {
        return;
      }

      const position: EditorPosition = {
        lineNumber: symbol.selectionRange.start.line + 1,
        column: symbol.selectionRange.start.character + 1,
      };

      editor.setPosition(position);
      editor.revealPositionInCenter(position);
      editor.focus();
    },
    [editor],
  );

  const changePreviewStyle =
    activeDocument && changePreview && editor
      ? editorChangePopoverStyle(editor, changePreview.hunk, changePreview.anchorLineNumber)
      : undefined;

  const onPopoverGoToChange = useCallback(
    (direction: "next" | "previous") => {
      if (!editor) {
        return;
      }

      setChangePreview((current) => {
        if (!current) {
          return current;
        }

        const target = navigateChangeHunkFromPopover(
          editor,
          changeHunksRef.current,
          current.hunk.startLineNumber,
          direction,
        );

        return target
          ? {
              anchorLineNumber: target.startLineNumber,
              hunk: target,
            }
          : current;
      });
    },
    [changeHunksRef, editor, setChangePreview],
  );

  const isReadOnly = activeDocument?.readOnly === true;
  const handleBeforeMount = useCallback(
    (monacoApi: typeof Monaco) => beforeMonacoMount(monacoApi, beforeMountTheme),
    [beforeMountTheme],
  );
  const editorOptions = useMemo<Monaco.editor.IStandaloneEditorConstructionOptions>(
    () => ({
      automaticLayout: true,
      ...largeDocumentMonacoOptions(activeDocumentIsLargeSmart, minimapEnabled),
      detectIndentation: true,
      domReadOnly: isReadOnly,
      formatOnPaste,
      fontFamily: editorFontFamily,
      fontLigatures: monacoFontLigatures,
      fontSize: editorFontSize,
      glyphMargin: true,
      insertSpaces: true,
      largeFileOptimizations: true,
      lineHeight: 0,
      maxTokenizationLineLength: 2000,
      wordWrap: wordWrapEnabled ? "on" : "off",
      multiCursorModifier: "alt",
      padding: { top: 14, bottom: 14 },
      quickSuggestionsDelay: 10,
      readOnly: isReadOnly,
      scrollBeyondLastLine: false,
      smoothScrolling: false,
      stopRenderingLineAfter: 10000,
      tabSize: 2,
    }),
    [
      activeDocumentIsLargeSmart,
      editorFontFamily,
      editorFontSize,
      formatOnPaste,
      isReadOnly,
      minimapEnabled,
      monacoFontLigatures,
      wordWrapEnabled,
    ],
  );
  const overlay = activeDocument ? null : isOpeningFile ? (
    <div className="editor-empty-overlay" data-testid="editor-opening">
      <p>Opening file…</p>
    </div>
  ) : (
    <div className="editor-empty-overlay" data-testid="editor-empty">
      <p>Open a file to start editing.</p>
    </div>
  );
  const largeDocumentNotice = useMemo(
    () => largeDocumentFeatureNotice(minimapEnabled, activeDocumentLargeSmartMode),
    [activeDocumentLargeSmartMode, minimapEnabled],
  );

  return (
    <div
      aria-labelledby={
        !embeddedInGroupPanel && activeDocument ? getTabId(activeDocument.path, groupId) : undefined
      }
      className="editor-panel"
      id={
        !embeddedInGroupPanel && activeDocument
          ? getTabPanelId(activeDocument.path, groupId)
          : undefined
      }
      onFocusCapture={activateEditorGroupFromInteraction}
      onMouseDown={activateEditorGroupFromInteraction}
      role={embeddedInGroupPanel ? undefined : "tabpanel"}
    >
      {activeDocument ? (
        cursorStore && editorSessionOwnerKey && runtimeMembershipGroupId !== undefined ? (
          <CursorAwareBreadcrumbs
            documentPath={activeDocument.path}
            fileName={activeDocument.name}
            groupId={runtimeMembershipGroupId}
            onNavigate={navigateToBreadcrumbSymbol}
            ownerKey={editorSessionOwnerKey}
            store={cursorStore}
            symbols={breadcrumbSymbols}
            trackingActive={cursorTrackingActive}
          />
        ) : (
          <Breadcrumbs
            fileName={activeDocument.name}
            onNavigate={navigateToBreadcrumbSymbol}
            path={cursorStore === undefined ? breadcrumbPath : EMPTY_BREADCRUMB_PATH}
            symbols={breadcrumbSymbols}
          />
        )
      ) : null}
      {activeDocument && activeDocumentIsLargeSmart ? (
        <div
          aria-live="polite"
          className="breadcrumbs editor-large-file-notice"
          data-testid="editor-large-file-notice"
          role="status"
          title={largeDocumentNotice}
        >
          {largeDocumentNotice}
        </div>
      ) : null}
      <Suspense fallback={EDITOR_LOADING_PLACEHOLDER}>
        <LazyMonacoEditor
          beforeMount={handleBeforeMount}
          height="100%"
          keepCurrentModel
          language={activeDocument?.language ?? PLACEHOLDER_LANGUAGE}
          loading={EDITOR_LOADING_PLACEHOLDER}
          onMount={handleMount}
          options={editorOptions}
          path={editorSurfaceModelPath(workspaceRoot, activeDocument, PLACEHOLDER_PATH)}
          theme={beforeMountTheme}
          value={editorSurfaceControlledValue(
            runtime,
            groupId,
            activeDocument && monaco
              ? modelForPath(monaco, workspaceRoot, activeDocument.path)
              : null,
            activeDocument,
            activeDocumentContentReady,
            isOpeningFile,
          )}
        />
      </Suspense>
      {overlay}
      <EditorBreakpointGutterMenu
        actions={breakpointActions}
        activeDocumentPath={activeDocumentPath}
        breakpoints={breakpoints}
        editor={editor}
        modelIdentity={modelIdentity}
        monaco={monaco}
        onMutationError={onMutationError}
        toggleBreakpointFallback={toggleBreakpointFallback}
        workspaceRoot={workspaceRoot}
      />
      {activeDocument && changePreview ? (
        <div
          aria-label="Local change preview"
          className={`editor-change-popover editor-change-popover-${changePreview.hunk.kind}`}
          role="dialog"
          style={changePreviewStyle}
        >
          <div className="editor-change-popover-header">
            <span className={`editor-change-popover-kind ${changePreview.hunk.kind}`}>
              {editorChangeKindLabel(changePreview.hunk.kind)}
            </span>
            <div aria-label="Change navigation" className="editor-change-popover-nav">
              <button
                aria-label="Go to previous change"
                className="editor-change-popover-icon-button editor-change-popover-action-previous"
                onClick={() => onPopoverGoToChange("previous")}
                title="Previous change"
                type="button"
              >
                <ChevronUp aria-hidden="true" size={14} />
              </button>
              <button
                aria-label="Go to next change"
                className="editor-change-popover-icon-button editor-change-popover-action-next"
                onClick={() => onPopoverGoToChange("next")}
                title="Next change"
                type="button"
              >
                <ChevronDown aria-hidden="true" size={14} />
              </button>
              <button
                aria-label="Close local change preview"
                className="editor-change-popover-icon-button"
                onClick={() => setChangePreview(null)}
                title="Close"
                type="button"
              >
                <X aria-hidden="true" size={14} />
              </button>
            </div>
          </div>
          {changePreview.hunk.originalLines.length > 0 ? (
            <>
              <div className="editor-change-popover-section-label">Previous content</div>
              <pre className="editor-change-popover-code editor-change-popover-code-removed">
                {changePreviewText(changePreview.hunk)}
              </pre>
            </>
          ) : null}
          {changePreview.hunk.currentLines.length > 0 ? (
            <>
              <div className="editor-change-popover-section-label">Current content</div>
              <pre className="editor-change-popover-code editor-change-popover-code-added">
                {changePreview.hunk.currentLines.join("\n")}
              </pre>
            </>
          ) : null}
          <div className="editor-change-popover-actions">
            <button
              className="editor-change-popover-action editor-change-popover-action-revert"
              onClick={() => {
                onRevertChangeHunk(changePreview.hunk);
                setChangePreview(null);
              }}
              type="button"
            >
              <RotateCcw aria-hidden="true" size={13} />
              Revert change
            </button>
          </div>
        </div>
      ) : null}
      <SurroundWithPicker
        isOpen={surroundWithRequest !== null}
        onClose={() => {
          setSurroundWithRequest(null);
          editor?.focus();
        }}
        onSelect={(templateId) => {
          if (surroundWithRequest && editor && monaco) {
            applySurroundWith(monaco, editor, surroundWithRequest, templateId);
          }

          setSurroundWithRequest(null);
        }}
      />
    </div>
  );
}
