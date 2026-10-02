import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import type { AgentTasksNotice, AgentThreadView } from "../../application/agentThreadPorts";
import {
  remotePortPreviewAuthority,
  type RemotePortPreviewTarget,
} from "../../application/remotePortPreviewState";
import {
  useRemotePortPreview,
  type RemotePortOpenOptions,
  type RemotePortPreviewSurface,
} from "../../application/useRemotePortPreview";
import { runningTurn } from "../../domain/agentThread";
import type { RemoteRunnerServer } from "../../domain/remoteRunner";
import {
  serverLoopbackTitle,
  type ServerLoopbackPorts,
  type ServerLoopbackTitle,
} from "../../domain/remoteLoopbackLink";
import type { RemoteLoopbackScheme, RemotePortPreviewPort } from "../../domain/remotePortPreview";
import {
  isRemotePortOwnerGeneration,
  isRemotePortOwnerId,
  type RemotePortOwner,
} from "../../domain/remotePortPreviewWire";
import type { TextClipboardGateway } from "../../domain/textClipboard";
import type { AgentServerLoopbackPort } from "./agentMarkdownLinks";
import {
  createAgentServerLoopbackPort,
  type AgentServerLoopbackSnapshot,
} from "./agentServerLoopbackPort";

export type AgentRemotePortPreviewWiring = Readonly<{
  port: RemotePortPreviewPort;
  owner: RemotePortOwner | null;
}>;

export type AgentServerPortsMenu = Readonly<{
  server: string;
  surface: RemotePortPreviewSurface;
  clipboard: TextClipboardGateway | null;
  schemeOf(port: number): RemoteLoopbackScheme;
}>;

export type AgentServerPorts = Readonly<{
  menu: AgentServerPortsMenu | null;
  serverLoopback: AgentServerLoopbackPort;
}>;

export type AgentServerPortsInput = Readonly<{
  wiring: AgentRemotePortPreviewWiring | null;
  servers: readonly RemoteRunnerServer[];
  thread: AgentThreadView | null;
  terminalOpen: boolean;
  clipboard: TextClipboardGateway | null;
  reportNotice(notice: AgentTasksNotice): void;
}>;

const INERT_PORT: RemotePortPreviewPort = {
  list: () => Promise.reject(new Error("Server ports are not available.")),
  open: () => Promise.reject(new Error("Server ports are not available.")),
  close: async () => undefined,
  releaseOwner: async () => undefined,
};

export function agentRemotePortOwner(
  workspaceId: string | null | undefined,
  admissionToken: number | null | undefined,
): RemotePortOwner | null {
  if (!isRemotePortOwnerId(workspaceId)) return null;
  if (!isRemotePortOwnerGeneration(admissionToken)) return null;
  return { ownerId: workspaceId as string, ownerGeneration: admissionToken as number };
}

const PORTS_NOT_WIRED = "Opening server ports is not available here.";
const SERVER_DRAFT_REASON =
  "This link points to localhost on the server. Open it after the conversation starts.";

const noTaskReason = (server: string) =>
  `This conversation has no task on ${server} yet. Open the link after it runs.`;

type PortsReadiness = Readonly<{
  server: string;
  connected: boolean;
  wired: boolean;
  owner: RemotePortOwner | null;
  target: RemotePortPreviewTarget | null;
}>;

function unavailableReason(readiness: PortsReadiness): string {
  if (!readiness.connected) return `Reconnect to ${readiness.server} to open its ports.`;
  if (!readiness.wired) return PORTS_NOT_WIRED;
  if (readiness.owner === null) return "Open a workspace on this computer to forward server ports.";
  if (readiness.target === null) return noTaskReason(readiness.server);
  return PORTS_NOT_WIRED;
}

function loopbackPorts(
  listed: ReadonlySet<number> | null,
  ready: boolean,
  unsupported: boolean,
  reason: string,
): ServerLoopbackPorts {
  if (unsupported) return { kind: "unsupported" };
  if (!ready) return { kind: "unavailable", reason };
  if (listed === null) return { kind: "unlisted" };
  return { kind: "listed", ports: listed };
}

function useServerLoopbackGeneration(key: string | null): number {
  const state = useRef({ key, generation: 0 });
  if (state.current.key !== key) state.current = { key, generation: state.current.generation + 1 };
  return state.current.generation;
}

export function useAgentServerPorts(input: AgentServerPortsInput): AgentServerPorts {
  const { clipboard, reportNotice, thread, wiring } = input;
  const execution = thread?.execution?.kind === "remote" ? thread.execution : null;
  const serverId = execution?.serverId ?? null;
  const runnerId = execution?.runnerId ?? null;
  const taskId =
    execution === null || execution.latestTaskId === "" ? null : execution.latestTaskId;
  const server = input.servers.find((entry) => entry.id === serverId) ?? null;
  const serverLabel = server?.name ?? "the server";
  const connected = server?.connected === true;
  const supported = execution?.portPreview === true;
  const owner = wiring?.owner ?? null;
  const target = useMemo<RemotePortPreviewTarget | null>(
    () =>
      serverId === null || runnerId === null || taskId === null
        ? null
        : { serverId, runnerId, scope: { kind: "task", taskId } },
    [runnerId, serverId, taskId],
  );
  const ready = wiring !== null && connected && supported && owner !== null && target !== null;
  const turnActive = thread !== null && runningTurn(thread.thread) !== null;
  const port = wiring?.port ?? INERT_PORT;
  const surface = useRemotePortPreview({
    port,
    enabled: ready,
    owner,
    target,
    activity: { turnActive, terminalOpen: input.terminalOpen },
  });
  const authority = remotePortPreviewAuthority(ready, owner, target);
  const generation = useServerLoopbackGeneration(
    execution === null ? null : JSON.stringify([authority?.key ?? null, thread?.thread.threadId]),
  );
  const listedPorts = surface.status === "ready" ? surface.ports : null;
  const listed = useMemo(
    () => (listedPorts === null ? null : new Set(listedPorts.map((entry) => entry.port))),
    [listedPorts],
  );

  const ports: ServerLoopbackPorts =
    execution === null
      ? { kind: "unavailable", reason: SERVER_DRAFT_REASON }
      : loopbackPorts(
          listed,
          ready,
          wiring !== null && connected && !supported,
          unavailableReason({
            server: serverLabel,
            connected,
            wired: wiring !== null,
            owner,
            target,
          }),
        );
  const titleKey = JSON.stringify(serverLoopbackTitle(ports, serverLabel));
  const title = useMemo(() => JSON.parse(titleKey) as ServerLoopbackTitle, [titleKey]);
  const snapshot: AgentServerLoopbackSnapshot = {
    generation,
    server: serverLabel,
    ports,
    request: authority?.request ?? null,
    port,
  };
  const latest = useRef(snapshot);
  useLayoutEffect(() => {
    latest.current = snapshot;
  });

  const schemes = useRef(new Map<number, RemoteLoopbackScheme>());
  const schemeGeneration = useRef(generation);
  if (schemeGeneration.current !== generation) {
    schemeGeneration.current = generation;
    schemes.current = new Map();
  }
  const { open } = surface;
  const openRemembering = useCallback(
    (portNumber: number, options: RemotePortOpenOptions) => {
      if (options.scheme !== undefined) schemes.current.set(portNumber, options.scheme);
      return open(portNumber, options);
    },
    [open],
  );
  const schemeOf = useCallback(
    (portNumber: number): RemoteLoopbackScheme => schemes.current.get(portNumber) ?? "http",
    [],
  );
  const serverLoopback = useMemo(
    () =>
      createAgentServerLoopbackPort({
        title,
        snapshot: () => latest.current,
        open: openRemembering,
        report: reportNotice,
      }),
    [openRemembering, reportNotice, title],
  );

  const menu = useMemo<AgentServerPortsMenu | null>(
    () => (ready && target !== null ? { server: serverLabel, surface, clipboard, schemeOf } : null),
    [clipboard, ready, schemeOf, serverLabel, surface, target],
  );
  return useMemo(() => ({ menu, serverLoopback }), [menu, serverLoopback]);
}
