import { useEffect, useId, useRef } from "react";
import type { AppUpdaterSurface } from "../application/useAppUpdater";
import "./AppUpdateDialog.css";

export function AppUpdateDialog({ updater }: { readonly updater: AppUpdaterSurface }) {
  const state = updater.state;
  const titleId = useId();
  const dialogRef = useRef<HTMLElement | null>(null);
  const release =
    state.kind === "failed"
      ? state.release
      : state.kind === "available" ||
          state.kind === "downloading" ||
          state.kind === "readyToInstall" ||
          state.kind === "installing"
        ? state
        : null;
  const visible = release !== null;

  useEffect(() => {
    if (!visible) return;
    dialogRef.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
  }, [visible, state.kind]);

  if (!visible || release === null) return null;

  const pending = state.kind === "downloading" || state.kind === "installing";
  return (
    <div
      className="app-update-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) updater.dismiss();
      }}
      role="presentation"
    >
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="app-update-dialog"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !pending) updater.dismiss();
        }}
        ref={dialogRef}
        role="dialog"
      >
        <header>
          <div>
            <span>Application update</span>
            <h2 id={titleId}>Codevo {release.version} is available</h2>
          </div>
          <button aria-label="Later" disabled={pending} onClick={updater.dismiss} type="button">
            ×
          </button>
        </header>
        {release.notes ? <p className="app-update-notes">{release.notes}</p> : null}
        {release.date ? <p className="app-update-date">Released {release.date}</p> : null}
        {state.kind === "failed" ? (
          <p aria-live="polite" className="app-update-error" role="alert">
            {state.message}
          </p>
        ) : null}
        {pending ? (
          <div aria-live="polite" className="app-update-progress" role="status">
            <span />
            {state.kind === "downloading" ? "Downloading update…" : "Installing update…"}
          </div>
        ) : null}
        {state.kind === "readyToInstall" ? (
          <p className="app-update-restart">The update is downloaded and ready to install.</p>
        ) : null}
        <footer>
          {state.kind === "available" ? (
            <button
              className="app-update-skip"
              onClick={() => void updater.skipVersion()}
              type="button"
            >
              Skip this version
            </button>
          ) : null}
          {!pending ? (
            <button onClick={updater.dismiss} type="button">
              Later
            </button>
          ) : null}
          {state.kind === "available" ? (
            <button
              className="app-update-primary"
              onClick={() => void updater.download()}
              type="button"
            >
              Download and install
            </button>
          ) : null}
          {state.kind === "readyToInstall" ? (
            <button
              className="app-update-primary"
              onClick={() => void updater.installAndRestart()}
              type="button"
            >
              Restart and install
            </button>
          ) : null}
          {state.kind === "failed" ? (
            <button
              className="app-update-primary"
              onClick={() => void updater.check()}
              type="button"
            >
              Retry update
            </button>
          ) : null}
        </footer>
      </section>
    </div>
  );
}
