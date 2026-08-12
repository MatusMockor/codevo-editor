import type { UserSnippet } from "../domain/snippets";
import { snippetLanguageOptions } from "../domain/snippetLanguageOptions";
import { newUserSnippet } from "./settingsDialogModel";

export interface SnippetsSettingsProps {
  userSnippets: UserSnippet[];
  onChangeUserSnippets(snippets: UserSnippet[]): void;
}

export function SnippetsSettings({ userSnippets, onChangeUserSnippets }: SnippetsSettingsProps) {
  const updateSnippetAt = (index: number, patch: Partial<UserSnippet>) => {
    onChangeUserSnippets(
      userSnippets.map((snippet, position) =>
        position === index ? { ...snippet, ...patch } : snippet,
      ),
    );
  };

  const removeSnippetAt = (index: number) => {
    onChangeUserSnippets(userSnippets.filter((_snippet, position) => position !== index));
  };

  const toggleLanguage = (index: number, language: string, on: boolean) => {
    const current = userSnippets[index].languages;
    const next = on
      ? Array.from(new Set([...current, language]))
      : current.filter((id) => id !== language);

    updateSnippetAt(index, { languages: next });
  };

  return (
    <div className="settings-group">
      <p className="settings-hint">
        Live templates expand a typed prefix using Monaco snippet syntax (<code>$1</code>,{" "}
        <code>${"{1:default}"}</code>, <code>$0</code>). User snippets are shared across every
        project and override a built-in with the same prefix and language.
      </p>

      <div className="settings-actions">
        <button
          onClick={() => onChangeUserSnippets([...userSnippets, newUserSnippet()])}
          type="button"
        >
          Add snippet
        </button>
      </div>

      {userSnippets.length === 0 ? (
        <div className="settings-readout">
          <span>No user snippets yet</span>
        </div>
      ) : null}

      {userSnippets.map((snippet, index) => (
        <div className="settings-subgroup snippet-editor" key={index}>
          <label className="settings-field">
            <span>Prefix</span>
            <input
              data-snippet-field="prefix"
              onChange={(event) => updateSnippetAt(index, { prefix: event.currentTarget.value })}
              placeholder="myhelper"
              spellCheck={false}
              value={snippet.prefix}
            />
          </label>

          <label className="settings-field">
            <span>Description</span>
            <input
              data-snippet-field="description"
              onChange={(event) =>
                updateSnippetAt(index, {
                  description: event.currentTarget.value,
                })
              }
              value={snippet.description}
            />
          </label>

          <label className="settings-field">
            <span>Body</span>
            <textarea
              data-snippet-field="body"
              onChange={(event) => updateSnippetAt(index, { body: event.currentTarget.value })}
              rows={5}
              spellCheck={false}
              value={snippet.body}
            />
          </label>

          <div className="settings-subgroup">
            <span>Languages</span>
            {snippetLanguageOptions.map((option) => (
              <label className="settings-toggle" key={option.id}>
                <input
                  checked={snippet.languages.includes(option.id)}
                  onChange={(event) =>
                    toggleLanguage(index, option.id, event.currentTarget.checked)
                  }
                  type="checkbox"
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>

          <div className="settings-actions">
            <button onClick={() => removeSnippetAt(index)} type="button">
              Delete snippet
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
