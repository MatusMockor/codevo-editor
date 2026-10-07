import {
  Archive,
  Bot,
  Braces,
  Code2,
  Gauge,
  Keyboard,
  Layers,
  Monitor,
  Plug,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import type { SettingsSection } from "../../domain/settings";
import { SETTINGS_ROW_TABLE } from "./settingsRegistryRows";

export type SettingsSectionId =
  | "general"
  | "agents"
  | "environments"
  | "mcp"
  | "keymap"
  | "index"
  | "snippets"
  | "usage"
  | "archive"
  | "php";

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
    description: "Theme, text, updates, workspace, and editing.",
  },
  {
    id: "agents",
    label: "Providers",
    icon: Bot,
    description: "Claude Code and Codex, models, and defaults for new threads.",
  },
  {
    id: "environments",
    label: "Environments",
    icon: Monitor,
    description: "Where your agent threads run.",
  },
  {
    id: "mcp",
    label: "MCP servers",
    icon: Plug,
    description: "Servers your agent providers can reach, and their status.",
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
    id: "snippets",
    label: "Snippets",
    icon: Braces,
    description: "User live templates shared across every project.",
  },
  {
    id: "usage",
    label: "Usage",
    icon: Gauge,
    description: "Subscription limits and local activity.",
  },
  {
    id: "archive",
    label: "Archive",
    icon: Archive,
    description: "Archived threads from every project.",
  },
  {
    id: "php",
    label: "PHP",
    icon: Code2,
    description: "PHP engine, language level, tool paths, and analysis.",
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
    case "agents":
    case "environments":
    case "mcp":
    case "keymap":
    case "index":
    case "php":
    case "snippets":
    case "usage":
    case "archive":
      return { section, row: null };
    case "appearance":
      return { section: "general", row: "appearance.palette" };
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
