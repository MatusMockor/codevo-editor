import {
  Bot,
  Braces,
  Code2,
  Keyboard,
  Layers,
  Palette,
  Monitor,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import type { SettingsSection } from "../../domain/settings";
import { SETTINGS_ROW_TABLE } from "./settingsRegistryRows";

export type SettingsSectionId =
  "general" | "appearance" | "agents" | "environments" | "keymap" | "index" | "php" | "snippets";

export type SettingsRowAvailability = "always" | "workspace";

export const SETTINGS_ROWS = SETTINGS_ROW_TABLE;

export type SettingsRowId = (typeof SETTINGS_ROWS)[number]["id"];

export interface SettingsSectionDescriptor {
  readonly id: SettingsSectionId;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly description: string;
}

export interface SettingsRowDescriptor {
  readonly id: SettingsRowId;
  readonly section: SettingsSectionId;
  readonly title: string;
  readonly description: string | null;
  readonly keywords: ReadonlyArray<string>;
  readonly availability: SettingsRowAvailability;
}

export interface SettingsRoute {
  readonly section: SettingsSectionId;
  readonly row: SettingsRowId | null;
}

export const SETTINGS_SECTIONS: ReadonlyArray<SettingsSectionDescriptor> = [
  {
    id: "general",
    label: "General",
    icon: SlidersHorizontal,
    description: "Updates, workspace mode, trust, editing, and the status bar.",
  },
  {
    id: "appearance",
    label: "Appearance",
    icon: Palette,
    description: "Theme, agent appearance, and editor typography.",
  },
  {
    id: "agents",
    label: "Agents",
    icon: Bot,
    description: "Provider CLIs and the defaults used by new agent threads.",
  },
  {
    id: "environments",
    label: "Environments",
    icon: Monitor,
    description: "Where your agent threads run.",
  },
  {
    id: "keymap",
    label: "Keybindings",
    icon: Keyboard,
    description: "Every command shortcut, its conflicts, and its default.",
  },
  {
    id: "index",
    label: "Index & languages",
    icon: Layers,
    description: "Indexing limits, JavaScript and TypeScript, linters, and git mappings.",
  },
  {
    id: "php",
    label: "PHP",
    icon: Code2,
    description: "PHP engine, language level, tool paths, and analysis.",
  },
  {
    id: "snippets",
    label: "Snippets",
    icon: Braces,
    description: "User live templates shared across every project.",
  },
];

const rowsBySection = groupRowsBySection();
const rowsById = new Map<string, SettingsRowDescriptor>(
  SETTINGS_ROWS.map((row) => [row.id, row] as const),
);

export function settingsRowsForSection(
  id: SettingsSectionId,
): ReadonlyArray<SettingsRowDescriptor> {
  return rowsBySection.get(id) ?? [];
}

export function settingsRowDescriptor(id: SettingsRowId): SettingsRowDescriptor {
  const descriptor = rowsById.get(id);

  if (descriptor === undefined) {
    throw new Error(`Unknown settings row: ${id}`);
  }

  return descriptor;
}

export function settingsSectionDescriptor(id: SettingsSectionId): SettingsSectionDescriptor {
  const descriptor = SETTINGS_SECTIONS.find((section) => section.id === id);

  if (descriptor === undefined) {
    throw new Error(`Unknown settings section: ${id}`);
  }

  return descriptor;
}

export function resolveSettingsRoute(section: SettingsSection): SettingsRoute {
  switch (section) {
    case "general":
      return { section: "general", row: null };
    case "appearance":
      return { section: "appearance", row: null };
    case "agents":
      return { section: "agents", row: null };
    case "environments":
      return { section: "environments", row: null };
    case "keymap":
      return { section: "keymap", row: null };
    case "index":
      return { section: "index", row: null };
    case "php":
      return { section: "php", row: null };
    case "snippets":
      return { section: "snippets", row: null };
    case "git":
      return { section: "index", row: "index.gitDirectoryMappings" };
    default:
      return section satisfies never;
  }
}

function groupRowsBySection(): ReadonlyMap<
  SettingsSectionId,
  ReadonlyArray<SettingsRowDescriptor>
> {
  const grouped = new Map<SettingsSectionId, SettingsRowDescriptor[]>();

  for (const row of SETTINGS_ROWS) {
    const bucket = grouped.get(row.section);

    if (bucket === undefined) {
      grouped.set(row.section, [row]);
      continue;
    }

    bucket.push(row);
  }

  return grouped;
}
