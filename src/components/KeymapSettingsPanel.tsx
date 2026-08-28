import { Search, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import {
  defaultShortcutForCommand,
  detectKeymapPlatform,
  findKeymapSequenceConflicts,
  keymapCommands,
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

  const visibleCategories = useMemo(() => {
    const normalizedFilter = filter.trim().toLowerCase();
    const commands = normalizedFilter
      ? keymapCommands.filter((command) => {
          const currentShortcut = shortcutForCommand(
            appSettings.keymap,
            command.id,
            resolvedPlatform,
          );
          const defaultShortcut = defaultShortcutForCommand(command.id, resolvedPlatform);
          return `${command.label} ${command.category} ${command.id} ${currentShortcut} ${defaultShortcut}`
            .toLowerCase()
            .includes(normalizedFilter);
        })
      : keymapCommands;
    const grouped = new Map<string, (typeof keymapCommands)[number][]>();

    for (const command of commands) {
      const categoryCommands = grouped.get(command.category);
      if (categoryCommands) {
        categoryCommands.push(command);
      } else {
        grouped.set(command.category, [command]);
      }
    }

    return [...grouped.entries()].map(([category, categoryCommands]) => ({
      category,
      commands: categoryCommands,
    }));
  }, [appSettings.keymap, filter, resolvedPlatform]);

  const visibleCommandCount = visibleCategories.reduce(
    (count, category) => count + category.commands.length,
    0,
  );

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

      {visibleCommandCount === 0 ? <div className="keymap-empty">No matching shortcuts</div> : null}

      {visibleCategories.map(({ category, commands }, categoryIndex) => (
        <section
          aria-labelledby={`keymap-category-${categoryIndex}`}
          className="settings-subgroup keymap-category"
          key={category}
        >
          <span id={`keymap-category-${categoryIndex}`}>{category}</span>
          {commands.map((command) => {
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
            const isRebindable = !("rebindable" in command);
            const currentShortcut = shortcutForCommand(
              appSettings.keymap,
              command.id,
              resolvedPlatform,
            );
            const defaultShortcut = defaultShortcutForCommand(command.id, resolvedPlatform);

            return (
              <div className="keymap-command" key={command.id}>
                <label className="settings-field keymap-field">
                  <span>
                    <strong>{command.label}</strong>
                    <small>{command.id}</small>
                  </span>
                  <input
                    aria-describedby={
                      isWaitingForSecondStroke ? `${command.id}-chord-hint` : undefined
                    }
                    disabled={!isRebindable}
                    onBlur={(event) => {
                      if (!isRebindable) return;
                      setPendingChord((current) =>
                        current?.commandId === command.id ? null : current,
                      );
                      onChangeShortcut(command.id, event.currentTarget.value);
                    }}
                    onChange={(event) => {
                      if (!isRebindable) return;
                      setPendingChord((current) =>
                        current?.commandId === command.id ? null : current,
                      );
                      onChangeShortcut(command.id, event.currentTarget.value);
                    }}
                    onKeyDown={(event) => {
                      if (!isRebindable) return;
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
                        originalShortcut: currentShortcut,
                      });
                      // Keep single-stroke capture immediate. A second stroke while
                      // the same field remains focused upgrades it to a sequence.
                      onChangeShortcut(command.id, captured);
                    }}
                    placeholder={defaultShortcut}
                    readOnly={!isRebindable}
                    spellCheck={false}
                    value={currentShortcut}
                  />
                  {!isRebindable ? (
                    <small>Reserved by editor navigation and cannot be rebound.</small>
                  ) : null}
                  {isWaitingForSecondStroke ? (
                    <small
                      className="keymap-chord-hint"
                      id={`${command.id}-chord-hint`}
                      role="status"
                    >
                      Waiting for second key… Press Escape to cancel.
                    </small>
                  ) : null}
                  {conflicts.length > 0 ? (
                    <small className="keymap-conflict" role="alert">
                      <TriangleAlert aria-hidden="true" size={12} />
                      <span>
                        {exactConflicts.length > 0
                          ? `Also used by ${exactConflicts
                              .map((conflict) => conflict.label)
                              .join(", ")}. `
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
                {isRebindable ? (
                  <div className="settings-actions">
                    <button
                      aria-label={`Reset ${command.label} (${command.id}) to default`}
                      disabled={currentShortcut === defaultShortcut}
                      onClick={() => onChangeShortcut(command.id, defaultShortcut)}
                      type="button"
                    >
                      Reset to Default
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
