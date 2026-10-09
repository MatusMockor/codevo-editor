import { ServerOff } from "lucide-react";
import type { RemoteRunnerReachability } from "../../../domain/remoteRunnerReachability";
import { useRemoteRunnerContext } from "../../remoteRunner/remoteRunnerContext";
import { agentServerWaitLabel } from "../agentServerReachabilityPresentation";

export function AgentServerWaitRow({
  reachability,
  serverId,
}: {
  readonly reachability: RemoteRunnerReachability;
  readonly serverId: string | null;
}) {
  const servers = useRemoteRunnerContext()?.servers;
  const serverName = servers?.find((server) => server.id === serverId)?.name ?? null;
  const label = agentServerWaitLabel(reachability, serverName);
  if (label === null) return null;
  return (
    <div
      aria-live="polite"
      className="cv-live-row"
      data-server-wait={reachability.kind}
      role="status"
    >
      <span aria-hidden="true" className="cv-live-row__icon">
        <ServerOff size={16} strokeWidth={1.5} />
      </span>
      <span className="cv-live-row__label">{label}</span>
    </div>
  );
}
