import type { AppUpdaterSurface } from "../../../application/useAppUpdater";
import {
  appUpdateNotesSpanSummary,
  singleAppUpdateNotesSpan,
  type AppUpdateNotesSpan,
} from "../../../domain/appUpdateNotes";
import type { AppUpdaterState } from "../../../domain/appUpdater";
import { SettingsButton } from "../primitives/SettingsButton";
import { SettingsRow } from "../primitives/SettingsRow";
import { SettingsSectionHeading } from "../primitives/SettingsSectionHeading";

export interface GeneralAppUpdateRowsProps {
  readonly updater: AppUpdaterSurface | null;
}

export function GeneralAppUpdateRows({ updater }: GeneralAppUpdateRowsProps) {
  return (
    <SettingsSectionHeading title="Updates">
      {updater === null ? (
        <SettingsRow description="Updates unavailable in this build." rowId="general.appUpdates">
          {null}
        </SettingsRow>
      ) : (
        <AppUpdateRow updater={updater} />
      )}
    </SettingsSectionHeading>
  );
}

function AppUpdateRow({ updater }: { readonly updater: AppUpdaterSurface }) {
  const presentation = appUpdaterPresentation(updater.state);

  return (
    <>
      <SettingsRow
        description={
          <span
            aria-live="polite"
            className={`settings-update__status settings-update__status--${presentation.statusTone}`}
          >
            {appUpdateDescription(presentation)}
          </span>
        }
        meta={<code className="settings-row__meta">{updater.state.currentVersion}</code>}
        rowId="general.appUpdates"
      >
        {presentation.skippable ? (
          <SettingsButton onClick={() => void updater.skipVersion()} variant="ghostMuted">
            Skip this version
          </SettingsButton>
        ) : null}
        <AppUpdateAction presentation={presentation} updater={updater} />
      </SettingsRow>
      <AppUpdateNotes span={presentation.notesSpan} />
    </>
  );
}

function appUpdateDescription(presentation: AppUpdaterPresentation): string {
  if (presentation.status !== null) return presentation.status;
  if (presentation.version === null) return "Check for a new Codevo release.";
  return `Codevo ${presentation.version} is available.`;
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
        Update
      </SettingsButton>
    );
  }

  if (presentation.action === "installAndRestart") {
    return (
      <SettingsButton onClick={() => void updater.installAndRestart()} variant="primary">
        {updater.state.kind === "readyToInstall" ? "Install and restart" : "Restart"}
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
  readonly notesSpan: AppUpdateNotesSpan;
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
      return presentation(
        { action: "check" },
        null,
        singleAppUpdateNotesSpan(null),
        "Codevo is up to date.",
        "success",
      );
    case "available":
      return presentation({ action: "download" }, state.version, state.notesSpan);
    case "downloading":
      return presentation(
        { action: "pending", pendingLabel: "Preparing update…" },
        state.version,
        state.notesSpan,
      );
    case "readyToInstall":
      return presentation({ action: "installAndRestart" }, state.version, state.notesSpan);
    case "readyToRestart":
      return presentation(
        { action: "installAndRestart" },
        state.version,
        state.notesSpan,
        "Update installed. Restart now or use it next time you open Codevo.",
        "success",
      );
    case "readyToRestartOutdated":
      return presentation(
        { action: "installAndRestart" },
        state.version,
        state.notesSpan,
        `Update installed. Codevo v${state.supersededBy.version} is already available and is offered after this restart.`,
        "neutral",
      );
    case "installing":
      return presentation(
        { action: "pending", pendingLabel: "Installing…" },
        state.version,
        state.notesSpan,
      );
    case "failed":
      return presentation(
        { action: "check" },
        null,
        singleAppUpdateNotesSpan(null),
        state.message,
        "danger",
      );
  }
}

function presentation(
  action: AppUpdaterActionPresentation,
  version: string | null = null,
  notesSpan: AppUpdateNotesSpan = singleAppUpdateNotesSpan(null),
  status: string | null = null,
  statusTone: AppUpdaterPresentation["statusTone"] = "neutral",
): AppUpdaterPresentation {
  return {
    ...action,
    version,
    notesSpan,
    status,
    statusTone,
    skippable: version !== null && action.action === "download",
  };
}

function AppUpdateNotes({ span }: { readonly span: AppUpdateNotesSpan }) {
  if (span.kind === "single") {
    if (span.notes === null) return null;
    return <p className="settings-update__notes">{span.notes}</p>;
  }
  const summary = appUpdateNotesSpanSummary(span);
  return (
    <div className="settings-update__notes-span">
      {summary === null ? null : <p className="settings-update__notes-summary">{summary}</p>}
      {span.entries.map((entry) => (
        <section className="settings-update__release" key={entry.version}>
          <h4 className="settings-update__release-version">{`v${entry.version}`}</h4>
          <p className="settings-update__notes">{entry.notes}</p>
        </section>
      ))}
    </div>
  );
}
