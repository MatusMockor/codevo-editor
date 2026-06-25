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
    defaultShortcut: "Shift+F12",
    id: "editor.findReferences",
    label: "Find All References",
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
    defaultShortcut: "Shift+Alt+F",
    id: "editor.formatDocument",
    label: "Format Document",
  },
  {
    category: "Editor",
    defaultShortcut: "Alt+Enter",
    id: "editor.quickFix",
    label: "Context Actions",
  },
  {
    category: "Editor",
    defaultShortcut: "F8",
    id: "editor.nextProblem",
    label: "Go to Next Problem",
  },
  {
    category: "Editor",
    defaultShortcut: "Shift+F8",
    id: "editor.previousProblem",
    label: "Go to Previous Problem",
  },
  {
    category: "Editor",
    defaultShortcut: "Alt+ArrowUp",
    id: "editor.extendSelection",
    label: "Extend Selection",
  },
  {
    category: "Editor",
    defaultShortcut: "Cmd+Shift+ArrowUp",
    id: "editor.moveLineUp",
    label: "Move Line Up",
  },
  {
    category: "Editor",
    defaultShortcut: "Cmd+Shift+ArrowDown",
    id: "editor.moveLineDown",
    label: "Move Line Down",
  },
  {
    category: "Editor",
    defaultShortcut: "Cmd+Shift+D",
    id: "editor.duplicateLine",
    label: "Duplicate Line or Selection",
  },
  {
    category: "Editor",
    defaultShortcut: "Cmd+D",
    id: "editor.addSelectionToNextMatch",
    label: "Add Selection to Next Match",
  },
  {
    category: "Editor",
    defaultShortcut: "Cmd+Shift+K",
    id: "editor.deleteLine",
    label: "Delete Line",
  },
  {
    category: "Editor",
    defaultShortcut: "Cmd+Alt+T",
    id: "editor.surroundWith",
    label: "Surround With",
  },
  {
    category: "Editor",
    defaultShortcut: "Cmd+=",
    id: "editor.fontZoomIn",
    label: "Increase Editor Font Size",
  },
  {
    category: "Editor",
    defaultShortcut: "Cmd+-",
    id: "editor.fontZoomOut",
    label: "Decrease Editor Font Size",
  },
  {
    category: "Editor",
    defaultShortcut: "Cmd+0",
    id: "editor.fontZoomReset",
    label: "Reset Editor Font Size",
  },
  {
    category: "Editor",
    defaultShortcut: "",
    id: "editor.toggleFontLigatures",
    label: "Toggle Editor Font Ligatures",
  },
  {
    category: "File",
    defaultShortcut: "Cmd+P",
    id: "file.quickOpen",
    label: "Quick Open File",
  },
  {
    category: "File",
    defaultShortcut: "Cmd+E",
    id: "editor.recentFiles",
    label: "Recent Files",
  },
  {
    category: "PHP",
    defaultShortcut: "Cmd+O",
    id: "class.quickOpen",
    label: "Open Class or Interface",
  },
  {
    category: "PHP",
    defaultShortcut: "",
    id: "php.goToTest",
    label: "Go to Test / Test Subject",
  },
  {
    category: "PHP",
    defaultShortcut: "",
    id: "php.runTest",
    label: "Run Test Under Cursor",
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
    defaultShortcut: "",
    id: "workbench.openAppearanceSettings",
    label: "Open Appearance Settings",
  },
  {
    category: "Workbench",
    defaultShortcut: "Cmd+J",
    id: "panel.toggle",
    label: "Toggle Bottom Panel",
  },
  {
    category: "Workbench",
    defaultShortcut: "Cmd+Shift+T",
    id: "panel.toggleTodo",
    label: "Toggle TODO Panel",
  },
  {
    category: "Terminal",
    defaultShortcut: "Ctrl+`",
    id: "terminal.show",
    label: "Show Terminal",
  },
] as const;

export type KeymapCommandId = (typeof keymapCommands)[number]["id"];
export type KeymapPlatform = "linux" | "mac" | "other" | "windows";
export type KeymapSettings = Record<KeymapCommandId, string>;

export interface ParsedShortcut {
  alt: boolean;
  ctrl: boolean;
  key: string;
  meta: boolean;
  shift: boolean;
}

interface KeymapNavigator {
  platform?: string;
  userAgent?: string;
  userAgentData?: {
    platform?: string;
  };
}

export function detectKeymapPlatform(
  navigatorLike: KeymapNavigator | undefined =
    typeof navigator === "undefined" ? undefined : navigator,
): KeymapPlatform {
  const platformText = [
    navigatorLike?.userAgentData?.platform,
    navigatorLike?.platform,
    navigatorLike?.userAgent,
    navigatorLike ? "" : processPlatform(),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/(mac|iphone|ipad|ipod|darwin)/.test(platformText)) {
    return "mac";
  }

  if (/(win|windows)/.test(platformText)) {
    return "windows";
  }

  if (/(linux|x11)/.test(platformText)) {
    return "linux";
  }

  return "other";
}

export function defaultKeymapSettings(
  platform: KeymapPlatform = detectKeymapPlatform(),
): KeymapSettings {
  return Object.fromEntries(
    keymapCommands.map((command) => [
      command.id,
      defaultShortcutForCommand(command.id, platform),
    ]),
  ) as KeymapSettings;
}

export function defaultShortcutForCommand(
  commandId: KeymapCommandId,
  platform: KeymapPlatform = detectKeymapPlatform(),
): string {
  const command = keymapCommands.find((candidate) => candidate.id === commandId);

  if (!command) {
    return "";
  }

  return shortcutForPlatform(command.defaultShortcut, platform);
}

export function normalizeKeymapSettings(
  value: unknown,
  platform: KeymapPlatform = detectKeymapPlatform(),
): KeymapSettings {
  const defaults = defaultKeymapSettings(platform);

  if (!isRecord(value)) {
    return defaults;
  }

  const keymap = { ...defaults };

  for (const command of keymapCommands) {
    const shortcut = value[command.id];

    if (typeof shortcut !== "string") {
      continue;
    }

    const normalized = normalizeShortcutInput(shortcut);
    keymap[command.id] =
      platform === "mac" || normalized !== command.defaultShortcut
        ? normalized
        : defaultShortcutForCommand(command.id, platform);
  }

  return keymap;
}

export function shortcutForCommand(
  keymap: KeymapSettings,
  commandId: KeymapCommandId,
  platform: KeymapPlatform = detectKeymapPlatform(),
): string {
  return keymap[commandId] ?? defaultKeymapSettings(platform)[commandId];
}

export function matchesShortcut(
  event: KeyboardEvent,
  shortcut: string,
  platform: KeymapPlatform = detectKeymapPlatform(),
): boolean {
  const parsed = parseShortcut(shortcut);

  if (!parsed) {
    return false;
  }

  const metaMatchesPrimary = parsed.meta && platform !== "mac";
  const expectedMeta = parsed.meta && !metaMatchesPrimary;
  const expectedCtrl = parsed.ctrl || metaMatchesPrimary;

  return (
    event.metaKey === expectedMeta &&
    event.ctrlKey === expectedCtrl &&
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

function shortcutForPlatform(
  shortcut: string,
  platform: KeymapPlatform,
): string {
  const normalized = normalizeShortcutInput(shortcut);

  if (platform === "mac") {
    return normalized;
  }

  return normalized
    .split("+")
    .map((part) => (part === "Cmd" ? "Ctrl" : part))
    .join("+");
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function processPlatform(): string {
  return (
    (globalThis as { process?: { platform?: string } }).process?.platform ?? ""
  );
}
