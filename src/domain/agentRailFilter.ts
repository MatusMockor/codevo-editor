export type AgentRailFilter =
  { readonly kind: "all" } | { readonly kind: "project"; readonly projectRootKey: string };

export const ALL_PROJECTS_FILTER: AgentRailFilter = Object.freeze({ kind: "all" });
export const MAX_AGENT_RAIL_FILTER_KEY_CHARS = 4_096;

const MAX_PERSISTED_CHARS = MAX_AGENT_RAIL_FILTER_KEY_CHARS + 64;

export function serializeAgentRailFilter(filter: AgentRailFilter): string {
  switch (filter.kind) {
    case "all":
      return JSON.stringify({ kind: "all" });
    case "project":
      return JSON.stringify({ kind: "project", projectRootKey: filter.projectRootKey });
  }
}

export function parseAgentRailFilter(raw: string | null): AgentRailFilter {
  if (raw === null || raw === "" || raw.length > MAX_PERSISTED_CHARS) return ALL_PROJECTS_FILTER;
  const value = parseJson(raw);
  if (!isRecord(value)) return ALL_PROJECTS_FILTER;
  const keys = Object.keys(value).sort();
  if (value.kind === "all" && keys.length === 1) return ALL_PROJECTS_FILTER;
  if (value.kind !== "project") return ALL_PROJECTS_FILTER;
  if (keys.length !== 2 || keys[0] !== "kind" || keys[1] !== "projectRootKey") {
    return ALL_PROJECTS_FILTER;
  }
  const projectRootKey = value.projectRootKey;
  if (!validProjectRootKey(projectRootKey)) return ALL_PROJECTS_FILTER;
  return { kind: "project", projectRootKey };
}

function validProjectRootKey(value: unknown): value is string {
  return (
    typeof value === "string" && value !== "" && value.length <= MAX_AGENT_RAIL_FILTER_KEY_CHARS
  );
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
