import type { AgentTasksNotice } from "../../application/agentThreadPorts";
import type {
  RemotePortOpenOptions,
  RemotePortOpenResult,
} from "../../application/useRemotePortPreview";
import {
  serverLoopbackDecision,
  serverLoopbackLinkTitle,
  verifiedServerLoopbackDecision,
  type ServerLoopbackDecision,
  type ServerLoopbackPorts,
} from "../../domain/remoteLoopbackLink";
import { remotePortErrorMessage, type RemotePortPreviewPort } from "../../domain/remotePortPreview";
import type { RemotePortListRequest } from "../../domain/remotePortPreviewWire";
import type { AgentServerLoopbackPort } from "./agentMarkdownLinks";

export type AgentServerLoopbackSnapshot = Readonly<{
  generation: number;
  server: string;
  ports: ServerLoopbackPorts;
  request: RemotePortListRequest | null;
  port: RemotePortPreviewPort;
  capabilityFailed: boolean;
}>;

export type AgentServerLoopbackDeps = Readonly<{
  snapshot(): AgentServerLoopbackSnapshot;
  open(port: number, options: RemotePortOpenOptions): Promise<RemotePortOpenResult>;
  recheckCapability(): void;
  report(notice: AgentTasksNotice): void;
}>;

const info = (message: string): AgentTasksNotice => ({ kind: "info", message, action: null });

async function verified(
  decision: Extract<ServerLoopbackDecision, { kind: "verify" }>,
  snapshot: AgentServerLoopbackSnapshot,
): Promise<ServerLoopbackDecision> {
  if (snapshot.request === null) return { kind: "open", target: decision.target };
  try {
    const listing = await snapshot.port.list(snapshot.request);
    const listed = new Set(listing.ports.map((entry) => entry.port));
    return verifiedServerLoopbackDecision(decision.target, listed);
  } catch (reason) {
    return { kind: "notice", message: remotePortErrorMessage(reason) };
  }
}

export function createAgentServerLoopbackPort(
  deps: AgentServerLoopbackDeps,
): AgentServerLoopbackPort {
  const current = (generation: number) => deps.snapshot().generation === generation;
  return {
    titleFor: (url) => serverLoopbackLinkTitle(url, deps.snapshot().server),
    openLoopback: async (url) => {
      const snapshot = deps.snapshot();
      if (snapshot.capabilityFailed) deps.recheckCapability();
      let decision = serverLoopbackDecision(url, snapshot.ports, snapshot.server);
      if (decision.kind === "verify") decision = await verified(decision, snapshot);
      if (!current(snapshot.generation)) return;
      if (decision.kind !== "open") {
        if (decision.kind === "notice") deps.report(info(decision.message));
        return;
      }
      const { port, scheme, path } = decision.target;
      const result = await deps.open(port, { scheme, path });
      if (result.kind !== "failed" || !current(snapshot.generation)) return;
      deps.report({ kind: "warning", message: result.reason, action: null });
    },
  };
}
