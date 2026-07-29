import { Search, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import {
  defaultShortcutForCommand,
  detectKeymapPlatform,
  findKeymapSequenceConflicts,
  keymapCommands,
  rebindableKeymapCommands,
  shortcutForCommand,
  shortcutSequenceForPlatform,
  shortcutFromKeyboardEvent,
  type KeymapCommandId,
  type KeymapPlatform,
} from "../domain/keymap";
import type { AppSettings } from "../domain/settings";
import { shortcutStrokeFromKeyboardEvent } from "../domain/shortcutSequence";

interface KeymapSettingsPanelProps {
  appSettings: AppSettings;
  onChangeShortcut(commandId: KeymapCommandId, shortcut: string): void;
  platform?: KeymapPlatform;
}

interface PendingChordCapture {
  commandId: KeymapCommandId;
  firstStroke: string;
  originalShortcut: string;
}

const commandOrder = new Map(keymapCommands.map((command, index) => [command.id, index]));

function isSafeBareFirstStroke(key: string): boolean {
  return /^F(?:[1-9]|1\d|2[0-4])$/iu.test(key);
}

export function KeymapSettingsPanel({
  appSettings,
  onChangeShortcut,
  platform,
}: KeymapSettingsPanelProps) {
  const [filter, setFilter] = useState("");
  const [pendingChord, setPendingChord] = useState<PendingChordCapture | null>(null);
  const [detectedPlatform] = useState(() => platform ?? detectKeymapPlatform());
  const resolvedPlatform = platform ?? detectedPlatform;
  const conflictKeymap = useMemo(
    () =>
      Object.fromEntries(
        keymapCommands.map((command) => [
          command.id,
          shortcutSequenceForPlatform(
            shortcutForCommand(appSettings.keymap, command.id, resolvedPlatform),
            resolvedPlatform,
          ),
        ]),
      ) as Record<KeymapCommandId, string>,
    [appSettings.keymap, resolvedPlatform],
  );

  const visibleCommands = useMemo(() => {
    const normalizedFilter = filter.trim().toLowerCase();
    if (!normalizedFilter) return rebindableKeymapCommands;

    return rebindableKeymapCommands.filter((command) => {
      const shortcut = appSettings.keymap[command.id] || defaultShortcutForCommand(command.id);
      return `${command.label} ${command.category} ${command.id} ${shortcut}`
        .toLowerCase()
        .includes(normalizedFilter);
    });
  }, [appSettings.keymap, filter]);

  return (
    <div className="settings-group">
      <div className="palette-search keymap-search">
        <Search aria-hidden="true" size={16} />
        <input
          aria-label="Filter shortcuts"
          onChange={(event) => setFilter(event.currentTarget.value)}
          placeholder="Filter shortcuts"
          spellCheck={false}
          value={filter}
        />
      </div>

      {visibleCommands.length === 0 ? (
        <div className="keymap-empty">No matching shortcuts</div>
      ) : null}

      {visibleCommands.map((command) => {
        const conflicts = findKeymapSequenceConflicts(conflictKeymap, command.id)
          .map((conflict) => {
            const owner = keymapCommands.find((candidate) => candidate.id === conflict.id);
            return owner ? { ...conflict, label: owner.label } : null;
          })
          .filter((conflict): conflict is NonNullable<typeof conflict> => conflict !== null)
          .sort(
            (left, right) =>
              (left.kind === "exact" ? 0 : 1) - (right.kind === "exact" ? 0 : 1) ||
              (commandOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
                (commandOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER),
          );
        const exactConflicts = conflicts.filter((conflict) => conflict.kind === "exact");
        const prefixConflicts = conflicts.filter((conflict) => conflict.kind === "prefix");
        const isWaitingForSecondStroke = pendingChord?.commandId === command.id;

        return (
          <label className="settings-field keymap-field" key={command.id}>
            <span>
              <strong>{command.label}</strong>
              <small>{command.category}</small>
            </span>
            <input
              aria-describedby={isWaitingForSecondStroke ? `${command.id}-chord-hint` : undefined}
              onBlur={(event) => {
                setPendingChord((current) => (current?.commandId === command.id ? null : current));
                onChangeShortcut(command.id, event.currentTarget.value);
              }}
              onChange={(event) => {
                setPendingChord((current) => (current?.commandId === command.id ? null : current));
                onChangeShortcut(command.id, event.currentTarget.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape" && isWaitingForSecondStroke) {
                  event.preventDefault();
                  event.stopPropagation();
                  onChangeShortcut(command.id, pendingChord.originalShortcut);
                  setPendingChord(null);
                  return;
                }

                const stroke = shortcutStrokeFromKeyboardEvent(event);
                const captured = isWaitingForSecondStroke
                  ? (stroke?.value ?? null)
                  : (shortcutFromKeyboardEvent(event) ??
                    (stroke && isSafeBareFirstStroke(event.key) ? stroke.value : null));
                if (!captured) return;

                event.preventDefault();
                event.stopPropagation();
                if (isWaitingForSecondStroke) {
                  onChangeShortcut(command.id, `${pendingChord.firstStroke} ${captured}`);
                  setPendingChord(null);
                  return;
                }

                setPendingChord({
                  commandId: command.id,
                  firstStroke: captured,
                  originalShortcut: appSettings.keymap[command.id],
                });
                // Keep single-stroke capture immediate. A second stroke while
                // the same field remains focused upgrades it to a sequence.
                onChangeShortcut(command.id, captured);
              }}
              placeholder={defaultShortcutForCommand(command.id)}
              spellCheck={false}
              value={appSettings.keymap[command.id]}
            />
            {isWaitingForSecondStroke ? (
              <small className="keymap-chord-hint" id={`${command.id}-chord-hint`} role="status">
                Waiting for second key… Press Escape to cancel.
              </small>
            ) : null}
            {conflicts.length > 0 ? (
              <small className="keymap-conflict" role="alert">
                <TriangleAlert aria-hidden="true" size={12} />
                <span>
                  {exactConflicts.length > 0
                    ? `Also used by ${exactConflicts.map((conflict) => conflict.label).join(", ")}. `
                    : null}
                  {prefixConflicts.length > 0
                    ? `Shares a first key with ${prefixConflicts
                        .map((conflict) => conflict.label)
                        .join(", ")}.`
                    : null}
                </span>
              </small>
            ) : null}
          </label>
        );
      })}
    </div>
  );
}
