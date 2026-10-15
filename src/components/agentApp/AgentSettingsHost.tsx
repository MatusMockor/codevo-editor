import type { ComponentProps } from "react";
import type { AgentProviderManagementSurface } from "../../application/useAgentProviderManagement";
import type { AppUpdaterSurface } from "../../application/useAppUpdater";
import type { SystemFontGateway } from "../../domain/systemFonts";
import { retryableLazy } from "../retryableLazy";
import type { WorkbenchSettingsModel } from "../settings/workbenchSettingsModel";

const LazyWorkbenchSettingsHost = retryableLazy<
  ComponentProps<typeof import("../WorkbenchSettingsHost").WorkbenchSettingsHost>
>(
  () =>
    import("../WorkbenchSettingsHost").then((module) => ({
      default: module.WorkbenchSettingsHost,
    })),
  "settings",
);

export type AgentSettingsModel = WorkbenchSettingsModel;

export interface AgentSettingsHostProps {
  readonly appUpdater: AppUpdaterSurface;
  readonly container: HTMLElement | null;
  readonly model: AgentSettingsModel;
  readonly providerManagement: AgentProviderManagementSurface;
  readonly systemFontGateway: SystemFontGateway;
}

export function AgentSettingsHost({
  appUpdater,
  container,
  model,
  providerManagement,
  systemFontGateway,
}: AgentSettingsHostProps) {
  if (!model.settingsOpen) return null;
  return (
    <LazyWorkbenchSettingsHost
      appUpdater={appUpdater}
      container={container}
      providerManagement={providerManagement}
      systemFontGateway={systemFontGateway}
      workbench={model}
    />
  );
}
