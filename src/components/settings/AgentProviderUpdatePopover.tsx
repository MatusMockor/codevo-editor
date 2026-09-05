import { ArrowUp, Copy, LoaderCircle } from "lucide-react";
import type { RefObject } from "react";
import { SettingsButton } from "./primitives/SettingsButton";
import { SettingsPopover } from "./primitives/SettingsPopover";
import {
  providerManualUpdateCommand,
  type AgentProviderAvailableUpdate,
} from "./agentProviderUpdatePresentation";

export interface AgentProviderUpdatePopoverProps {
  readonly anchorRef: RefObject<HTMLElement | null>;
  readonly available: AgentProviderAvailableUpdate;
  readonly blockedReason: string | null;
  readonly open: boolean;
  readonly providerLabel: string;
  readonly updating: boolean;
  onClose(restoreFocus: boolean): void;
  onCopyCommand(command: string): void;
  onDismiss(): void;
  onUpdate(): void;
}

export function AgentProviderUpdatePopover({
  anchorRef,
  available,
  blockedReason,
  onClose,
  onCopyCommand,
  onDismiss,
  onUpdate,
  open,
  providerLabel,
  updating,
}: AgentProviderUpdatePopoverProps) {
  const command = providerManualUpdateCommand(available.installer);

  return (
    <SettingsPopover anchorRef={anchorRef} label="Update available" onClose={onClose} open={open}>
      <p className="settings-popover__text">
        Update available: install v{available.availableVersion}.
      </p>
      <p className="settings-popover__hint">Installed v{available.installedVersion}.</p>
      <SettingsButton
        busy={updating}
        disabled={blockedReason !== null || updating}
        onClick={onUpdate}
        size="sm"
        title={blockedReason ?? undefined}
        variant="primary"
      >
        {updating ? (
          <LoaderCircle aria-hidden="true" className="settings-spin" size={13} />
        ) : (
          <ArrowUp aria-hidden="true" size={13} />
        )}
        {updating ? `Updating ${providerLabel}` : "Update now"}
      </SettingsButton>
      {blockedReason === null ? null : (
        <p className="settings-popover__hint" role="status">
          {blockedReason}
        </p>
      )}
      {command === null ? null : (
        <>
          <p className="settings-popover__or">or, update manually using</p>
          <div className="settings-popover__cmd">
            <code>{command}</code>
            <SettingsButton
              label={`Copy ${providerLabel} update command`}
              onClick={() => onCopyCommand(command)}
              size="xsq"
              variant="ghostMuted"
            >
              <Copy aria-hidden="true" size={12} />
            </SettingsButton>
          </div>
        </>
      )}
      <SettingsButton onClick={onDismiss} size="sm" variant="ghost">
        Skip this version
      </SettingsButton>
    </SettingsPopover>
  );
}
