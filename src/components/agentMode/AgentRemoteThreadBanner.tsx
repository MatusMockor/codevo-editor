import { ServerOff } from "lucide-react";
import { Button } from "../../ui/foundation/Button";
import { ComposerBanner } from "../../ui/foundation/ComposerBanner";
import type { AgentRemoteThreadBannerView } from "./modeView/useAgentModeRemoteThreadRecovery";

export function AgentRemoteThreadBanner({
  banner,
}: {
  readonly banner: AgentRemoteThreadBannerView | null;
}) {
  if (banner === null) return null;
  return (
    <ComposerBanner
      actions={
        <>
          {banner.onConnect === null ? null : (
            <Button
              disabled={banner.connecting}
              onClick={banner.onConnect}
              size="sm"
              variant="primary"
            >
              {banner.connecting ? "Connecting…" : "Connect"}
            </Button>
          )}
          <Button onClick={banner.onNewThread} size="sm" variant="ghost">
            New thread
          </Button>
        </>
      }
      icon={<ServerOff aria-hidden="true" size={14} />}
      tone="warn"
    >
      {banner.message}
      {banner.failure === null ? null : <span role="alert"> {banner.failure}</span>}
    </ComposerBanner>
  );
}
