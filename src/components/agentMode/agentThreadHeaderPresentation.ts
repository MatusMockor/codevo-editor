import type { AgentThreadView } from "../../application/agentThreadPorts";
import { agentShipStatus, type AgentShipAvailability } from "../../domain/agentShip";
import { defaultShortcutForCommand } from "../../domain/keymap";
import { agentShipAvailability, agentShipDefaultIntegrationMode } from "./agentModePresentation";

export type AgentShipQuickActionKind = "commit" | "push" | "integrate" | "none";

export interface AgentShipQuickAction {
  readonly kind: AgentShipQuickActionKind;
  readonly label: string;
  readonly availability: AgentShipAvailability;
}

export interface AgentPanelLayoutShortcuts {
  readonly bottomPanel: string;
  readonly rightPanel: string;
}

export interface AgentOpenTarget {
  readonly path: string;
  readonly missing: boolean;
}

export const AGENT_SHIP_NOTHING_LABEL = "Nothing to commit";
export const AGENT_SHIP_NOTHING_REASON = "There are no changes to commit, push or integrate.";
export const AGENT_OPEN_MISSING_REASON = "The worktree no longer exists";
export const AGENT_OPEN_NO_TARGET_REASON = "Select a thread first";
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

export function agentShipQuickAction(view: AgentThreadView): AgentShipQuickAction {
  const availability = agentShipAvailability(view);
  const status = agentShipStatus(view.ship);
  if (status === null)
    return { kind: "commit", label: "Commit", availability: availability.commit };
  const changes = status.worktree.changeCount;
  if (changes > 0) {
    const label = changes === 1 ? "Commit 1 file" : `Commit ${changes} files`;
    return { kind: "commit", label, availability: availability.commit };
  }
  const unpushed = status.remote?.upstream === null || (status.remote?.upstream?.ahead ?? 0) > 0;
  if (unpushed && availability.push.kind === "available") {
    return { kind: "push", label: "Push branch", availability: availability.push };
  }
  const worktree = view.thread.target.isolation === "worktree";
  const integrate =
    agentShipDefaultIntegrationMode(status) === "fastForward"
      ? availability.fastForward
      : availability.merge;
  if (worktree && integrate.kind === "available") {
    return { kind: "integrate", label: "Integrate", availability: integrate };
  }
  return {
    kind: "none",
    label: AGENT_SHIP_NOTHING_LABEL,
    availability: { kind: "blocked", reason: AGENT_SHIP_NOTHING_REASON },
  };
}

export function agentOpenBlockedReason(target: AgentOpenTarget | null): string | null {
  if (target === null) return AGENT_OPEN_NO_TARGET_REASON;
  if (target.missing) return AGENT_OPEN_MISSING_REASON;
  return null;
}

export function defaultAgentPanelLayoutShortcuts(): AgentPanelLayoutShortcuts {
  return {
    bottomPanel: defaultShortcutForCommand("panel.toggle"),
    rightPanel: defaultShortcutForCommand("agent.toggleRightPanel"),
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

export function agentRevealRootForPath(path: string, roots: ReadonlyArray<string>): string | null {
  if (path === "" || path.includes("\u0000")) return null;
  if (new TextEncoder().encode(path).length > MAX_AGENT_REVEAL_PATH_BYTES) return null;
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
