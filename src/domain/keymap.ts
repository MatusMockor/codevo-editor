import {
  normalizeShortcutSequenceInput,
  parseShortcutSequence,
  representableShortcutKey,
  shortcutKeyFromKeyboardEvent,
  shortcutSequenceForPlatform,
} from "./shortcutSequence";

export {
  findKeymapSequenceConflicts,
  lookupKeymapShortcutSequence,
  normalizeShortcutSequenceInput,
  parseShortcutSequence,
  shortcutSequenceForPlatform,
} from "./shortcutSequence";
export type {
  ShortcutSequence,
  ShortcutSequenceConflict,
  ShortcutSequenceLookup,
  ShortcutStroke,
} from "./shortcutSequence";

export const keymapCommands = [
  {
    category: "Application",
    defaultShortcut: "Cmd+Q",
    id: "app.quit",
    label: "Quit Application",
  },
  {
    category: "Workbench",
    defaultShortcut: "Cmd+W",
    id: "workbench.closeActive",
    label: "Close Active Panel",
  },
  {
    category: "Workbench",
    defaultShortcut: "Cmd+=",
    id: "workbench.zoomIn",
    label: "Zoom In",
  },
  {
    category: "Workbench",
    defaultShortcut: "Cmd+-",
    id: "workbench.zoomOut",
    label: "Zoom Out",
  },
  {
    category: "Workbench",
    defaultShortcut: "Cmd+0",
    id: "workbench.zoomReset",
    label: "Reset Zoom",
  },
  {
    category: "Git",
    // Switch/checkout branch. Cmd+Shift+B is free ("B" = branch).
    defaultShortcut: "Cmd+Shift+B",
    id: "git.switchBranch",
    label: "Git: Switch Branch",
  },
  {
    category: "Git",
    // New branch pairs with Switch Branch; Cmd+Alt+N ("new") stays distinct from
    // the Cmd+Shift+B switch-branch shortcut by both key and modifier.
    defaultShortcut: "Cmd+Alt+N",
    id: "git.newBranch",
    label: "Git: Open Branches",
  },
  {
    category: "Git",
    defaultShortcut: "",
    id: "git.commit",
    label: "Git: Open Commit",
  },
  {
    category: "File",
    defaultShortcut: "Cmd+P",
    id: "file.quickOpen",
    label: "Quick Open File",
  },
  {
    category: "Workbench",
    defaultShortcut: "Cmd+Shift+P",
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
    category: "Workspace",
    defaultShortcut: "Cmd+Alt+ArrowRight",
    id: "workspace.nextTab",
    label: "Next Workspace Tab",
  },
  {
    category: "Workspace",
    defaultShortcut: "Cmd+Alt+ArrowLeft",
    id: "workspace.previousTab",
    label: "Previous Workspace Tab",
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
  {
    category: "Agent",
    defaultShortcut: "Cmd+Shift+N",
    id: "agent.newThread",
    label: "New Thread",
  },
  {
    category: "Agent",
    defaultShortcut: "Cmd+N",
    id: "agent.newThreadIn",
    label: "New Thread in…",
  },
  {
    category: "Agent",
    defaultShortcut: "Cmd+Shift+[",
    id: "agent.previousThread",
    label: "Previous Thread",
  },
  {
    category: "Agent",
    defaultShortcut: "Cmd+Shift+]",
    id: "agent.nextThread",
    label: "Next Thread",
  },
  {
    category: "Agent",
    defaultShortcut: "Cmd+1",
    id: "agent.jumpToThread.1",
    label: "Jump to Thread 1",
  },
  {
    category: "Agent",
    defaultShortcut: "Cmd+2",
    id: "agent.jumpToThread.2",
    label: "Jump to Thread 2",
  },
  {
    category: "Agent",
    defaultShortcut: "Cmd+3",
    id: "agent.jumpToThread.3",
    label: "Jump to Thread 3",
  },
  {
    category: "Agent",
    defaultShortcut: "Cmd+4",
    id: "agent.jumpToThread.4",
    label: "Jump to Thread 4",
  },
  {
    category: "Agent",
    defaultShortcut: "Cmd+5",
    id: "agent.jumpToThread.5",
    label: "Jump to Thread 5",
  },
  {
    category: "Agent",
    defaultShortcut: "Cmd+6",
    id: "agent.jumpToThread.6",
    label: "Jump to Thread 6",
  },
  {
    category: "Agent",
    defaultShortcut: "Cmd+7",
    id: "agent.jumpToThread.7",
    label: "Jump to Thread 7",
  },
  {
    category: "Agent",
    defaultShortcut: "Cmd+8",
    id: "agent.jumpToThread.8",
    label: "Jump to Thread 8",
  },
  {
    category: "Agent",
    defaultShortcut: "Cmd+9",
    id: "agent.jumpToThread.9",
    label: "Jump to Thread 9",
  },
  {
    category: "Agent",
    defaultShortcut: "Cmd+Shift+K",
    id: "agent.searchThreads",
    label: "Search Threads",
  },
  {
    category: "Agent",
    defaultShortcut: "Cmd+F",
    id: "agent.findInThread",
    label: "Find in Thread",
  },
  {
    category: "Agent",
    defaultShortcut: "Cmd+Shift+O",
    id: "agent.goToTurn",
    label: "Go to Turn",
  },
  {
    category: "Agent",
    defaultShortcut: "Cmd+Alt+R",
    id: "agent.toggleRightPanel",
    label: "Toggle Right Panel",
  },
  {
    category: "Agent",
    defaultShortcut: "Cmd+B",
    id: "agent.toggleSidebar",
    label: "Toggle Sidebar",
  },
  {
    category: "Agent",
    defaultShortcut: "Cmd+Alt+F",
    id: "agent.openFilesSurface",
    label: "Show Files Surface",
  },
  {
    category: "Agent",
    defaultShortcut: "Cmd+Alt+D",
    id: "agent.openDiffSurface",
    label: "Show Diff Surface",
  },
  {
    category: "Agent",
    defaultShortcut: "Cmd+Alt+J",
    id: "agent.openTerminalSurface",
    label: "Show Terminal Surface",
  },
  {
    category: "Agent",
    defaultShortcut: "",
    id: "agent.runPreferredScript",
    label: "Run Thread Script",
  },
  {
    category: "Agent",
    defaultShortcut: "",
    id: "agent.openCommitMenu",
    label: "Commit Thread Changes",
  },
  {
    category: "Agent",
    defaultShortcut: "Cmd+Alt+V",
    id: "agent.toggleDictation",
    label: "Toggle Dictation",
  },
  {
    category: "Workbench",
    defaultShortcut: "",
    id: "project.add",
    label: "Add Project…",
  },
  {
    category: "Workbench",
    defaultShortcut: "Cmd+K",
    id: "palette.open",
    label: "Open Command Palette",
  },
  {
    category: "Workbench",
    defaultShortcut: "Cmd+/",
    id: "palette.shortcuts",
    label: "Keyboard Shortcuts",
  },
  {
    category: "Workbench",
    defaultShortcut: "",
    id: "panel.toggleMaximized",
    label: "Toggle Maximized Panel",
  },
] as const;

export type KeymapCommandId = (typeof keymapCommands)[number]["id"];
export type KeymapPlatform = "linux" | "mac" | "other" | "windows";
export type KeymapSettings = Record<KeymapCommandId, string>;

export function isKeymapCommandId(value: string): value is KeymapCommandId {
  return keymapCommands.some((command) => command.id === value);
}

const CLOSE_ACTIVE_COMMAND_ID = "workbench.closeActive" satisfies KeymapCommandId;
const LEGACY_CLOSE_TAB_COMMAND_ID = "editor.closeTab";

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

// The platform never changes within a session, yet `detectKeymapPlatform` is on
// the keydown hot path (every auto-repeat keydown runs ~35 shortcut matches,
// each of which would otherwise re-run these regexes against navigator fields).
// We memoize per navigator object identity: the hot path always resolves to the
// same global `navigator` singleton, so the regex work runs once per session.
// A distinct navigator object (e.g. a test fixture) recomputes, keeping the
// pure-input behaviour intact, and tests can force recomputation via reset.
const KEYMAP_PLATFORM_DEFAULT_KEY = Symbol("keymap-platform-default");
let cachedPlatformKey: KeymapNavigator | symbol | undefined;
let cachedPlatform: KeymapPlatform | undefined;

export function detectKeymapPlatform(
  navigatorLike: KeymapNavigator | undefined = typeof navigator === "undefined"
    ? undefined
    : navigator,
): KeymapPlatform {
  const cacheKey = navigatorLike ?? KEYMAP_PLATFORM_DEFAULT_KEY;

  if (cachedPlatform !== undefined && cachedPlatformKey === cacheKey) {
    return cachedPlatform;
  }

  const platform = computeKeymapPlatform(navigatorLike);
  cachedPlatformKey = cacheKey;
  cachedPlatform = platform;
  return platform;
}

/**
 * Clears the {@link detectKeymapPlatform} memo. Test-only: production never
 * changes platform mid-session, but tests swap navigator fixtures.
 */
export function __resetKeymapPlatformCacheForTests(): void {
  cachedPlatformKey = undefined;
  cachedPlatform = undefined;
}

function computeKeymapPlatform(navigatorLike: KeymapNavigator | undefined): KeymapPlatform {
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
    keymapCommands.map((command) => [command.id, defaultShortcutForCommand(command.id, platform)]),
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
  const persisted = withNewThreadPickerBindingMigrated(
    withCloseActiveBindingMigrated(value),
    platform,
  );

  for (const command of keymapCommands) {
    const shortcut = persisted[command.id];

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

export function withCloseActiveBindingMigrated(
  value: Record<string, unknown>,
): Record<string, unknown> {
  if (value[CLOSE_ACTIVE_COMMAND_ID] !== undefined) return value;
  const legacyShortcut = value[LEGACY_CLOSE_TAB_COMMAND_ID];
  if (legacyShortcut === undefined) return value;
  return { ...value, [CLOSE_ACTIVE_COMMAND_ID]: legacyShortcut };
}

function withNewThreadPickerBindingMigrated(
  value: Record<string, unknown>,
  platform: KeymapPlatform,
): Record<string, unknown> {
  if (value["agent.newThreadIn"] !== undefined) return value;
  const { "agent.newThread": pickerShortcut, ...rest } = value;
  if (pickerShortcut === undefined) return value;
  if (!isNewThreadDefaultShortcut(pickerShortcut, platform)) {
    return { ...rest, "agent.newThreadIn": pickerShortcut };
  }
  return { ...value, "agent.newThreadIn": restoredNewThreadPickerShortcut(value, platform) };
}

export function restoredNewThreadPickerShortcut(
  persisted: Record<string, unknown>,
  platform: KeymapPlatform,
): string {
  const pickerShortcut = defaultShortcutForCommand("agent.newThreadIn", platform);
  const pickerShortcutTaken = keymapCommands.some(({ id }) => {
    const value = persisted[id];
    if (id === "agent.newThreadIn" || typeof value !== "string") return false;
    const shortcut = normalizeShortcutSequenceInput(normalizeShortcutInput(value));
    return shortcutSequenceForPlatform(shortcut, platform) === pickerShortcut;
  });
  return pickerShortcutTaken ? "" : pickerShortcut;
}

export function isNewThreadDefaultShortcut(value: unknown, platform: KeymapPlatform): boolean {
  if (typeof value !== "string") return false;
  const shortcut = normalizeShortcutSequenceInput(normalizeShortcutInput(value));
  return (
    shortcut === defaultShortcutForCommand("agent.newThread", "mac") ||
    shortcut === defaultShortcutForCommand("agent.newThread", platform)
  );
}

export function shortcutForCommand(
  keymap: KeymapSettings,
  commandId: KeymapCommandId,
  platform: KeymapPlatform = detectKeymapPlatform(),
): string {
  const reboundShortcut = (keymap as Partial<Record<KeymapCommandId, string>>)[commandId];
  return reboundShortcut ?? defaultShortcutForCommand(commandId, platform);
}

export function keymapCommandIdForShortcut(
  keymap: KeymapSettings,
  shortcut: string,
  platform: KeymapPlatform = detectKeymapPlatform(),
): KeymapCommandId | null {
  return keymapCommandIdsForShortcut(keymap, shortcut, platform)[0] ?? null;
}

export function keymapCommandIdsForShortcut(
  keymap: KeymapSettings,
  shortcut: string,
  platform: KeymapPlatform = detectKeymapPlatform(),
): KeymapCommandId[] {
  const normalizedShortcut = normalizeShortcutInput(shortcut);
  if (!normalizedShortcut) {
    return [];
  }

  const matches: KeymapCommandId[] = [];
  const collected = new Set<KeymapCommandId>();

  for (let index = keymapCommands.length - 1; index >= 0; index -= 1) {
    const command = keymapCommands[index];
    if (!command || collected.has(command.id)) {
      continue;
    }

    collected.add(command.id);
    if (
      normalizeShortcutInput(shortcutForCommand(keymap, command.id, platform)) ===
      normalizedShortcut
    ) {
      matches.push(command.id);
    }
  }

  return matches;
}

export interface KeymapConflict {
  id: KeymapCommandId;
  label: string;
}

/**
 * Other commands whose *current* (possibly rebound) shortcut collides with
 * `commandId`'s. Rebinding to a colliding shortcut is still allowed (PhpStorm
 * and VS Code both allow it - the last-bound command simply wins at dispatch
 * time), so this is surfaced as a warning for the settings UI rather than a
 * blocker. An unbound ("") shortcut never conflicts with anything.
 */
export function findKeymapConflicts(
  keymap: KeymapSettings,
  commandId: KeymapCommandId,
  platform: KeymapPlatform = detectKeymapPlatform(),
): KeymapConflict[] {
  const shortcut = normalizeShortcutInput(shortcutForCommand(keymap, commandId, platform));

  if (!shortcut) {
    return [];
  }

  return keymapCommands
    .filter((command) => command.id !== commandId)
    .filter(
      (command) =>
        normalizeShortcutInput(shortcutForCommand(keymap, command.id, platform)) === shortcut,
    )
    .map((command) => ({ id: command.id, label: command.label }));
}

interface KeymapCaptureEvent {
  altKey: boolean;
  code?: string;
  ctrlKey: boolean;
  getModifierState?: (keyArg: "AltGraph") => boolean;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
}

const CAPTURE_MODIFIER_ONLY_KEYS = new Set(["Alt", "AltGraph", "Control", "Meta", "OS", "Shift"]);

/**
 * Builds a normalized shortcut string directly from a keydown event so the
 * keymap settings input can be driven by "press the keys" instead of typing
 * their names out (PhpStorm/VS Code keybinding editor convention). Returns
 * null when the event cannot stand alone as a shortcut:
 *
 * - a bare modifier tap (still waiting for the real key);
 * - a plain key with no modifier held (falls through to normal text typing);
 * - a Shift-only chord on a printable key or Tab - Shift is also how text is
 *   typed ("+", capital letters, "!") and how focus walks backwards
 *   (Shift+Tab), so Shift alone only captures non-printable keys such as
 *   Shift+F12.
 *
 * A chord whose key is "+" itself is captured as its "=" equivalent with the
 * event's real modifiers (Cmd+Shift+"+" becomes "Cmd+Shift+="): "+" is the
 * persisted format's delimiter and cannot be stored literally.
 */
export function shortcutFromKeyboardEvent(event: KeymapCaptureEvent): string | null {
  const hasStrongModifier = event.ctrlKey || event.altKey || event.metaKey;
  const key = shortcutKeyFromKeyboardEvent(event);

  if (!hasStrongModifier && !event.shiftKey) {
    return null;
  }

  if (CAPTURE_MODIFIER_ONLY_KEYS.has(key)) {
    return null;
  }

  if (!hasStrongModifier && (key.length === 1 || key === "Tab")) {
    return null;
  }

  const parts: string[] = [];

  if (event.metaKey) {
    parts.push("Cmd");
  }

  if (event.ctrlKey) {
    parts.push("Ctrl");
  }

  if (event.shiftKey) {
    parts.push("Shift");
  }

  if (event.altKey) {
    parts.push("Alt");
  }

  parts.push(key);

  return normalizeShortcutInput(parts.join("+"));
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
    normalizeKeyboardEventKey(shortcutKeyFromKeyboardEvent(event)) === parsed.key
  );
}

interface KeymapModifierEvent {
  altKey: boolean;
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
}

/**
 * Builds the set of normalized keys for keymap shortcuts that require NO
 * modifier at all (e.g. the F8 "Next Problem" and F2 "Rename Symbol"
 * defaults). These are the only fully bare events that can match a command, so
 * the keydown hot path can skip the ~35-iteration matching loop for any other
 * bare keystroke (held ArrowUp/ArrowDown, plain letters, etc.).
 *
 * A shortcut whose only modifier is Shift (e.g. `Shift+F8`) is NOT a bare-key
 * key here, because the corresponding event carries `shiftKey` and is therefore
 * treated as "has a modifier" by {@link eventCanMatchKeymapShortcut}, which
 * keeps the loop running for Shift-bearing events.
 */
export function collectBareKeyShortcutKeys(keymap: KeymapSettings): ReadonlySet<string> {
  const bareKeys = new Set<string>();

  for (const shortcut of Object.values(keymap)) {
    const parsed = parseShortcutSequence(shortcut)?.[0];

    if (!parsed) {
      continue;
    }

    if (parsed.meta || parsed.ctrl || parsed.alt || parsed.shift) {
      continue;
    }

    bareKeys.add(parsed.key);
  }

  return bareKeys;
}

/**
 * Cheap precondition for the keydown hot path: returns false when no keymap
 * shortcut could possibly match, so the caller can skip the full matching loop.
 *
 * An event can only match a shortcut when it either carries at least one
 * modifier (meta/ctrl/alt/shift), or its key is a registered bare-key command
 * key. Shift counts as a modifier here so the loop is never skipped on
 * Shift-bearing events (e.g. `Shift+F8`), keeping behaviour conservative.
 */
export function eventCanMatchKeymapShortcut(
  event: KeymapModifierEvent,
  bareKeyShortcutKeys: ReadonlySet<string>,
): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
    return true;
  }

  return bareKeyShortcutKeys.has(normalizeKeyboardEventKey(representableShortcutKey(event.key)));
}

export function parseShortcut(shortcut: string): ParsedShortcut | null {
  const sequence = parseShortcutSequence(shortcut);
  if (!sequence || sequence.length !== 1) {
    return null;
  }

  const [stroke] = sequence;

  return {
    alt: stroke.alt,
    ctrl: stroke.ctrl,
    key: stroke.key,
    meta: stroke.meta,
    shift: stroke.shift,
  };
}

export function normalizeShortcutInput(value: string): string {
  const parsedSequence = parseShortcutSequence(value);
  if (parsedSequence?.length === 2) {
    return normalizeShortcutSequenceInput(value);
  }

  // Preserve the original single-stroke input tolerance for settings already
  // persisted as e.g. "option + return". New sequence input uses strict
  // whitespace-separated strokes through normalizeShortcutSequenceInput.
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

function normalizeKeyboardEventKey(key: string): string {
  if (key.length === 1) {
    return key.toLowerCase();
  }

  return key.toLowerCase();
}

function shortcutForPlatform(shortcut: string, platform: KeymapPlatform): string {
  const parsedSequence = parseShortcutSequence(shortcut);
  if (parsedSequence?.length === 2) {
    return shortcutSequenceForPlatform(shortcut, platform);
  }

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
  return (globalThis as { process?: { platform?: string } }).process?.platform ?? "";
}
