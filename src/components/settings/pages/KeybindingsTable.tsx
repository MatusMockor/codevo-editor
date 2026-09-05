import type { KeymapCommandId } from "../../../domain/keymap";
import { KeybindingRow } from "./KeybindingRow";
import type { KeybindingCategory } from "./keybindingsPresentation";
import { useKeybindingRecorder } from "./useKeybindingRecorder";

export interface KeybindingsTableProps {
  readonly categories: ReadonlyArray<KeybindingCategory>;
  onChangeShortcut(commandId: KeymapCommandId, shortcut: string): void;
}

export function KeybindingsTable({ categories, onChangeShortcut }: KeybindingsTableProps) {
  const recorder = useKeybindingRecorder(onChangeShortcut);

  if (categories.length === 0) {
    return <p className="settings-kb__empty">No matching shortcuts</p>;
  }

  return (
    <div className="settings-kb">
      <table className="settings-kb__table">
        <thead>
          <tr>
            <th scope="col">Command</th>
            <th scope="col">Keybinding</th>
            <th scope="col">When</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        {categories.map((group) => (
          <tbody key={group.category}>
            <tr className="settings-kb__cat">
              <th colSpan={4} scope="colgroup">
                {group.category}
              </th>
            </tr>
            {group.bindings.map((binding) => (
              <KeybindingRow
                binding={binding}
                key={binding.commandId}
                onReset={() => onChangeShortcut(binding.commandId, binding.defaultShortcut)}
                onUnbind={() => onChangeShortcut(binding.commandId, "")}
                recorder={recorder}
              />
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}
