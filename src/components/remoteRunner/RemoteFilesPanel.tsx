import { Suspense, lazy } from "react";
import { File, Folder, RefreshCw, ArrowUp } from "lucide-react";
import type { RemoteSurfaceScope } from "../../domain/remoteRunnerSurfaces";
import type { MonacoAppTheme } from "../../domain/settings";
import { initializeMonacoRuntime } from "../monacoRuntimeLoader";
import { useRemoteFiles, type RemoteFilesGateway } from "./useRemoteFiles";
import "./remoteSurfacePanels.css";

const RemoteEditor = lazy(async () => {
  await initializeMonacoRuntime();
  return import("@monaco-editor/react");
});
const RemoteComparison = lazy(async () => {
  await initializeMonacoRuntime();
  return import("./RemoteFileComparison");
});
export interface RemoteFilesPanelProps {
  readonly scope: RemoteSurfaceScope;
  readonly gateway: RemoteFilesGateway;
  readonly monacoTheme?: MonacoAppTheme;
}
export function RemoteFilesPanel(props: RemoteFilesPanelProps) {
  return <RemoteFilesContent key={JSON.stringify(props.scope)} {...props} />;
}
function RemoteFilesContent({ scope, gateway, monacoTheme = "calm-dark" }: RemoteFilesPanelProps) {
  const state = useRemoteFiles(scope, gateway);
  const parent = state.path.split("/").slice(0, -1).join("/");
  return (
    <section className="remote-surface-panel" aria-label="Server files">
      <header className="remote-surface-toolbar">
        <strong>{state.path || "Files"}</strong>
        <button
          type="button"
          aria-label="Parent directory"
          disabled={!state.path || state.busy || state.dirty}
          onClick={() => void state.browse(parent)}
        >
          <ArrowUp size={14} />
        </button>
        <button
          type="button"
          aria-label="Refresh server files"
          disabled={state.busy || state.dirty}
          onClick={() => void state.browse(state.path, state.offset)}
        >
          <RefreshCw size={14} />
        </button>
      </header>
      {state.error && (
        <p role="alert" className="remote-surface-error">
          {state.error}
        </p>
      )}
      {state.dirty && (
        <p className="remote-surface-notice">
          Unsaved changes are kept while switching threads. Save or discard them before opening
          another file.
        </p>
      )}
      <nav className="remote-surface-list" aria-label="Server directory">
        {state.directory?.entries.map((entry) => (
          <button
            key={entry.path}
            type="button"
            className="remote-surface-row"
            disabled={state.busy || state.dirty || entry.kind === "symlink"}
            aria-current={state.file?.path === entry.path ? "true" : undefined}
            title={entry.kind === "symlink" ? "Symbolic links cannot be opened here." : entry.path}
            onClick={() =>
              void (entry.kind === "directory" ? state.browse(entry.path) : state.open(entry.path))
            }
          >
            {entry.kind === "directory" ? <Folder size={14} /> : <File size={14} />} {entry.name}
          </button>
        ))}
      </nav>
      {state.directory?.entries.length === 0 && (
        <p className="remote-surface-note">This directory is empty.</p>
      )}
      {state.directory?.truncated && (
        <p className="remote-surface-notice">Showing part of this directory.</p>
      )}
      {(state.offset > 0 || state.directory?.nextOffset != null) && (
        <div className="remote-surface-toolbar">
          {state.offset > 0 && (
            <button
              type="button"
              disabled={state.busy || state.dirty}
              onClick={() => void state.browse(state.path)}
            >
              First page
            </button>
          )}
          {state.directory?.nextOffset != null && (
            <button
              type="button"
              disabled={state.busy || state.dirty}
              onClick={() => void state.browse(state.path, state.directory!.nextOffset!)}
            >
              Next files
            </button>
          )}
        </div>
      )}
      {state.busy && (
        <p role="status" className="remote-surface-note">
          Working…
        </p>
      )}
      {state.file && (
        <>
          <header className="remote-surface-toolbar">
            <strong>
              {state.file.path}
              {state.dirty ? " •" : ""}
            </strong>
            <button
              type="button"
              disabled={!state.dirty || state.busy}
              onClick={() => void state.save()}
            >
              Save
            </button>
            <button type="button" disabled={!state.dirty || state.busy} onClick={state.discard}>
              Discard changes
            </button>
            {state.dirty && (
              <button type="button" disabled={state.busy} onClick={() => void state.compare()}>
                Compare with server
              </button>
            )}
          </header>
          {state.comparison && (
            <>
              <p className="remote-surface-notice">
                Server version on the left; your unsaved edits on the right. Keeping your version
                prepares it to replace the server version when you save.
              </p>
              <div className="remote-surface-toolbar">
                <button type="button" onClick={() => state.resolveComparison(false)}>
                  Use server version
                </button>
                <button type="button" onClick={() => state.resolveComparison(true)}>
                  Keep my version
                </button>
              </div>
              <div className="remote-surface-editor">
                <Suspense fallback={<p>Opening comparison…</p>}>
                  <RemoteComparison
                    height="100%"
                    theme={monacoTheme}
                    original={state.comparison.text}
                    modified={state.text}
                    options={{
                      readOnly: true,
                      originalEditable: false,
                      automaticLayout: true,
                      minimap: { enabled: false },
                    }}
                  />
                </Suspense>
              </div>
            </>
          )}
          {state.file.unavailableReason !== null ? (
            <p className="remote-surface-notice">
              {state.file.unavailableReason === "binary"
                ? "This is a binary file and cannot be edited as text."
                : "This file is too large to open safely in this panel."}
            </p>
          ) : (
            <div className="remote-surface-editor">
              <Suspense fallback={<p className="remote-surface-note">Opening editor…</p>}>
                <RemoteEditor
                  height="100%"
                  theme={monacoTheme}
                  path={`remote-file:///${encodeURIComponent(JSON.stringify(scope))}/${encodeURIComponent(state.file.path)}`}
                  value={state.text}
                  onChange={(value) => state.edit(value ?? "")}
                  options={{
                    readOnly: state.file.version === null || !state.canEdit,
                    automaticLayout: true,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    wordWrap: "on",
                  }}
                />
              </Suspense>
            </div>
          )}
        </>
      )}
    </section>
  );
}
