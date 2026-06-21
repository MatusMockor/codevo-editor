export const keymapCommands = [
  {
    category: "Editor",
    defaultShortcut: "Cmd+S",
    id: "editor.save",
    label: "Save File",
  },
  {
    category: "Editor",
    defaultShortcut: "Cmd+W",
    id: "editor.closeTab",
    label: "Close Tab or Window",
  },
  {
    category: "Editor",
    defaultShortcut: "Cmd+B",
    id: "editor.goToDefinition",
    label: "Go to Definition",
  },
  {
    category: "Editor",
    defaultShortcut: "",
    id: "editor.goToSourceDefinition",
    label: "Go to Source Definition",
  },
  {
    category: "Editor",
    defaultShortcut: "",
    id: "editor.goToDeclaration",
    label: "Go to Declaration",
  },
  {
    category: "Editor",
    defaultShortcut: "",
    id: "editor.goToTypeDefinition",
    label: "Go to Type Definition",
  },
  {
    category: "Editor",
    defaultShortcut: "Cmd+Alt+B",
    id: "editor.goToImplementation",
    label: "Go to Implementation",
  },
  {
    category: "Editor",
    defaultShortcut: "Cmd+R",
    id: "editor.fileStructure",
    label: "File Structure",
  },
  {
    category: "Editor",
    defaultShortcut: "Cmd+T",
    id: "editor.goToSymbol",
    label: "Go to Symbol in Workspace",
  },
  {
    category: "Editor",
    defaultShortcut: "Alt+Enter",
    id: "editor.quickFix",
    label: "Context Actions",
  },
  {
    category: "Editor",
    defaultShortcut: "Alt+ArrowUp",
    id: "editor.extendSelection",
    label: "Extend Selection",
  },
  {
    category: "File",
    defaultShortcut: "Cmd+P",
    id: "file.quickOpen",
    label: "Quick Open File",
  },
  {
    category: "PHP",
    defaultShortcut: "Cmd+O",
    id: "class.quickOpen",
    label: "Open Class or Interface",
  },
  {
    category: "Navigation",
    defaultShortcut: "Cmd+[",
    id: "navigation.back",
    label: "Go Back",
  },
  {
    category: "Navigation",
    defaultShortcut: "Cmd+]",
    id: "navigation.forward",
    label: "Go Forward",
  },
  {
    category: "Search",
    defaultShortcut: "Cmd+Shift+F",
    id: "search.text",
    label: "Search Text",
  },
  {
    category: "Workbench",
    defaultShortcut: "Cmd+K",
    id: "commands.show",
    label: "Show Commands",
  },
  {
    category: "Workbench",
    defaultShortcut: "Cmd+,",
    id: "workbench.openSettings",
    label: "Open Settings",
  },
  {
    category: "Workbench",
    defaultShortcut: "Cmd+J",
    id: "panel.toggle",
    label: "Toggle Bottom Panel",
  },
  {
    category: "Terminal",
    defaultShortcut: "Ctrl+`",
    id: "terminal.show",
    label: "Show Terminal",
  },
] as const;

export type KeymapCommandId = (typeof keymapCommands)[number]["id"];
export type KeymapSettings = Record<KeymapCommandId, string>;

export interface ParsedShortcut {
  alt: boolean;
  ctrl: boolean;
  key: string;
  meta: boolean;
  shift: boolean;
}

export function defaultKeymapSettings(): KeymapSettings {
  return Object.fromEntries(
    keymapCommands.map((command) => [command.id, command.defaultShortcut]),
  ) as KeymapSettings;
}

export function normalizeKeymapSettings(value: unknown): KeymapSettings {
  const defaults = defaultKeymapSettings();

  if (!isRecord(value)) {
    return defaults;
  }

  const keymap = { ...defaults };

  for (const command of keymapCommands) {
    const shortcut = value[command.id];

    if (typeof shortcut !== "string") {
      continue;
    }

    keymap[command.id] = normalizeShortcutInput(shortcut);
  }

  return keymap;
}

export function shortcutForCommand(
  keymap: KeymapSettings,
  commandId: KeymapCommandId,
): string {
  return keymap[commandId] ?? defaultKeymapSettings()[commandId];
}

export function matchesShortcut(
  event: KeyboardEvent,
  shortcut: string,
): boolean {
  const parsed = parseShortcut(shortcut);

  if (!parsed) {
    return false;
  }

  return (
    event.metaKey === parsed.meta &&
    event.ctrlKey === parsed.ctrl &&
    event.altKey === parsed.alt &&
    event.shiftKey === parsed.shift &&
    normalizeKeyboardEventKey(event.key) === parsed.key
  );
}

export function parseShortcut(shortcut: string): ParsedShortcut | null {
  const normalized = normalizeShortcutInput(shortcut);

  if (!normalized) {
    return null;
  }

  const parts = normalized.split("+").map((part) => part.trim()).filter(Boolean);
  const key = parts[parts.length - 1];

  if (!key) {
    return null;
  }

  return {
    alt: parts.slice(0, -1).some((part) => part.toLowerCase() === "alt"),
    ctrl: parts.slice(0, -1).some((part) => part.toLowerCase() === "ctrl"),
    key: normalizeShortcutKey(key),
    meta: parts.slice(0, -1).some((part) => part.toLowerCase() === "cmd"),
    shift: parts.slice(0, -1).some((part) => part.toLowerCase() === "shift"),
  };
}

export function normalizeShortcutInput(value: string): string {
  return value
    .split("+")
    .map((part) => normalizeShortcutPart(part.trim()))
    .filter(Boolean)
    .join("+");
}

function normalizeShortcutPart(part: string): string {
  const lower = part.toLowerCase();

  if (!lower) {
    return "";
  }

  if (lower === "command" || lower === "meta" || lower === "cmd") {
    return "Cmd";
  }

  if (lower === "control" || lower === "ctrl") {
    return "Ctrl";
  }

  if (lower === "option" || lower === "alt") {
    return "Alt";
  }

  if (lower === "shift") {
    return "Shift";
  }

  if (lower === "return") {
    return "Enter";
  }

  if (/^[a-z]$/.test(lower)) {
    return lower.toUpperCase();
  }

  if (lower.startsWith("arrow")) {
    return `Arrow${capitalize(lower.slice("arrow".length))}`;
  }

  return part;
}

function normalizeShortcutKey(key: string): string {
  return normalizeKeyboardEventKey(normalizeShortcutPart(key));
}

function normalizeKeyboardEventKey(key: string): string {
  if (key.length === 1) {
    return key.toLowerCase();
  }

  return key.toLowerCase();
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
