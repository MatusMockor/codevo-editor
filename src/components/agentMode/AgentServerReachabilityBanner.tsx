import { ServerOff } from "lucide-react";
import { Button } from "../../ui/foundation/Button";
import { ComposerBanner } from "../../ui/foundation/ComposerBanner";
import {
  AGENT_SERVER_RECONNECT_LABEL,
  AGENT_SERVER_RETRY_LABEL,
  type AgentServerBannerAction,
} from "./agentServerReachabilityPresentation";
import type { AgentServerReachabilityBannerView } from "./useAgentServerReachabilityBanner";

export function AgentServerReachabilityBanner({
  banner,
}: {
  readonly banner: AgentServerReachabilityBannerView | null;
}) {
  if (banner === null) return null;
  const label = actionLabel(banner.presentation.action);
  const onAction = banner.onAction;
  return (
    <ComposerBanner
      actions={
        label === null || onAction === null ? undefined : (
          <Button disabled={banner.busy} onClick={onAction} size="sm" variant="ghost">
            {label}
          </Button>
        )
      }
      icon={<ServerOff aria-hidden="true" size={14} />}
      tone={banner.presentation.tone}
    >
      <span
        style={banner.presentation.detail === null ? undefined : SINGLE_LINE}
        title={bannerTitle(banner)}
      >
        {banner.presentation.message}
        {banner.presentation.detail === null ? null : ` ${banner.presentation.detail}`}
        {banner.failure === null ? null : <span role="alert"> {banner.failure}</span>}
      </span>
    </ComposerBanner>
  );
}

const SINGLE_LINE = {
  display: "block",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
} as const;

function bannerTitle(banner: AgentServerReachabilityBannerView): string {
  return [banner.presentation.message, banner.presentation.detail, banner.failure]
    .filter((part) => part !== null)
    .join(" ");
}

function actionLabel(action: AgentServerBannerAction): string | null {
  switch (action) {
    case "retry":
      return AGENT_SERVER_RETRY_LABEL;
    case "reconnect":
      return AGENT_SERVER_RECONNECT_LABEL;
    case "none":
      return null;
    default:
      return unsupportedAction(action);
  }
}

function unsupportedAction(action: never): never {
  throw new TypeError(`Unsupported server banner action: ${String(action)}.`);
}
