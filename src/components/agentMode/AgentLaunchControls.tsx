import { useAgentClaudeModelCatalog } from "./useAgentClaudeModelCatalog";
import type { ReactNode } from "react";
import { AgentComposerCompactMenu } from "./AgentComposerCompactMenu";
import type { AgentModelFavorites } from "../../application/useAgentModelFavorites";
import type { AgentProviderManagementSurface } from "../../application/useAgentProviderManagement";
import type { AgentExecutionTarget, AgentLaunchOptions } from "../../domain/agentLaunch";
import type { AgentCliKind } from "../../domain/agentTask";
import {
  agentLaunchModelHint,
  agentLaunchWithMode,
  agentLaunchWithModel,
  type AgentModelChoice,
} from "./agentLaunchPresentation";
import { AgentModelPicker } from "./AgentModelPicker";
import { defaultAgentComposerLaunch, normalizeAgentComposerLaunch } from "./agentComposerLaunch";
import { AgentAccessMenu } from "./AgentAccessMenu";
import { AgentTraitsPicker } from "./AgentTraitsPicker";
import { useComposerPaletteBinding } from "./useComposerPaletteBinding";
import "./pickers/agentPickers.css";

const MODEL_ID = "agent-launch-model";

export interface AgentLaunchControlRequest {
  readonly kind: "model" | "reasoning" | "permissions";
}

export interface AgentLaunchControlsProps {
  readonly openRequest?: AgentLaunchControlRequest | null;
  onOpenRequestHandled?(): void;
  readonly presentation?:
    { readonly kind: "inline" } | { readonly kind: "compact"; readonly checkout: ReactNode };
  readonly launch: AgentLaunchOptions;
  readonly disabled: boolean;
  readonly executionTarget?: AgentExecutionTarget;
  readonly favorites: AgentModelFavorites;
  readonly providerEnabled?: Readonly<Record<AgentCliKind, boolean>> | null;
  readonly providerManagement?: AgentProviderManagementSurface | null;
  readonly providerSwitchable?: boolean;
  onLaunchChange(next: AgentLaunchOptions): void;
}

export function AgentLaunchControls({
  disabled,
  openRequest = null,
  onOpenRequestHandled,
  presentation = { kind: "inline" },
  executionTarget = "local",
  favorites,
  launch,
  onLaunchChange,
  providerEnabled = null,
  providerManagement = null,
  providerSwitchable = false,
}: AgentLaunchControlsProps) {
  const catalog = useAgentClaudeModelCatalog();
  const effectiveLaunch = normalizeAgentComposerLaunch(launch);
  const configuredModelFor = (provider: AgentCliKind): string | null => {
    const discovered = providerManagement?.cliDiscovery[provider];
    return discovered?.kind === "detected" ? (discovered.configuredModel ?? null) : null;
  };
  const configuredModel = configuredModelFor(effectiveLaunch.provider);
  const selectModel = (
    model: AgentModelChoice,
    provider: AgentCliKind = effectiveLaunch.provider,
  ) =>
    onLaunchChange(
      agentLaunchWithModel(
        provider === effectiveLaunch.provider
          ? effectiveLaunch
          : defaultAgentComposerLaunch(provider),
        model,
        configuredModelFor(provider),
        catalog,
      ),
    );
  useComposerPaletteBinding({
    launch: effectiveLaunch,
    catalog,
    providerManagement,
    providerEnabled,
    providerSwitchable,
    disabled,
    selectModel,
  });
  const secondaryControls = (
    <>
      {effectiveLaunch.provider === "claudeCode" && (
        <>
          <AgentLaunchDivider />
          <AgentTraitsPicker
            onOpenRequestHandled={onOpenRequestHandled}
            openRequest={openRequest?.kind === "reasoning" ? openRequest : null}
            configuredModel={configuredModel}
            disabled={disabled}
            executionTarget={executionTarget}
            launch={effectiveLaunch}
            onChange={onLaunchChange}
          />
        </>
      )}

      <AgentLaunchDivider />
      <AgentAccessMenu
        disabled={disabled}
        launch={effectiveLaunch}
        onChange={(value) => onLaunchChange(agentLaunchWithMode(effectiveLaunch, value))}
        onOpenRequestHandled={onOpenRequestHandled}
        openRequest={openRequest?.kind === "permissions" ? openRequest : null}
        target={executionTarget}
      />
    </>
  );
  return (
    <div className="agent-composer__launch" data-presentation={presentation.kind}>
      <AgentModelPicker
        onOpenRequestHandled={onOpenRequestHandled}
        openRequest={openRequest?.kind === "model" ? openRequest : null}
        describedBy={`${MODEL_ID}-hint`}
        disabled={disabled}
        favorites={favorites}
        id={MODEL_ID}
        label="Agent model"
        launch={effectiveLaunch}
        onSelect={selectModel}
        providerEnabled={providerEnabled}
        providerManagement={providerManagement}
        providerSwitchable={providerSwitchable}
      />
      <span className="agent-visually-hidden" id={`${MODEL_ID}-hint`}>
        {agentLaunchModelHint(launch, configuredModel, catalog)}
      </span>

      {presentation.kind === "compact" ? (
        <AgentComposerCompactMenu
          disabled={disabled}
          openRequest={openRequest?.kind !== "model" ? openRequest : null}
        >
          {secondaryControls}
          {presentation.checkout}
        </AgentComposerCompactMenu>
      ) : (
        secondaryControls
      )}
    </div>
  );
}

function AgentLaunchDivider() {
  return <span aria-hidden="true" className="agent-composer__divider" />;
}
