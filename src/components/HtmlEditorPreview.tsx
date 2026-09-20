import { useEffect, useState, type ReactNode } from "react";
import type {
  HtmlFilePreviewHandle,
  HtmlFilePreviewPort,
} from "../application/htmlFilePreviewPort";
import "./htmlEditorPreview.css";

type PreviewState =
  | { readonly kind: "loading" }
  | {
      readonly kind: "ready";
      readonly handle: HtmlFilePreviewHandle;
      readonly path: string;
      readonly preview: HtmlFilePreviewPort;
      readonly loaded: () => void;
      readonly failed: () => void;
    }
  | { readonly kind: "failed" };

export function HtmlEditorPreview({
  children,
  name,
  path,
  preview,
}: {
  readonly children: ReactNode;
  readonly name: string;
  readonly path: string;
  readonly preview: HtmlFilePreviewPort;
}) {
  const [mode, setMode] = useState<"source" | "preview">("source");
  const [revision, setRevision] = useState(0);
  return (
    <div className="html-editor-preview">
      <div aria-label="HTML view" className="html-editor-preview__toolbar" role="group">
        <button aria-pressed={mode === "source"} onClick={() => setMode("source")} type="button">
          Source
        </button>
        <button aria-pressed={mode === "preview"} onClick={() => setMode("preview")} type="button">
          Preview
        </button>
        {mode === "preview" && (
          <button onClick={() => setRevision((value) => value + 1)} type="button">
            Refresh preview
          </button>
        )}
      </div>
      <div className="html-editor-preview__source" hidden={mode !== "source"}>
        {children}
      </div>
      {mode === "preview" && (
        <>
          <p className="html-editor-preview__hint">
            Current file preview. Linked pages and external resources are unavailable.
          </p>
          <HtmlPreviewFrame key={revision} name={name} path={path} preview={preview} />
        </>
      )}
    </div>
  );
}

function HtmlPreviewFrame({
  name,
  path,
  preview,
}: {
  readonly name: string;
  readonly path: string;
  readonly preview: HtmlFilePreviewPort;
}) {
  const [state, setState] = useState<PreviewState>({ kind: "loading" });
  useEffect(() => {
    let active = true;
    let handle: HtmlFilePreviewHandle | null = null;
    const dispose = (value: HtmlFilePreviewHandle) => {
      void value.dispose().catch(() => undefined);
    };
    setState({ kind: "loading" });
    const timeout = setTimeout(() => {
      active = false;
      setState({ kind: "failed" });
    }, 20_000);
    let expiry: ReturnType<typeof setTimeout> | undefined;
    let frameTimeout: ReturnType<typeof setTimeout> | undefined;
    void preview
      .prepare(path)
      .then((result) => {
        if (!active) {
          dispose(result);
          return;
        }
        clearTimeout(timeout);
        handle = result;
        const failFrame = () => {
          if (!active) return;
          clearTimeout(frameTimeout);
          clearTimeout(expiry);
          if (handle) {
            dispose(handle);
            handle = null;
          }
          setState({ kind: "failed" });
        };
        frameTimeout = setTimeout(failFrame, 20_000);
        setState({
          kind: "ready",
          handle: result,
          path,
          preview,
          loaded: () => clearTimeout(frameTimeout),
          failed: failFrame,
        });
        expiry = setTimeout(() => {
          dispose(result);
          handle = null;
          setState({ kind: "failed" });
        }, 25 * 60_000);
      })
      .catch(() => {
        clearTimeout(timeout);
        if (active) setState({ kind: "failed" });
      });
    return () => {
      active = false;
      clearTimeout(timeout);
      clearTimeout(expiry);
      clearTimeout(frameTimeout);
      if (handle) dispose(handle);
    };
  }, [path, preview]);
  if (
    state.kind === "loading" ||
    (state.kind === "ready" && (state.path !== path || state.preview !== preview))
  )
    return <p role="status">Loading HTML preview…</p>;
  if (state.kind === "failed")
    return (
      <p role="status">
        Could not prepare this HTML preview. Return to Source or refresh to try again.
      </p>
    );
  return (
    <iframe
      className="html-editor-preview__frame"
      onLoad={state.loaded}
      onErrorCapture={state.failed}
      referrerPolicy="no-referrer"
      sandbox="allow-scripts"
      src={state.handle.url}
      title={`Preview of ${name}`}
    />
  );
}
