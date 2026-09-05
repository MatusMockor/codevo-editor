import type { AppUpdaterSurface } from "../../../application/useAppUpdater";
import type { AppUpdaterState } from "../../../domain/appUpdater";
import { SettingsButton } from "../primitives/SettingsButton";
import { SettingsRow } from "../primitives/SettingsRow";
import { SettingsSectionHeading } from "../primitives/SettingsSectionHeading";

export interface GeneralAppUpdateRowsProps {
  readonly updater: AppUpdaterSurface | null;
}

export function GeneralAppUpdateRows({ updater }: GeneralAppUpdateRowsProps) {
  return (
    <SettingsSectionHeading title="Application updates">
      <SettingsRow layout="stacked" rowId="general.appUpdates">
        {updater === null ? (
          <span className="settings-readout">Updates unavailable</span>
        ) : (
          <AppUpdateControl updater={updater} />
        )}
      </SettingsRow>
    </SettingsSectionHeading>
  );
}

function AppUpdateControl({ updater }: { readonly updater: AppUpdaterSurface }) {
  const presentation = appUpdaterPresentation(updater.state);

  return (
    <div className="settings-update">
      <dl className="settings-update__versions">
        <div className="settings-update__version">
          <dt>Current version</dt>
          <dd className="settings-readout">{updater.state.currentVersion}</dd>
        </div>
        {presentation.version === null ? null : (
          <div className="settings-update__version">
            <dt>Available version</dt>
            <dd className="settings-readout">{presentation.version}</dd>
          </div>
        )}
      </dl>
      {presentation.notes === null ? null : (
        <p className="settings-update__notes">{presentation.notes}</p>
      )}
      {presentation.status === null ? null : (
        <p
          aria-live="polite"
          className={`settings-update__status settings-update__status--${presentation.statusTone}`}
        >
          {presentation.status}
        </p>
      )}
      <div className="settings-update__actions">
        <AppUpdateAction presentation={presentation} updater={updater} />
        {presentation.skippable ? (
          <SettingsButton onClick={() => void updater.skipVersion()} variant="ghostMuted">
            Skip this version
          </SettingsButton>
        ) : null}
      </div>
    </div>
  );
}

function AppUpdateAction({
  presentation,
  updater,
}: {
  readonly presentation: AppUpdaterPresentation;
  readonly updater: AppUpdaterSurface;
}) {
  if (presentation.action === "check") {
    return (
      <SettingsButton onClick={() => void updater.check()} variant="outline">
        Check for updates
      </SettingsButton>
    );
  }

  if (presentation.action === "download") {
    return (
      <SettingsButton onClick={() => void updater.download()} variant="primary">
        Download update
      </SettingsButton>
    );
  }

  if (presentation.action === "installAndRestart") {
    return (
      <SettingsButton onClick={() => void updater.installAndRestart()} variant="primary">
        Install and restart
      </SettingsButton>
    );
  }

  return (
    <SettingsButton busy disabled onClick={() => undefined} variant="outline">
      {presentation.pendingLabel}
    </SettingsButton>
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
  readonly skippable: boolean;
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
  return {
    ...action,
    version,
    notes,
    status,
    statusTone,
    skippable: version !== null && action.action !== "pending",
  };
}
