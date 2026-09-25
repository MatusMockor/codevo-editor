import { useMemo, useState } from "react";
import { Button } from "../../../ui/foundation/Button";
import { useNowMs } from "../../../ui/foundation/useNowMs";
import { SettingsSectionHeading } from "../primitives/SettingsSectionHeading";
import type { SettingsPageProps } from "../settingsPageProps";
import { useSettingsRowTarget } from "../settingsTargetContext";
import {
  ARCHIVE_PAGE_SIZE,
  archivedThreadGroups,
  type ArchivedThreadGroup,
} from "./archivePresentation";

const NO_THREADS: ReadonlyArray<never> = [];

export function ArchiveSettingsPage({ env }: SettingsPageProps) {
  const activity = env.agentActivity ?? null;
  const anchorRef = useSettingsRowTarget("archive.threads");
  const nowEpochMs = useNowMs();
  const threads = activity?.threads ?? NO_THREADS;
  const groups = useMemo(() => archivedThreadGroups(threads, nowEpochMs), [nowEpochMs, threads]);

  return (
    <div
      className="settings-stack"
      data-settings-row="archive.threads"
      ref={anchorRef}
      tabIndex={-1}
    >
      {activity === null ? (
        <SettingsSectionHeading title="Archived threads">
          <p className="settings-empty">Archived threads appear after agent mode has loaded.</p>
        </SettingsSectionHeading>
      ) : null}
      {activity !== null && groups.length === 0 ? (
        <SettingsSectionHeading title="Archived threads">
          <p className="settings-empty">No archived threads.</p>
        </SettingsSectionHeading>
      ) : null}
      {activity === null
        ? null
        : groups.map((group) => (
            <ArchiveGroup
              group={group}
              key={group.projectKey}
              onOpen={activity.openThread}
              onUnarchive={activity.unarchive}
            />
          ))}
    </div>
  );
}

function ArchiveGroup({
  group,
  onOpen,
  onUnarchive,
}: {
  readonly group: ArchivedThreadGroup;
  readonly onOpen: ((threadId: string) => void) | undefined;
  onUnarchive(threadId: string): void;
}) {
  const [shown, setShown] = useState(ARCHIVE_PAGE_SIZE);
  const hidden = group.threads.length - shown;
  return (
    <SettingsSectionHeading title={group.projectLabel}>
      {group.threads.slice(0, shown).map((thread) => (
        <div className="settings-row" key={thread.threadId}>
          <div className="settings-row__text">
            <div className="settings-row__head">
              <h3 className="settings-row__title">{thread.title}</h3>
            </div>
            <p className="settings-row__description">{thread.createdLabel}</p>
          </div>
          <div className="settings-row__control">
            {onOpen === undefined ? null : (
              <Button
                aria-label={`Open ${thread.title}`}
                onClick={() => onOpen(thread.threadId)}
                size="sm"
                variant="ghost"
              >
                Open
              </Button>
            )}
            <Button
              aria-label={`Unarchive ${thread.title}`}
              onClick={() => onUnarchive(thread.threadId)}
              size="sm"
            >
              Unarchive
            </Button>
          </div>
        </div>
      ))}
      {hidden <= 0 ? null : (
        <Button
          onClick={() => setShown((count) => count + ARCHIVE_PAGE_SIZE)}
          size="sm"
          variant="ghost"
        >
          {`Show ${Math.min(hidden, ARCHIVE_PAGE_SIZE)} more`}
        </Button>
      )}
    </SettingsSectionHeading>
  );
}
