import { workspaceRelativePath } from "../workspace";

export const MAX_AGENT_LINKED_FILE_BASENAME_CANDIDATES = 200;

export interface AgentLinkedFileCandidate {
  readonly path: string;
}

export interface AgentLinkedFileSearchResults {
  readonly results: ReadonlyArray<AgentLinkedFileCandidate>;
  readonly truncated: boolean;
}

interface PlacedCandidate {
  readonly path: string;
  readonly name: string;
}

export function agentLinkedFileBasename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function agentLinkedFileBasenameMatch(
  name: string,
  root: string,
  search: AgentLinkedFileSearchResults,
): string | null {
  if (name === "" || name.includes("/")) return null;
  if (search.truncated) return null;
  if (search.results.length > MAX_AGENT_LINKED_FILE_BASENAME_CANDIDATES) return null;
  const placed = search.results.flatMap((candidate) => placedCandidate(candidate, root));
  const folded = name.toLowerCase();
  const foldedMatches = placed.filter((candidate) => candidate.name.toLowerCase() === folded);
  const exact = foldedMatches.filter((candidate) => candidate.name === name);
  if (exact.length > 0) return onlyPath(exact);
  return onlyPath(foldedMatches);
}

function placedCandidate(
  candidate: AgentLinkedFileCandidate,
  root: string,
): ReadonlyArray<PlacedCandidate> {
  const relative = workspaceRelativePath(root, candidate.path);
  if (relative === null) return [];
  const segments = relative.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return [];
  }
  return [{ path: candidate.path, name: agentLinkedFileBasename(relative) }];
}

function onlyPath(matches: ReadonlyArray<PlacedCandidate>): string | null {
  if (matches.length !== 1) return null;
  return matches[0]?.path ?? null;
}
