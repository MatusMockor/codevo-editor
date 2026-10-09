import {
  filterAgentModelRows,
  type AgentModelFilter,
  type AgentModelRow,
} from "./agentLaunchPresentation";

export interface AgentModelPickerSections {
  readonly current: ReadonlyArray<AgentModelRow>;
  readonly legacy: ReadonlyArray<AgentModelRow>;
}

export interface AgentModelPickerOpening {
  readonly legacyExpanded: boolean;
  readonly activeIndex: number;
}

const NO_FAVORITES: ReadonlySet<string> = new Set();

export function agentModelPickerSections(
  rows: ReadonlyArray<AgentModelRow>,
  filter: AgentModelFilter,
  favorites: ReadonlySet<string>,
  query: string,
): AgentModelPickerSections {
  const filtered = filterAgentModelRows(rows, filter, favorites, query);
  if (filter !== "all" || query.trim() !== "") return { current: filtered, legacy: [] };
  return {
    current: filtered.filter((row) => row.isLegacy !== true),
    legacy: filtered.filter((row) => row.isLegacy === true),
  };
}

export function agentModelPickerVisibleRows(
  sections: AgentModelPickerSections,
  legacyExpanded: boolean,
): ReadonlyArray<AgentModelRow> {
  if (!legacyExpanded) return sections.current;
  return [...sections.current, ...sections.legacy];
}

export function agentModelPickerOpening(
  rows: ReadonlyArray<AgentModelRow>,
  selectedModel: string,
): AgentModelPickerOpening {
  const sections = agentModelPickerSections(rows, "all", NO_FAVORITES, "");
  const legacyExpanded = sections.legacy.some((row) => row.value === selectedModel);
  const visible = agentModelPickerVisibleRows(sections, legacyExpanded);
  return {
    legacyExpanded,
    activeIndex: Math.max(
      0,
      visible.findIndex((row) => row.value === selectedModel),
    ),
  };
}
