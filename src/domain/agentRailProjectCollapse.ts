export const MAX_AGENT_RAIL_COLLAPSED_PROJECTS = 256;
export const MAX_AGENT_RAIL_PROJECT_KEY_CHARS = 4_096;

const MAX_PERSISTED_CHARS =
  MAX_AGENT_RAIL_COLLAPSED_PROJECTS * (MAX_AGENT_RAIL_PROJECT_KEY_CHARS + 4) + 64;

export type AgentRailCollapsedProjects = ReadonlyArray<string>;

export const NO_COLLAPSED_PROJECTS: AgentRailCollapsedProjects = Object.freeze([]);

export function serializeAgentRailCollapsedProjects(keys: AgentRailCollapsedProjects): string {
  return JSON.stringify({ collapsed: [...keys] });
}

export function parseAgentRailCollapsedProjects(raw: string | null): AgentRailCollapsedProjects {
  if (raw === null || raw === "" || raw.length > MAX_PERSISTED_CHARS) return NO_COLLAPSED_PROJECTS;
  const value = parseJson(raw);
  if (!isRecord(value)) return NO_COLLAPSED_PROJECTS;
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== "collapsed") return NO_COLLAPSED_PROJECTS;
  const collapsed = value.collapsed;
  if (!Array.isArray(collapsed)) return NO_COLLAPSED_PROJECTS;
  if (collapsed.length > MAX_AGENT_RAIL_COLLAPSED_PROJECTS) return NO_COLLAPSED_PROJECTS;
  if (!collapsed.every(validProjectKey)) return NO_COLLAPSED_PROJECTS;
  return [...new Set(collapsed)];
}

export function collapseAgentRailProject(
  keys: AgentRailCollapsedProjects,
  projectRootKey: string,
): AgentRailCollapsedProjects {
  if (!validProjectKey(projectRootKey) || keys.includes(projectRootKey)) return keys;
  const next = [...keys, projectRootKey];
  return next.slice(Math.max(0, next.length - MAX_AGENT_RAIL_COLLAPSED_PROJECTS));
}

export function expandAgentRailProject(
  keys: AgentRailCollapsedProjects,
  projectRootKey: string,
): AgentRailCollapsedProjects {
  if (!keys.includes(projectRootKey)) return keys;
  return keys.filter((key) => key !== projectRootKey);
}

function validProjectKey(value: unknown): value is string {
  return (
    typeof value === "string" && value !== "" && value.length <= MAX_AGENT_RAIL_PROJECT_KEY_CHARS
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
