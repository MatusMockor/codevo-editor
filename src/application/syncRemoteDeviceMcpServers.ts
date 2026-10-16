import type {
  RemoteRunnerDescriptor,
  RemoteRunnerGateway,
  RemoteRunnerProvider,
} from "../domain/remoteRunner";
import {
  deviceMcpSyncFailureNotice,
  deviceMcpSyncNotice,
  deviceMcpSyncPersistentFingerprint,
  type RemoteRunnerMcpDeviceSyncReport,
} from "../domain/remoteRunnerMcpDeviceSync";
import type { RemoteDeviceMcpNoticeMemory } from "./remoteDeviceMcpNoticeMemory";
import type { RemoteDeviceMcpSourceResolver, RemoteDeviceMcpTarget } from "./remoteDeviceMcpSource";

export const REMOTE_DEVICE_MCP_SYNC_TIMEOUT_MS = 20_000;

export type RemoteDeviceMcpSyncInput = Readonly<{
  gateway: Pick<RemoteRunnerGateway, "syncDeviceMcpServers">;
  descriptor: RemoteRunnerDescriptor;
  target: RemoteDeviceMcpTarget;
  provider: RemoteRunnerProvider;
  resolveSource: RemoteDeviceMcpSourceResolver | undefined;
  valid: () => boolean;
  memory: RemoteDeviceMcpNoticeMemory;
  timeoutMs?: number;
}>;

type Settlement =
  | Readonly<{ kind: "report"; report: RemoteRunnerMcpDeviceSyncReport }>
  | Readonly<{ kind: "failed"; error: unknown }>
  | Readonly<{ kind: "timeout" }>;

function errorDetail(error: unknown): string | null {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return null;
}

async function settle(
  run: () => Promise<RemoteRunnerMcpDeviceSyncReport>,
  timeoutMs: number,
): Promise<Settlement> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Settlement>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
  });
  const work = Promise.resolve()
    .then(run)
    .then(
      (report): Settlement => ({ kind: "report", report }),
      (error: unknown): Settlement => ({ kind: "failed", error }),
    );
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function reportNotice(
  report: RemoteRunnerMcpDeviceSyncReport,
  target: RemoteDeviceMcpTarget,
  memory: RemoteDeviceMcpNoticeMemory,
): string | null {
  const fingerprint = deviceMcpSyncPersistentFingerprint(report);
  const persistent = fingerprint !== null && memory.shown(target, fingerprint) ? "hide" : "show";
  memory.remember(target, fingerprint);
  return deviceMcpSyncNotice(report, persistent);
}

function noticeOf(
  settlement: Settlement,
  input: RemoteDeviceMcpSyncInput,
  timeoutMs: number,
): string | null {
  switch (settlement.kind) {
    case "report":
      return reportNotice(settlement.report, input.target, input.memory);
    case "failed":
      return deviceMcpSyncFailureNotice({
        kind: "failed",
        detail: errorDetail(settlement.error),
      });
    case "timeout":
      return deviceMcpSyncFailureNotice({
        kind: "timeout",
        seconds: Math.round(timeoutMs / 1000),
      });
    default: {
      const unreachable: never = settlement;
      return unreachable;
    }
  }
}

export async function syncRemoteDeviceMcpServers(
  input: RemoteDeviceMcpSyncInput,
): Promise<string | null> {
  try {
    const { gateway, descriptor, target, valid } = input;
    if (input.provider !== "claude" || !valid()) return null;
    if (descriptor.runnerId !== target.runnerId) return null;
    if (descriptor.capabilities.mcpDeviceSync !== true) return null;
    const sync = gateway.syncDeviceMcpServers?.bind(gateway);
    if (sync === undefined || input.resolveSource === undefined) return null;
    const source = input.resolveSource(target);
    if (source === null) return null;
    const timeoutMs = input.timeoutMs ?? REMOTE_DEVICE_MCP_SYNC_TIMEOUT_MS;
    const settlement = await settle(
      () =>
        sync({
          serverId: target.serverId,
          runnerId: target.runnerId,
          projectId: target.projectId,
          rootPath: source.rootPath,
          projectKind: source.projectKind,
        }),
      timeoutMs,
    );
    if (!valid()) return null;
    return noticeOf(settlement, input, timeoutMs);
  } catch {
    return null;
  }
}
