import type { AgentCommandCatalog } from "./agentCommandCatalog";
import {
  agentComposerCommands,
  type AgentComposerCommand,
  type AgentComposerCommandToken,
  type AgentComposerMenuItem,
  type AgentComposerProviderEntry,
} from "./agentComposerCommand";
import type { AgentCliKind } from "./agentTask";

export const MAX_AGENT_COMPOSER_MENU_ROWS = 50;

interface AgentComposerMenuCandidate {
  readonly item: AgentComposerMenuItem;
  readonly name: string;
  readonly label: string;
  readonly description: string;
}

type ProviderCandidate = AgentComposerMenuCandidate & {
  readonly item: AgentComposerProviderEntry;
};

export interface AgentComposerMenu {
  readonly candidates: ReadonlyArray<AgentComposerMenuCandidate>;
  readonly truncated: boolean;
}

export interface AgentComposerMenuView {
  readonly rows: ReadonlyArray<AgentComposerMenuItem>;
  readonly matched: number;
  readonly incomplete: boolean;
}

export const EMPTY_AGENT_COMPOSER_MENU_VIEW: AgentComposerMenuView = Object.freeze({
  rows: Object.freeze([]),
  matched: 0,
  incomplete: false,
});

const HIDDEN_NAME_PREFIX = "__";
const SEGMENT_BOUNDARIES = ":-_.";
const TIER_COUNT = 5;

export function agentComposerMenu(
  provider: AgentCliKind,
  followUp: boolean,
  catalog: AgentCommandCatalog | null,
): AgentComposerMenu {
  const builtins = agentComposerCommands(provider, followUp);
  if (catalog === null || catalog.provider !== provider)
    return Object.freeze({
      candidates: Object.freeze(builtins.map(builtinCandidate)),
      truncated: false,
    });
  const reserved = new Set<string>(builtins.map((command) => command.id));
  const entries = catalog.entries
    .map(providerCandidate)
    .filter(
      (candidate) =>
        !reserved.has(candidate.name) && !candidate.item.name.startsWith(HIDDEN_NAME_PREFIX),
    )
    .sort(compareProviderCandidates);
  return Object.freeze({
    candidates: Object.freeze([...builtins.map(builtinCandidate), ...entries]),
    truncated: catalog.truncated,
  });
}

export function rankAgentComposerMenu(
  menu: AgentComposerMenu,
  token: AgentComposerCommandToken,
  limit = MAX_AGENT_COMPOSER_MENU_ROWS,
): AgentComposerMenuView {
  if (token.terminated) return exactBuiltinView(menu, token.query);
  const query = token.query.toLowerCase();
  const tiers: ReadonlyArray<Array<AgentComposerMenuItem>> = Array.from(
    { length: TIER_COUNT },
    () => [],
  );
  for (const candidate of menu.candidates) {
    const tier = candidateTier(candidate, query);
    if (tier === null) continue;
    tiers[tier]?.push(candidate.item);
  }
  const matches = tiers.flat();
  return Object.freeze({
    rows: Object.freeze(matches.slice(0, Math.max(0, limit))),
    matched: matches.length,
    incomplete: menu.truncated,
  });
}

export function agentComposerMenuNotice(view: AgentComposerMenuView): string | null {
  const capped = view.matched > view.rows.length;
  if (capped && view.incomplete)
    return `Showing ${view.rows.length} of ${view.matched} or more. Keep typing to narrow.`;
  if (capped) return `Showing ${view.rows.length} of ${view.matched}. Keep typing to narrow.`;
  if (view.incomplete) return "Some commands are not listed. Type the full name to use one.";
  return null;
}

function exactBuiltinView(menu: AgentComposerMenu, query: string): AgentComposerMenuView {
  const rows = menu.candidates
    .filter((candidate) => candidate.item.kind === "builtin" && candidate.name === query)
    .map((candidate) => candidate.item);
  return Object.freeze({ rows: Object.freeze(rows), matched: rows.length, incomplete: false });
}

function candidateTier(candidate: AgentComposerMenuCandidate, query: string): number | null {
  const tier = nameTier(candidate.name, query);
  if (tier !== null) return tier;
  if (candidate.label.includes(query)) return 3;
  if (candidate.description.includes(query)) return 4;
  return null;
}

function nameTier(name: string, query: string): number | null {
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  let index = name.indexOf(query, 1);
  if (index === -1) return null;
  while (index !== -1) {
    if (SEGMENT_BOUNDARIES.includes(name.charAt(index - 1))) return 2;
    index = name.indexOf(query, index + 1);
  }
  return 3;
}

function builtinCandidate(command: AgentComposerCommand): AgentComposerMenuCandidate {
  return Object.freeze({
    item: command,
    name: command.id,
    label: command.label.toLowerCase(),
    description: "",
  });
}

function providerCandidate(entry: AgentComposerProviderEntry): ProviderCandidate {
  return Object.freeze({
    item: entry,
    name: entry.name.toLowerCase(),
    label: entry.label?.toLowerCase() ?? "",
    description: entry.description?.toLowerCase() ?? "",
  });
}

function compareProviderCandidates(left: ProviderCandidate, right: ProviderCandidate): number {
  if (left.item.builtin !== right.item.builtin) return left.item.builtin ? 1 : -1;
  if (left.name !== right.name) return left.name < right.name ? -1 : 1;
  if (left.item.name === right.item.name) return 0;
  return left.item.name < right.item.name ? -1 : 1;
}
