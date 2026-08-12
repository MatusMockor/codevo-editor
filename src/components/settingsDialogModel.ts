import type { SettingsSection } from "../domain/settings";
import type { UserSnippet } from "../domain/snippets";

export const settingsDialogSections: ReadonlyArray<{
  readonly id: SettingsSection;
  readonly label: string;
}> = [
  { id: "general", label: "General" },
  { id: "keymap", label: "Keymap" },
  { id: "php", label: "PHP" },
  { id: "git", label: "Directory Mappings" },
  { id: "index", label: "Index" },
  { id: "snippets", label: "Snippets" },
  { id: "appearance", label: "Appearance" },
  { id: "agents", label: "Agents" },
];

export const newUserSnippet = (): UserSnippet => ({
  prefix: "",
  body: "",
  description: "",
  languages: ["php"],
});

export function boundedPositiveIntegerInputValue(
  value: string,
  min: number,
  max: number,
): number | null {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 1) return null;
  return Math.min(Math.max(Math.floor(numericValue), min), max);
}
