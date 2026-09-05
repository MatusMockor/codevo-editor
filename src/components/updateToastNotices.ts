import type { WorkbenchNotice } from "../application/workbenchNotice";
import {
  appUpdateToastGroupKey,
  appUpdateToastTitle,
  type AppUpdateToastPresentation,
} from "../domain/appUpdater";
import {
  agentProviderUpdateToastGroupKey,
  agentProviderUpdateToastTitle,
  type AgentProviderUpdateToastPresentation,
} from "./agentProviderUpdateToastPresenter";

export const AGENT_PROVIDER_UPDATE_NOTICE_SOURCE = "Agent provider";
export const APP_UPDATE_NOTICE_SOURCE = "Application update";

export interface UpdateToastSources {
  readonly app: AppUpdateToastPresentation | null;
  readonly provider: AgentProviderUpdateToastPresentation | null;
}

export function composeToastNotices(
  sources: UpdateToastSources,
  workbenchNotices: readonly WorkbenchNotice[],
): WorkbenchNotice[] {
  const updates: WorkbenchNotice[] = [];
  if (sources.provider) updates.push(providerNotice(sources.provider));
  if (sources.app) updates.push(appNotice(sources.app));
  if (updates.length === 0) return [...workbenchNotices];

  const urgent = workbenchNotices.filter((notice) => notice.severity !== "info");
  const routine = workbenchNotices.filter((notice) => notice.severity === "info");
  return [...urgent, ...updates, ...routine];
}

function providerNotice(presentation: AgentProviderUpdateToastPresentation): WorkbenchNotice {
  const groupKey = agentProviderUpdateToastGroupKey(presentation);
  return {
    groupKey,
    id: groupKey,
    message: agentProviderUpdateToastTitle(presentation),
    severity: presentation.kind === "failed" ? "error" : "info",
    source: AGENT_PROVIDER_UPDATE_NOTICE_SOURCE,
  };
}

function appNotice(presentation: AppUpdateToastPresentation): WorkbenchNotice {
  const groupKey = appUpdateToastGroupKey(presentation);
  return {
    groupKey,
    id: groupKey,
    message: appUpdateToastTitle(presentation),
    severity: presentation.kind === "failed" ? "error" : "info",
    source: APP_UPDATE_NOTICE_SOURCE,
  };
}
