import { createContext, useMemo } from "react";
import { useRemoteRunnerContext } from "../remoteRunner/remoteRunnerContext";

export type AgentRowServerNames = ReadonlyMap<string, string>;

const NO_SERVER_NAMES: AgentRowServerNames = new Map();

export const AgentRowServerNamesContext = createContext<AgentRowServerNames>(NO_SERVER_NAMES);

export function useAgentRowServerNames(): AgentRowServerNames {
  const servers = useRemoteRunnerContext()?.servers;
  return useMemo(
    () =>
      servers === undefined
        ? NO_SERVER_NAMES
        : new Map(servers.map((server) => [server.id, server.name])),
    [servers],
  );
}
