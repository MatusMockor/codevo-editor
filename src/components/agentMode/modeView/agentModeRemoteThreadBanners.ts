import { createElement, Fragment, type ReactNode } from "react";
import { AgentRemoteThreadBanner } from "../AgentRemoteThreadBanner";
import type { AgentRemoteThreadBannerView } from "./useAgentModeRemoteThreadRecovery";

export function withAgentRemoteThreadBanner(
  banners: ReactNode,
  banner: AgentRemoteThreadBannerView | null,
): ReactNode {
  if (banner === null) return banners;
  return createElement(Fragment, null, banners, createElement(AgentRemoteThreadBanner, { banner }));
}
