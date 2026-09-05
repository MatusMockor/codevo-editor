import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import {
  detectKeymapPlatform,
  normalizeShortcutInput,
  type KeymapCommandId,
  type KeymapPlatform,
} from "../../../domain/keymap";
import { SettingsRow } from "../primitives/SettingsRow";
import { SettingsSectionHeading } from "../primitives/SettingsSectionHeading";
import type { SettingsPageProps } from "../settingsPageProps";
import { KeybindingsTable } from "./KeybindingsTable";
import { keybindingCategories, keybindingCountLabel } from "./keybindingsPresentation";

export interface KeybindingsSettingsPageProps extends SettingsPageProps {
  readonly platform?: KeymapPlatform;
}

export function KeybindingsSettingsPage({
  actions,
  draft,
  platform,
}: KeybindingsSettingsPageProps) {
  const [filter, setFilter] = useState("");
  const [detectedPlatform] = useState(() => platform ?? detectKeymapPlatform());
  const resolvedPlatform = platform ?? detectedPlatform;
  const keymap = draft.appSettings.keymap;

  const categories = useMemo(
    () => keybindingCategories(keymap, resolvedPlatform, filter),
    [filter, keymap, resolvedPlatform],
  );

  const changeShortcut = (commandId: KeymapCommandId, shortcut: string): void =>
    actions.updateAppSettings({
      ...draft.appSettings,
      keymap: { ...keymap, [commandId]: normalizeShortcutInput(shortcut) },
    });

  return (
    <SettingsSectionHeading
      actions={
        <>
          <span className="settings-kb__count">{keybindingCountLabel(categories)}</span>
          <span className="settings-kb__search">
            <Search aria-hidden="true" size={12} />
            <input
              aria-label="Search keybindings"
              className="settings-input"
              onChange={(event) => setFilter(event.currentTarget.value)}
              placeholder="Search keybindings"
              spellCheck={false}
              type="search"
              value={filter}
            />
          </span>
        </>
      }
      title="Keybindings"
    >
      <SettingsRow layout="stacked" rowId="keymap.bindings">
        <KeybindingsTable categories={categories} onChangeShortcut={changeShortcut} />
      </SettingsRow>
    </SettingsSectionHeading>
  );
}
