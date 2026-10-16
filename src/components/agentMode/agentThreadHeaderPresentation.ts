import { defaultShortcutForCommand } from "../../domain/keymap";

export interface AgentPanelLayoutShortcuts {
  readonly bottomPanel: string;
  readonly rightPanel: string;
  readonly sidebar: string;
  readonly newThread: string;
  readonly newThreadIn?: string;
}

export interface AgentOpenTarget {
  readonly path: string;
  readonly missing: boolean;
  readonly blockedReason?: string | null;
}

export const AGENT_OPEN_REMOTE_REASON =
  "Opening server files and terminals here is not available yet";
export const AGENT_OPEN_MISSING_REASON = "The worktree no longer exists";
export const AGENT_OPEN_NO_TARGET_REASON = "Select a thread first";
export const AGENT_TERMINAL_SESSIONS_LABEL = "Terminal sessions";
export const AGENT_SCRIPT_NONE_LABEL = "No scripts";
export const AGENT_SCRIPT_ELSEWHERE_SUFFIX = "(running elsewhere)";
export const AGENT_REVEAL_BLOCKED_REASON = "That path is outside the agent project roots.";
export const MAX_AGENT_REVEAL_PATH_BYTES = 4096;

const GLYPHS: ReadonlyMap<string, string> = new Map([
  ["cmd", "⌘"],
  ["meta", "⌘"],
  ["ctrl", "⌃"],
  ["control", "⌃"],
  ["alt", "⌥"],
  ["option", "⌥"],
  ["shift", "⇧"],
  ["enter", "↩"],
  ["escape", "⎋"],
]);
const GLYPH_ORDER: ReadonlyArray<string> = ["⌃", "⌥", "⇧", "⌘"];

export function agentOpenBlockedReason(target: AgentOpenTarget | null): string | null {
  if (target === null) return AGENT_OPEN_NO_TARGET_REASON;
  if (target.blockedReason) return target.blockedReason;
  if (target.missing) return AGENT_OPEN_MISSING_REASON;
  return null;
}

export function defaultAgentPanelLayoutShortcuts(): AgentPanelLayoutShortcuts {
  return {
    bottomPanel: defaultShortcutForCommand("panel.toggle"),
    rightPanel: defaultShortcutForCommand("agent.toggleRightPanel"),
    sidebar: defaultShortcutForCommand("agent.toggleSidebar"),
    newThread: defaultShortcutForCommand("agent.newThread"),
    newThreadIn: defaultShortcutForCommand("agent.newThreadIn"),
  };
}

export function agentShortcutGlyphs(shortcut: string): string {
  const parts = shortcut
    .split("+")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  if (parts.length === 0) return "";
  const modifiers = parts
    .slice(0, -1)
    .map((part) => GLYPHS.get(part.toLowerCase()) ?? part)
    .sort((left, right) => glyphRank(left) - glyphRank(right));
  const key = parts[parts.length - 1] ?? "";
  const keyGlyph = GLYPHS.get(key.toLowerCase()) ?? key.toUpperCase();
  return `${modifiers.join("")}${keyGlyph}`;
}

export function agentControlTooltip(label: string, shortcut: string): string {
  const glyphs = agentShortcutGlyphs(shortcut);
  if (glyphs === "") return label;
  return `${label} (${glyphs})`;
}

export function isAgentRevealPathBounded(path: string): boolean {
  if (path === "" || path.includes("\u0000")) return false;
  return new TextEncoder().encode(path).length <= MAX_AGENT_REVEAL_PATH_BYTES;
}

export function agentRevealRootForPath(path: string, roots: ReadonlyArray<string>): string | null {
  if (!isAgentRevealPathBounded(path)) return null;
  const candidate = normalizeRevealPath(path);
  const matches = roots
    .map(normalizeRevealPath)
    .filter((root) => root !== "" && (candidate === root || candidate.startsWith(`${root}/`)));
  return matches.reduce<string | null>(
    (longest, root) => (longest === null || root.length > longest.length ? root : longest),
    null,
  );
}

function normalizeRevealPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "");
}

function glyphRank(glyph: string): number {
  const index = GLYPH_ORDER.indexOf(glyph);
  return index < 0 ? GLYPH_ORDER.length : index;
}
