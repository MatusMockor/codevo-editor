import { Plus } from "lucide-react";
import { snippetLanguageOptions } from "../../../domain/snippetLanguageOptions";
import type { UserSnippet } from "../../../domain/snippets";
import { newUserSnippet } from "../../settingsDialogModel";
import { SettingsButton } from "../primitives/SettingsButton";
import { SettingsChipGroup } from "../primitives/SettingsChipGroup";
import { SettingsRow } from "../primitives/SettingsRow";
import { SettingsSectionHeading } from "../primitives/SettingsSectionHeading";
import { SettingsTextArea } from "../primitives/SettingsTextArea";
import { SettingsTextField } from "../primitives/SettingsTextField";
import type { SettingsPageProps } from "../settingsPageProps";

const LANGUAGE_CHIPS = snippetLanguageOptions.map((option) => ({
  label: option.label,
  value: option.id,
}));

export function SnippetsSettingsPage({ actions, draft }: SettingsPageProps) {
  const snippets = draft.appSettings.userSnippets;

  const publish = (userSnippets: UserSnippet[]): void =>
    actions.updateAppSettings({ ...draft.appSettings, userSnippets });

  const patchAt = (index: number, patch: Partial<UserSnippet>): void =>
    publish(
      snippets.map((snippet, position) =>
        position === index ? { ...snippet, ...patch } : snippet,
      ),
    );

  const toggleLanguage = (index: number, language: string, on: boolean): void => {
    const current = snippets[index]?.languages ?? [];

    patchAt(index, {
      languages: on
        ? [...new Set([...current, language])]
        : current.filter((id) => id !== language),
    });
  };

  return (
    <SettingsSectionHeading
      actions={
        <SettingsButton
          onClick={() => publish([...snippets, newUserSnippet()])}
          size="compact"
          variant="outline"
        >
          <Plus aria-hidden="true" size={12} />
          Add snippet
        </SettingsButton>
      }
      title="Snippets"
    >
      <SettingsRow layout="stacked" rowId="snippets.userSnippets">
        <div className="settings-snippets">
          {snippets.length === 0 ? <p className="settings-readout">No user snippets yet</p> : null}

          {snippets.map((snippet, index) => (
            <div className="settings-snippet" key={index}>
              <SettingsTextField
                label={`Snippet ${index + 1} prefix`}
                mono
                onChange={(prefix) => patchAt(index, { prefix })}
                placeholder="myhelper"
                value={snippet.prefix}
                width="full"
              />
              <SettingsTextField
                label={`Snippet ${index + 1} description`}
                onChange={(description) => patchAt(index, { description })}
                placeholder="What it expands to"
                value={snippet.description}
                width="full"
              />
              <SettingsTextArea
                label={`Snippet ${index + 1} body`}
                onChange={(body) => patchAt(index, { body })}
                rows={5}
                value={snippet.body}
              />
              <SettingsChipGroup
                chips={LANGUAGE_CHIPS}
                label={`Snippet ${index + 1} languages`}
                onToggle={(language, on) => toggleLanguage(index, language, on)}
                selected={snippet.languages}
              />
              <SettingsButton
                label={`Delete snippet ${index + 1}`}
                onClick={() => publish(snippets.filter((_snippet, position) => position !== index))}
                size="compact"
                variant="ghostMuted"
              >
                Delete snippet
              </SettingsButton>
            </div>
          ))}
        </div>
      </SettingsRow>
    </SettingsSectionHeading>
  );
}
