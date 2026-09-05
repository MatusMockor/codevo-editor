import { Ellipsis, TriangleAlert } from "lucide-react";
import { useRef, useState } from "react";
import { SettingsButton } from "../primitives/SettingsButton";
import { SettingsKbd } from "../primitives/SettingsKbd";
import { SettingsPopover } from "../primitives/SettingsPopover";
import type { KeybindingViewModel } from "./keybindingsPresentation";
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
    <tr className="settings-kb__row" data-command={binding.commandId}>
      <td className="settings-kb__cmd">
        <span className="settings-kb__label">{binding.label}</span>
        <span className="settings-kb__id">{binding.commandId}</span>
      </td>
      <td className="settings-kb__key">
        {recording === null ? (
          <button
            aria-label={`Edit shortcut for ${identity}`}
            className="settings-kb__edit"
            disabled={!binding.rebindable}
            onClick={() => recorder.start(binding.commandId)}
            type="button"
          >
            <KeybindingChips binding={binding} />
            <span className="settings-kb__editlabel">Edit</span>
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
      </td>
      <td className="settings-kb__when" data-always={binding.rebindable ? "true" : undefined}>
        {binding.rebindable ? "Always" : "Reserved"}
      </td>
      <td className="settings-kb__st">
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
        {binding.modified ? (
          <span className="settings-kb__modified" title="Modified from the default">
            Modified
          </span>
        ) : null}
        {binding.rebindable ? (
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
        ) : null}
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
      </td>
    </tr>
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
