import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { agentCliExecutablePresentation } from "../domain/agentSettings";
import type { AgentCliKind } from "../domain/agentTask";
import type {
  AgentProviderManagementDependencies,
  AgentProviderManagementSurface,
  AgentProviderManagementToast,
  AgentProviderManagementView,
  SelectedAgentProviderAuthorityPublication,
} from "./agentProviders/agentProviderManagementContract";
import { createAgentProviderManagementCoordinator } from "./agentProviders/agentProviderManagementCoordinator";
import {
  currentSelectedProviderAuthority,
  initialRuntime,
} from "./agentProviders/agentProviderRuntime";
import { useAgentCliDiscovery } from "./useAgentCliDiscovery";

export type {
  AgentProviderManagementDependencies,
  AgentProviderManagementSurface,
  AgentProviderManagementToast,
  AgentProviderManagementView,
  AgentProviderRefreshOutcome,
  AgentProviderSettingsSaveOutcome,
  AgentProviderUpdateRefusal,
  SelectedAgentProviderAuthority,
} from "./agentProviders/agentProviderManagementContract";
export type { AgentProviderSettingsIntent } from "./agentProviderSettingsIntent";

export function useAgentProviderManagement(
  dependencies: AgentProviderManagementDependencies,
): AgentProviderManagementSurface {
  const cliDiscovery = useAgentCliDiscovery({
    active: dependencies.settingsHydrated,
    autoDiscover:
      dependencies.appSettingsRef.current.agentCliPaths.claudeCode === null ||
      dependencies.appSettingsRef.current.agentCliPaths.codex === null,
    gateway: dependencies.discoveryGateway,
    reportError: dependencies.reportError,
  });
  const [runtime, setRuntime] = useState(initialRuntime);
  const [toast, setToast] = useState<AgentProviderManagementToast | null>(null);
  const [selectedProviderAuthorityPublication, setSelectedProviderAuthorityPublication] =
    useState<SelectedAgentProviderAuthorityPublication | null>(null);
  const [coordinator] = useState(() =>
    createAgentProviderManagementCoordinator(dependencies, cliDiscovery, {
      setRuntime,
      setToast,
      setSelectedProviderAuthorityPublication,
    }),
  );

  useLayoutEffect(() => {
    coordinator.syncRendered(dependencies, runtime, toast, cliDiscovery);
  });

  const { appSettingsRef, healthGateway, policyGateway, settingsHydrated, updateGateway } =
    dependencies;
  useEffect(
    () => coordinator.activate(settingsHydrated, appSettingsRef),
    [appSettingsRef, coordinator, healthGateway, policyGateway, settingsHydrated, updateGateway],
  );

  useEffect(() => {
    coordinator.applyDiscoveryStatus(cliDiscovery.status);
  }, [cliDiscovery.status, coordinator]);

  const claudeLiveTurnCount = dependencies.liveTurnCount("claudeCode");
  const codexLiveTurnCount = dependencies.liveTurnCount("codex");
  const claudeSignInActive = dependencies.signInActive("claudeCode");
  const codexSignInActive = dependencies.signInActive("codex");
  const selectedProviderAuthority = useMemo(
    () =>
      currentSelectedProviderAuthority(
        selectedProviderAuthorityPublication,
        settingsHydrated,
        policyGateway,
        healthGateway,
        updateGateway,
      ),
    [
      healthGateway,
      policyGateway,
      settingsHydrated,
      updateGateway,
      selectedProviderAuthorityPublication,
    ],
  );

  const providers = useMemo(
    (): Readonly<Record<AgentCliKind, AgentProviderManagementView>> => ({
      claudeCode: {
        executable: agentCliExecutablePresentation(
          "claudeCode",
          coordinator.persistedCliPath("claudeCode"),
          cliDiscovery.result.claudeCode,
        ),
        health: runtime.claudeCode.health,
        policy: runtime.claudeCode.policy,
        updateState: runtime.claudeCode.updateState,
        liveTurnCount: claudeLiveTurnCount,
        signInActive: claudeSignInActive,
      },
      codex: {
        executable: agentCliExecutablePresentation(
          "codex",
          coordinator.persistedCliPath("codex"),
          cliDiscovery.result.codex,
        ),
        health: runtime.codex.health,
        policy: runtime.codex.policy,
        updateState: runtime.codex.updateState,
        liveTurnCount: codexLiveTurnCount,
        signInActive: codexSignInActive,
      },
    }),
    [
      claudeLiveTurnCount,
      claudeSignInActive,
      cliDiscovery.result,
      codexLiveTurnCount,
      codexSignInActive,
      coordinator,
      runtime,
    ],
  );

  return useMemo(
    () => ({
      providers,
      cliDiscovery: cliDiscovery.result,
      selectedProviderAuthority,
      toast,
      admissionAuthority: coordinator.admissionAuthority,
      authority: coordinator.authority,
      dismissToast: coordinator.dismissToast,
      dismissUpdate: coordinator.dismissUpdate,
      refresh: coordinator.refresh,
      refreshAll: coordinator.refreshAll,
      refreshWithOutcome: coordinator.refreshWithOutcome,
      retryRegistration: coordinator.retryRegistration,
      save: coordinator.save,
      saveWithOutcome: coordinator.saveWithOutcome,
      update: coordinator.update,
    }),
    [cliDiscovery.result, coordinator, providers, selectedProviderAuthority, toast],
  );
}
