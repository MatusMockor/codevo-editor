import { useEffect, useMemo, useRef } from "react";
import {
  workbenchComposerPaletteModels,
  type PaletteModelOption,
} from "../../application/commandPalette/commandPaletteProvider";
import type { AgentProviderManagementSurface } from "../../application/useAgentProviderManagement";
import type { AgentLaunchOptions } from "../../domain/agentLaunch";
import type { AgentCliKind } from "../../domain/agentTask";
import type { ClaudeModelManifest } from "../../domain/claudeModelCatalog";
import type { CodexModelCatalog } from "../../domain/codexModelCatalog";
import {
  agentLaunchEffectiveModel,
  agentModelProviderName,
  agentModelRows,
  type AgentModelChoice,
  type AgentModelRow,
} from "./agentLaunchPresentation";
import {
  configuredProviderModel,
  configuredProviderVersion,
  providerIsEnabled,
} from "./agentModelProviderState";
import { useAgentModelNewness } from "./useAgentModelNewness";

const PROVIDERS: ReadonlyArray<AgentCliKind> = ["claudeCode", "codex"];

export interface ComposerPaletteBindingOptions {
  readonly launch: AgentLaunchOptions;
  readonly catalog: ClaudeModelManifest;
  readonly codexCatalog: CodexModelCatalog;
  readonly providerManagement: AgentProviderManagementSurface | null;
  readonly providerEnabled: Readonly<Record<AgentCliKind, boolean>> | null;
  readonly providerSwitchable: boolean;
  readonly disabled: boolean;
  selectModel(model: AgentModelChoice, provider: AgentCliKind): void;
}

export function useComposerPaletteBinding(options: ComposerPaletteBindingOptions): void {
  const {
    catalog,
    codexCatalog,
    disabled,
    launch,
    providerEnabled,
    providerManagement,
    providerSwitchable,
  } = options;
  const newness = useAgentModelNewness();
  const select = useRef(options.selectModel);
  select.current = options.selectModel;
  const rows = useMemo(
    () =>
      PROVIDERS.filter((provider) => providerIsEnabled(providerEnabled, provider))
        .filter((provider) => providerSwitchable || provider === launch.provider)
        .flatMap((provider) =>
          agentModelRows(
            provider,
            configuredProviderModel(providerManagement, provider),
            configuredProviderVersion(providerManagement, provider),
            catalog,
            codexCatalog,
            newness,
          ).filter((row) => row.isLegacy !== true),
        ),
    [
      catalog,
      codexCatalog,
      launch.provider,
      newness,
      providerEnabled,
      providerManagement,
      providerSwitchable,
    ],
  );
  const selected = agentLaunchEffectiveModel(
    launch,
    configuredProviderModel(providerManagement, launch.provider),
    catalog,
    codexCatalog,
  );

  useEffect(() => {
    if (disabled) return undefined;
    const byKey = new Map(rows.map((row) => [rowKey(row), row]));
    const options: readonly PaletteModelOption[] = rows.map((row) => ({
      key: rowKey(row),
      group: agentModelProviderName(row.provider),
      label: row.label,
      current: row.provider === launch.provider && row.value === selected,
    }));
    return workbenchComposerPaletteModels.publish({
      options,
      selectModel(key) {
        const row = byKey.get(key);
        if (row === undefined) return false;
        select.current(row.value, row.provider);
        return true;
      },
    });
  }, [disabled, launch.provider, rows, selected]);
}

function rowKey(row: AgentModelRow): string {
  return `${row.provider}:${String(row.value)}`;
}
