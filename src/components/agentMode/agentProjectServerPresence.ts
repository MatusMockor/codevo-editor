import { remoteAgentProjectServerId } from "../../application/remoteAgentProjection";
import type { AgentProjectGroup } from "./agentModePresentation";

const MAX_PROJECT_SERVER_BADGE_NAMES = 3;
const UNKNOWN_PROJECT_SERVER_NAME = "server";

const REMOTE_PROJECT_KEY_PREFIX = "remote:";

export interface AgentProjectServerPresence {
  readonly local: boolean;
  readonly remoteServerIds: ReadonlyArray<string>;
}

export function agentProjectServerPresence(
  group: Pick<AgentProjectGroup, "memberProjectRootKeys" | "projectRootKey" | "repos">,
): AgentProjectServerPresence {
  const memberKeys = group.memberProjectRootKeys ?? [group.projectRootKey];
  const serverIds = new Set<string>();
  for (const key of memberKeys) {
    const serverId = remoteAgentProjectServerId(key);
    if (serverId !== null) serverIds.add(serverId);
  }
  for (const repo of group.repos) {
    for (const view of repo.threads) {
      if (view.execution?.kind === "remote") serverIds.add(view.execution.serverId);
    }
  }
  return {
    local: memberKeys.some((key) => !key.startsWith(REMOTE_PROJECT_KEY_PREFIX)),
    remoteServerIds: [...serverIds].sort(compareCodeUnits),
  };
}

export function agentProjectServerBadgeLabel(
  presence: AgentProjectServerPresence,
  serverNames: ReadonlyMap<string, string>,
): string | null {
  if (serverNames.size === 0 || presence.remoteServerIds.length === 0) return null;
  const names = [
    ...new Set(presence.remoteServerIds.map((id) => serverDisplayName(serverNames, id))),
  ].sort(compareNames);
  const shown = names.slice(0, MAX_PROJECT_SERVER_BADGE_NAMES);
  const hidden = names.length - shown.length;
  const list = hidden > 0 ? `${shown.join(", ")} +${hidden} more` : shown.join(", ");
  return `${presence.local ? "Also on" : "On"} ${list}`;
}

function serverDisplayName(serverNames: ReadonlyMap<string, string>, serverId: string): string {
  const name = serverNames.get(serverId)?.trim() ?? "";
  return name === "" ? UNKNOWN_PROJECT_SERVER_NAME : name;
}

function compareNames(left: string, right: string): number {
  return left.localeCompare(right, "en", { sensitivity: "base" }) || compareCodeUnits(left, right);
}

function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
