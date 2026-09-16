import { useRemoteExecutionPolicy } from "../../application/useRemoteExecutionPolicy";
import type { RemoteRunnerGateway } from "../../domain/remoteRunner";

export function RemoteRunnerExecutionPolicy({
  gateway,
  serverId,
  connected,
}: {
  readonly gateway: RemoteRunnerGateway;
  readonly serverId: string;
  readonly connected: boolean;
}) {
  const timeoutMs = useRemoteExecutionPolicy(gateway, serverId, connected);
  if (!connected) return null;
  const hours = timeoutMs === null ? null : timeoutMs / 3_600_000;
  const duration =
    hours === null
      ? null
      : hours >= 1
        ? `${Number(hours.toFixed(2))} ${hours === 1 ? "hour" : "hours"}`
        : `${Number((hours * 60).toFixed(2))} ${timeoutMs === 60_000 ? "minute" : "minutes"}`;
  return (
    <p className="settings-environments__description">
      {duration
        ? `Run limit: ${duration}, including time waiting for your answers.`
        : "Run limit is not available from this server."}{" "}
      Closing the editor keeps tasks running. Restarting the server interrupts them.
    </p>
  );
}
