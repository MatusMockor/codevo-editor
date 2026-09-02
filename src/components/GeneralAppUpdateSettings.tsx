import type { AppUpdaterSurface } from "../application/useAppUpdater";
import type { AppUpdaterState } from "../domain/appUpdater";

export interface GeneralAppUpdateSettingsProps {
  readonly updater: AppUpdaterSurface;
}

export function GeneralAppUpdateSettings({ updater }: GeneralAppUpdateSettingsProps) {
  const presentation = appUpdaterPresentation(updater.state);
  return (
    <section aria-label="Application updates" className="settings-subsection">
      <h3>Application updates</h3>
      <div className="settings-field">
        <span>Current version</span>
        <strong>{updater.state.currentVersion}</strong>
      </div>
      {presentation.version ? (
        <div className="settings-field">
          <span>Available version</span>
          <strong>{presentation.version}</strong>
        </div>
      ) : null}
      {presentation.notes ? (
        <p className="settings-subsection__notes">{presentation.notes}</p>
      ) : null}
      {presentation.status ? (
        <p
          aria-live="polite"
          className={`settings-subsection__status settings-subsection__status--${presentation.statusTone}`}
        >
          {presentation.status}
        </p>
      ) : null}
      <div className="settings-actions">
        {presentation.action === "check" ? (
          <button onClick={() => void updater.check()} type="button">
            Check for updates
          </button>
        ) : null}
        {presentation.action === "download" ? (
          <button onClick={() => void updater.download()} type="button">
            Download update
          </button>
        ) : null}
        {presentation.action === "installAndRestart" ? (
          <button onClick={() => void updater.installAndRestart()} type="button">
            Install and restart
          </button>
        ) : null}
        {presentation.action === "pending" ? (
          <button aria-busy="true" disabled type="button">
            {presentation.pendingLabel}
          </button>
        ) : null}
      </div>
    </section>
  );
}

type AppUpdaterActionPresentation =
  | { readonly action: "check" }
  | { readonly action: "download" }
  | { readonly action: "installAndRestart" }
  | { readonly action: "pending"; readonly pendingLabel: string };

type AppUpdaterPresentation = AppUpdaterActionPresentation & {
  readonly version: string | null;
  readonly notes: string | null;
  readonly status: string | null;
  readonly statusTone: "neutral" | "success" | "danger";
};

function appUpdaterPresentation(state: AppUpdaterState): AppUpdaterPresentation {
  switch (state.kind) {
    case "idle":
      return presentation({ action: "check" });
    case "checking":
      return presentation({ action: "pending", pendingLabel: "Checking…" });
    case "upToDate":
      return presentation({ action: "check" }, null, null, "Codevo is up to date.", "success");
    case "available":
      return presentation({ action: "download" }, state.version, state.notes);
    case "downloading":
      return presentation(
        { action: "pending", pendingLabel: "Downloading…" },
        state.version,
        state.notes,
      );
    case "readyToInstall":
      return presentation({ action: "installAndRestart" }, state.version, state.notes);
    case "installing":
      return presentation(
        { action: "pending", pendingLabel: "Installing…" },
        state.version,
        state.notes,
      );
    case "failed":
      return presentation({ action: "check" }, null, null, state.message, "danger");
  }
}

function presentation(
  action: AppUpdaterActionPresentation,
  version: string | null = null,
  notes: string | null = null,
  status: string | null = null,
  statusTone: AppUpdaterPresentation["statusTone"] = "neutral",
): AppUpdaterPresentation {
  return { ...action, version, notes, status, statusTone };
}
