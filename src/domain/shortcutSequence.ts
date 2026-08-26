export type ShortcutPlatform = "linux" | "mac" | "other" | "windows";

export interface ShortcutStroke {
  readonly alt: boolean;
  readonly ctrl: boolean;
  readonly key: string;
  readonly meta: boolean;
  readonly shift: boolean;
  readonly value: string;
}

export type ShortcutSequence =
  readonly [ShortcutStroke] | readonly [ShortcutStroke, ShortcutStroke];

export interface ShortcutEvent {
  readonly altKey: boolean;
  readonly code?: string;
  readonly ctrlKey: boolean;
  readonly getModifierState?: (keyArg: "AltGraph") => boolean;
  readonly key: string;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}

export function shortcutKeyFromKeyboardEvent(
  event: Pick<ShortcutEvent, "altKey" | "code" | "getModifierState" | "key">,
): string {
  if (!event.altKey) return event.key === " " ? "Space" : event.key;
  if (event.getModifierState?.("AltGraph")) return event.key === " " ? "Space" : event.key;
  if (/^[A-Za-z]$/u.test(event.key)) {
    return event.key === " " ? "Space" : event.key;
  }
  const codeMatch = /^Key([A-Z])$/u.exec(event.code ?? "");
  if (!codeMatch) return event.key === " " ? "Space" : event.key;
  return codeMatch[1] ?? event.key;
}

export interface ShortcutSequenceLookup<CommandId extends string = string> {
  readonly exact: readonly CommandId[];
  readonly prefix: readonly CommandId[];
}

export interface ShortcutSequenceConflict<CommandId extends string = string> {
  readonly id: CommandId;
  readonly kind: "exact" | "prefix";
}

const MODIFIER_ALIASES = new Map<string, "Alt" | "Cmd" | "Ctrl" | "Shift">([
  ["alt", "Alt"],
  ["option", "Alt"],
  ["cmd", "Cmd"],
  ["command", "Cmd"],
  ["meta", "Cmd"],
  ["control", "Ctrl"],
  ["ctrl", "Ctrl"],
  ["shift", "Shift"],
]);

const MODIFIER_ORDER = ["Cmd", "Ctrl", "Shift", "Alt"] as const;
const NAMED_KEY_ALIASES = new Map<string, string>([
  ["esc", "Escape"],
  ["escape", "Escape"],
  ["return", "Enter"],
  ["enter", "Enter"],
  ["space", "Space"],
  ["spacebar", "Space"],
]);

/** Parse one shortcut stroke, rejecting ambiguous or lossy persisted input. */
export function parseShortcutStroke(value: string): ShortcutStroke | null {
  if (value.length > 96) return null;
  const rawParts = value.trim().split("+");
  if (rawParts.some((part) => part.trim() === "") || rawParts.length > 5) {
    return null;
  }

  const parts = rawParts.map((part) => part.trim());
  const rawKey = parts[parts.length - 1];
  if (!rawKey || isModifier(rawKey)) {
    return null;
  }

  const modifiers = new Set<"Alt" | "Cmd" | "Ctrl" | "Shift">();
  for (const rawModifier of parts.slice(0, -1)) {
    const modifier = MODIFIER_ALIASES.get(rawModifier.toLowerCase());
    if (!modifier || modifiers.has(modifier)) {
      return null;
    }
    modifiers.add(modifier);
  }

  const key = normalizeKey(rawKey);
  if (!key) {
    return null;
  }

  const normalizedParts: string[] = MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier));
  normalizedParts.push(key);

  return Object.freeze({
    alt: modifiers.has("Alt"),
    ctrl: modifiers.has("Ctrl"),
    key: comparableKey(key),
    meta: modifiers.has("Cmd"),
    shift: modifiers.has("Shift"),
    value: normalizedParts.join("+"),
  });
}

export function normalizeShortcutStrokeInput(value: string): string {
  return parseShortcutStroke(value)?.value ?? "";
}

/**
 * Parse the persisted keybinding representation: one or two strokes separated
 * by whitespace. The canonical representation uses exactly one ASCII space.
 */
export function parseShortcutSequence(value: string): ShortcutSequence | null {
  if (value.length > 193) return null;
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const strokeInputs = trimmed.split(/\s+/u);
  if (strokeInputs.length < 1 || strokeInputs.length > 2) {
    return null;
  }

  const strokes = strokeInputs.map(parseShortcutStroke);
  if (strokes.some((stroke) => stroke === null)) {
    return null;
  }

  return Object.freeze(strokes) as ShortcutSequence;
}

export function normalizeShortcutSequenceInput(value: string): string {
  return (
    parseShortcutSequence(value)
      ?.map((stroke) => stroke.value)
      .join(" ") ?? ""
  );
}

export function shortcutSequenceForPlatform(value: string, platform: ShortcutPlatform): string {
  const sequence = parseShortcutSequence(value);
  if (!sequence) {
    return "";
  }

  if (platform === "mac") {
    return sequence.map((stroke) => stroke.value).join(" ");
  }

  return sequence
    .map((stroke) => {
      const modifiers = new Set<"Alt" | "Cmd" | "Ctrl" | "Shift">();
      if (stroke.meta || stroke.ctrl) modifiers.add("Ctrl");
      if (stroke.shift) modifiers.add("Shift");
      if (stroke.alt) modifiers.add("Alt");
      return [
        ...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)),
        displayKey(stroke.key),
      ].join("+");
    })
    .join(" ");
}

export function shortcutStrokeFromKeyboardEvent(event: ShortcutEvent): ShortcutStroke | null {
  const key = shortcutKeyFromKeyboardEvent(event);
  if (isModifier(key) || key === "+") {
    return null;
  }

  const parts: string[] = [];
  if (event.metaKey) parts.push("Cmd");
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.shiftKey) parts.push("Shift");
  if (event.altKey) parts.push("Alt");
  parts.push(key);
  return parseShortcutStroke(parts.join("+"));
}

export function matchesShortcutStroke(
  event: ShortcutEvent,
  stroke: ShortcutStroke,
  platform: ShortcutPlatform,
): boolean {
  const primaryOnNonMac = stroke.meta && platform !== "mac";
  return (
    event.metaKey === (stroke.meta && !primaryOnNonMac) &&
    event.ctrlKey === (stroke.ctrl || primaryOnNonMac) &&
    event.altKey === stroke.alt &&
    event.shiftKey === stroke.shift &&
    comparableKey(shortcutKeyFromKeyboardEvent(event)) === stroke.key
  );
}

export function lookupKeymapShortcutSequence<CommandId extends string>(
  keymap: Readonly<Record<CommandId, string>>,
  input: string | ShortcutSequence,
  commandOrder: readonly CommandId[] = Object.keys(keymap) as CommandId[],
  platform?: ShortcutPlatform,
): ShortcutSequenceLookup<CommandId> {
  const parsedQuery = typeof input === "string" ? parseShortcutSequence(input) : input;
  const query = parsedQuery && sequenceForLookupPlatform(parsedQuery, platform);
  if (!query) {
    return { exact: [], prefix: [] };
  }

  const queryValue = sequenceValue(query);
  const exact: CommandId[] = [];
  const prefix: CommandId[] = [];
  const seen = new Set<CommandId>();

  for (let index = commandOrder.length - 1; index >= 0; index -= 1) {
    const id = commandOrder[index];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const parsedCandidate = parseShortcutSequence(keymap[id] ?? "");
    const candidate = parsedCandidate && sequenceForLookupPlatform(parsedCandidate, platform);
    if (!candidate) continue;

    const candidateValue = sequenceValue(candidate);
    if (candidateValue === queryValue) {
      exact.push(id);
    } else if (isSequencePrefix(query, candidate)) {
      prefix.push(id);
    }
  }

  return { exact, prefix };
}

export function findKeymapSequenceConflicts<CommandId extends string>(
  keymap: Readonly<Record<CommandId, string>>,
  commandId: CommandId,
  platform?: ShortcutPlatform,
): ShortcutSequenceConflict<CommandId>[] {
  const parsedTarget = parseShortcutSequence(keymap[commandId] ?? "");
  const target = parsedTarget && sequenceForLookupPlatform(parsedTarget, platform);
  if (!target) return [];

  const conflicts: ShortcutSequenceConflict<CommandId>[] = [];
  for (const [candidateId, value] of Object.entries<string>(keymap)) {
    if (candidateId === commandId) continue;
    const parsedCandidate = parseShortcutSequence(value);
    const candidate = parsedCandidate && sequenceForLookupPlatform(parsedCandidate, platform);
    if (!candidate) continue;
    if (sequenceValue(candidate) === sequenceValue(target)) {
      conflicts.push({ id: candidateId as CommandId, kind: "exact" });
    } else if (isSequencePrefix(target, candidate) || isSequencePrefix(candidate, target)) {
      conflicts.push({ id: candidateId as CommandId, kind: "prefix" });
    }
  }
  return conflicts;
}

function isSequencePrefix(prefix: ShortcutSequence, sequence: ShortcutSequence): boolean {
  return prefix.length === 1 && sequence.length === 2 && prefix[0].value === sequence[0].value;
}

function sequenceValue(sequence: ShortcutSequence): string {
  return sequence.map((stroke) => stroke.value).join(" ");
}

function sequenceForLookupPlatform(
  sequence: ShortcutSequence,
  platform: ShortcutPlatform | undefined,
): ShortcutSequence | null {
  if (!platform) return sequence;
  return parseShortcutSequence(shortcutSequenceForPlatform(sequenceValue(sequence), platform));
}

function isModifier(value: string): boolean {
  return MODIFIER_ALIASES.has(value.toLowerCase());
}

function normalizeKey(value: string): string | null {
  if (/\p{C}|\p{Z}/u.test(value) || value.includes("+") || value.length === 0) return null;
  const lower = value.toLowerCase();
  const alias = NAMED_KEY_ALIASES.get(lower);
  if (alias) return alias;
  if (/^[a-z]$/u.test(lower)) return lower.toUpperCase();
  if (/^f(?:[1-9]|1\d|2[0-4])$/u.test(lower)) return lower.toUpperCase();
  if (lower.startsWith("arrow") && /^(?:arrow)(?:up|down|left|right)$/u.test(lower)) {
    return `Arrow${lower.slice(5, 6).toUpperCase()}${lower.slice(6)}`;
  }
  if (value.length === 1 || /^[A-Za-z][A-Za-z0-9]*$/u.test(value)) return value;
  return null;
}

function comparableKey(value: string): string {
  return value.toLowerCase();
}

function displayKey(value: string): string {
  const normalized = normalizeKey(value);
  return normalized ?? value;
}
