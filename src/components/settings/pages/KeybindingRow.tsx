import { Ellipsis, TriangleAlert } from "lucide-react";
import { useRef, useState } from "react";
import { SettingsButton } from "../primitives/SettingsButton";
import { SettingsKbd } from "../primitives/SettingsKbd";
import { SettingsPopover } from "../primitives/SettingsPopover";
import { keybindingWhenLabel, type KeybindingViewModel } from "./keybindingsPresentation";
import type { KeybindingRecorder } from "./useKeybindingRecorder";

export interface KeybindingRowProps {
  readonly binding: KeybindingViewModel;
  readonly recorder: KeybindingRecorder;
  onReset(): void;
  onUnbind(): void;
}

export function KeybindingRow({ binding, onReset, onUnbind, recorder }: KeybindingRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuAnchorRef = useRef<HTMLButtonElement | null>(null);
  const recording = recorder.recordingFor(binding.commandId);
  const identity = `${binding.label} (${binding.commandId})`;

  return (
    <div
      className="settings-kb__row"
      data-command={binding.commandId}
      data-editing={recording === null ? undefined : "true"}
    >
      <div className="settings-kb__text">
        <h4 className="settings-kb__label">
          {binding.label}
          {binding.modified ? <span className="settings-badge">Modified</span> : null}
        </h4>
        <p className="settings-kb__when">
          <span className="settings-kb__when-label">When</span>
          <span className="settings-kb__when-value">{keybindingWhenLabel(binding)}</span>
        </p>
      </div>
      <div className="settings-kb__controls">
        {binding.conflictTitle === null ? null : (
          <span
            aria-label={`Shortcut conflict for ${identity}`}
            className="settings-kb__warn"
            role="img"
            title={binding.conflictTitle}
          >
            <TriangleAlert aria-hidden="true" size={14} />
          </span>
        )}
        {binding.rebindable && recording === null ? (
          <>
            <SettingsButton
              expanded={menuOpen}
              label={`More actions for ${identity}`}
              onClick={() => setMenuOpen((open) => !open)}
              ref={menuAnchorRef}
              size="xsq"
              variant="ghostMuted"
            >
              <Ellipsis aria-hidden="true" size={14} />
            </SettingsButton>
            <SettingsPopover
              anchorRef={menuAnchorRef}
              label={`Actions for ${identity}`}
              onClose={(restoreFocus) => {
                setMenuOpen(false);

                if (restoreFocus) menuAnchorRef.current?.focus();
              }}
              open={menuOpen}
            >
              <SettingsButton
                disabled={!binding.modified}
                label={`Reset ${identity} to default`}
                onClick={() => {
                  setMenuOpen(false);
                  onReset();
                }}
                size="sm"
                variant="ghost"
              >
                Reset to default
              </SettingsButton>
              <SettingsButton
                disabled={binding.currentShortcut === ""}
                label={`Unbind ${identity}`}
                onClick={() => {
                  setMenuOpen(false);
                  onUnbind();
                }}
                size="sm"
                variant="ghost"
              >
                Unbind
              </SettingsButton>
            </SettingsPopover>
          </>
        ) : null}
        {recording === null ? (
          <button
            aria-label={`Edit shortcut for ${identity}`}
            className="settings-kb__edit"
            disabled={!binding.rebindable}
            onClick={() => recorder.start(binding.commandId)}
            type="button"
          >
            <KeybindingChips binding={binding} />
          </button>
        ) : (
          <span className="settings-kb__recorder">
            <input
              aria-label={`Recording shortcut for ${identity}`}
              autoFocus
              className="settings-input settings-input--rec"
              data-mono="true"
              onKeyDown={(event) => recorder.capture(event)}
              placeholder="Press shortcut"
              readOnly
              value={recording.value}
            />
            <SettingsButton
              disabled={recording.value === ""}
              onClick={() => recorder.save()}
              size="compact"
              variant="primary"
            >
              Save
            </SettingsButton>
            <SettingsButton onClick={() => recorder.cancel()} size="compact" variant="ghostMuted">
              Cancel
            </SettingsButton>
          </span>
        )}
      </div>
    </div>
  );
}

function KeybindingChips({ binding }: { readonly binding: KeybindingViewModel }) {
  if (binding.strokes.length === 0) {
    return <span className="settings-kb__unbound">Unbound</span>;
  }

  return (
    <span className="settings-chips">
      {binding.strokes.map((stroke, strokeIndex) => (
        <span className="settings-chips__stroke" key={`${binding.commandId}-${strokeIndex}`}>
          {strokeIndex === 0 ? null : <span className="settings-chips__then">then</span>}
          {stroke.chips.map((chip, chipIndex) => (
            <SettingsKbd key={`${chip}-${chipIndex}`}>{chip}</SettingsKbd>
          ))}
        </span>
      ))}
    </span>
  );
}
