import type { KeymapCommandId } from "../../../domain/keymap";
import { KeybindingRow } from "./KeybindingRow";
import type { KeybindingCategory } from "./keybindingsPresentation";
import { useKeybindingRecorder } from "./useKeybindingRecorder";

export interface KeybindingsListProps {
  readonly categories: ReadonlyArray<KeybindingCategory>;
  onChangeShortcut(commandId: KeymapCommandId, shortcut: string): void;
}

export function KeybindingsList({ categories, onChangeShortcut }: KeybindingsListProps) {
  const recorder = useKeybindingRecorder(onChangeShortcut);

  if (categories.length === 0) {
    return (
      <div className="settings-group">
        <p className="settings-kb__empty">No matching shortcuts</p>
      </div>
    );
  }

  return (
    <div className="settings-kb">
      {categories.map((group) => (
        <section aria-label={group.category} className="settings-kb__group" key={group.category}>
          <h3 className="settings-kb__category">{group.category}</h3>
          <div className="settings-group">
            {group.bindings.map((binding) => (
              <KeybindingRow
                binding={binding}
                key={binding.commandId}
                onReset={() => onChangeShortcut(binding.commandId, binding.defaultShortcut)}
                onUnbind={() => onChangeShortcut(binding.commandId, "")}
                recorder={recorder}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
