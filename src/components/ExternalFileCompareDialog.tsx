import { DiffEditor } from "@monaco-editor/react";
import { X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";
import type * as Monaco from "monaco-editor";
import {
  externalFileConflictLabels,
  type ExternalFileConflict,
} from "../domain/externalFileConflict";
import {
  defaultEditorFontFamily,
  defaultEditorFontLigatures,
  defaultEditorFontSize,
  monacoFontLigaturesForEditorSetting,
  type MonacoAppTheme,
} from "../domain/settings";
import {
  applyImmediateFallbackTheme,
  setupShikiTokenization,
} from "../infrastructure/shikiHighlighter";
import "./ExternalFileConflict.css";

interface ExternalFileCompareDialogProps {
  conflict: ExternalFileConflict;
  editorFontFamily?: string;
  editorFontLigatures?: boolean;
  editorFontSize?: number;
  isOpen: boolean;
  language: string;
  liveLocalContent: string;
  monacoTheme: MonacoAppTheme;
  onClose(): void;
  renderSideBySide?: boolean;
}

const COMPACT_DIFF_MEDIA_QUERY = "(max-width: 680px)";
const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function ExternalFileCompareDialog({
  conflict,
  editorFontFamily = defaultEditorFontFamily,
  editorFontLigatures = defaultEditorFontLigatures,
  editorFontSize = defaultEditorFontSize,
  isOpen,
  language,
  liveLocalContent,
  monacoTheme,
  onClose,
  renderSideBySide,
}: ExternalFileCompareDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const diffEditorRef = useRef<Monaco.editor.IStandaloneDiffEditor | null>(
    null,
  );
  const editorDisposeListenerRef = useRef<Monaco.IDisposable | null>(null);
  const invokingElementRef = useRef<HTMLElement | null>(null);
  const monacoRef = useRef<Parameters<typeof setupShikiTokenization>[0] | null>(
    null,
  );
  const themeRequestRef = useRef(0);
  const requestedThemeRef = useRef<MonacoAppTheme | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const compactViewport = useMediaQuery(COMPACT_DIFF_MEDIA_QUERY);
  const effectiveRenderSideBySide =
    renderSideBySide ?? !compactViewport;
  const fontLigatures = monacoFontLigaturesForEditorSetting(
    editorFontLigatures,
  );

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
    if (!isOpen) {
      return;
    }

    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    invokingElementRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    if (typeof dialog.showModal === "function") {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else {
      dialog.setAttribute("open", "");
    }

    focusableElements(dialog)[0]?.focus();

    return () => {
      if (dialog.open && typeof dialog.close === "function") {
        dialog.close();
      } else {
        dialog.removeAttribute("open");
      }

      invokingElementRef.current?.focus();
      invokingElementRef.current = null;
    };
  }, [isOpen]);

  useLayoutEffect(() => {
    if (isOpen) {
      return;
    }

    themeRequestRef.current += 1;
    monacoRef.current = null;
    requestedThemeRef.current = null;
    editorDisposeListenerRef.current?.dispose();
    editorDisposeListenerRef.current = null;
    diffEditorRef.current = null;
  }, [isOpen]);

  useEffect(() => {
    const editor = diffEditorRef.current;
    if (!editor) {
      return;
    }

    editor.updateOptions({
      fontFamily: editorFontFamily,
      fontLigatures,
      fontSize: editorFontSize,
      renderSideBySide: effectiveRenderSideBySide,
    });
  }, [editorFontFamily, editorFontSize, effectiveRenderSideBySide, fontLigatures]);

  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco || requestedThemeRef.current === monacoTheme) {
      return;
    }

    requestThemeSetup(monaco, monacoTheme);
  }, [monacoTheme, requestThemeSetup]);

  useEffect(
    () => () => {
      themeRequestRef.current += 1;
      monacoRef.current = null;
      requestedThemeRef.current = null;
      editorDisposeListenerRef.current?.dispose();
      editorDisposeListenerRef.current = null;
      diffEditorRef.current = null;
    },
    [],
  );

  if (!isOpen) {
    return null;
  }

  const labels = externalFileConflictLabels(conflict);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDialogElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    trapDialogFocus(event);
  };

  const handleBackdropMouseDown = (
    event: ReactMouseEvent<HTMLDialogElement>,
  ) => {
    if (event.target !== event.currentTarget) {
      return;
    }

    onClose();
  };

  return (
    <dialog
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      aria-modal="true"
      className="external-file-compare-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={handleKeyDown}
      onMouseDown={handleBackdropMouseDown}
      ref={dialogRef}
      role="dialog"
    >
      <section className="external-file-compare-surface">
        <header className="external-file-compare-header">
          <div>
            <h2 id={titleId}>Compare external file</h2>
            <p id={descriptionId}>{labels.title}</p>
          </div>
          <button
            aria-label="Close comparison"
            className="external-file-compare-close"
            onClick={onClose}
            title="Close comparison"
            type="button"
          >
            <X aria-hidden="true" size={16} />
          </button>
        </header>
        <div
          aria-label="Compared versions"
          className={`external-file-compare-labels${
            effectiveRenderSideBySide
              ? ""
              : " external-file-compare-labels-inline"
          }`}
          role="group"
        >
          {effectiveRenderSideBySide ? (
            <>
              <span>Local: {conflict.baseline.path}</span>
              <span>{labels.disk}</span>
            </>
          ) : (
            <span>
              Local: {conflict.baseline.path} compared with {labels.disk}
            </span>
          )}
        </div>
        <div className="external-file-compare-editor">
          <DiffEditor
            beforeMount={(monaco) => requestThemeSetup(monaco, monacoTheme)}
            height="100%"
            language={language}
            modified={conflict.disk?.content ?? ""}
            onMount={(editor) => {
              editorDisposeListenerRef.current?.dispose();
              diffEditorRef.current = editor;
              editor.updateOptions({
                fontFamily: editorFontFamily,
                fontLigatures,
                fontSize: editorFontSize,
                renderSideBySide: effectiveRenderSideBySide,
              });
              editorDisposeListenerRef.current = editor.onDidDispose(() => {
                if (diffEditorRef.current !== editor) {
                  return;
                }

                diffEditorRef.current = null;
                editorDisposeListenerRef.current = null;
              });
            }}
            options={{
              automaticLayout: true,
              fontFamily: editorFontFamily,
              fontLigatures,
              fontSize: editorFontSize,
              lineHeight: 20,
              minimap: { enabled: false },
              modifiedAriaLabel: "Disk file content",
              originalAriaLabel: "Live local editor content",
              originalEditable: false,
              readOnly: true,
              renderSideBySide: effectiveRenderSideBySide,
              scrollBeyondLastLine: false,
            }}
            original={liveLocalContent}
            theme={monacoTheme}
          />
        </div>
      </section>
    </dialog>
  );
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

function trapDialogFocus(event: ReactKeyboardEvent<HTMLDialogElement>): void {
  const elements = focusableElements(event.currentTarget);
  if (elements.length === 0) {
    event.preventDefault();
    event.currentTarget.focus();
    return;
  }

  const first = elements[0];
  const last = elements[elements.length - 1];
  const activeElement = document.activeElement;

  if (event.shiftKey && (activeElement === first || !event.currentTarget.contains(activeElement))) {
    event.preventDefault();
    last.focus();
    return;
  }

  if (!event.shiftKey && activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => mediaQueryMatches(query));

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    setMatches(mediaQuery.matches);
    mediaQuery.addEventListener("change", onChange);

    return () => mediaQuery.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

function mediaQueryMatches(query: string): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }

  return window.matchMedia(query).matches;
}
