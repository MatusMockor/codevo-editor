import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  filterSymfonyConsoleCommands,
  filterSymfonyRoutes,
  filterSymfonyServices,
  type SymfonyConsoleCommandsResult,
  type SymfonyRoute,
  type SymfonyRoutesResult,
  type SymfonyService,
  type SymfonyServicesResult,
} from "../domain/symfonyWorkspaceIntelligence";
import type { SymfonyWorkspaceIntelligenceGateway } from "../domain/symfonyWorkspaceIntelligenceGateway";
import {
  SYMFONY_WORKSPACE_PANEL_TABS,
  type SymfonyRouteControllerNavigation,
  type SymfonyServiceNavigation,
  type SymfonyWorkspacePanelModel,
  type SymfonyWorkspacePanelTab,
} from "./symfonyWorkspacePanelModel";

const NO_WORKSPACE = { status: "unavailable", message: "No Symfony workspace is active." } as const;

interface StoredPanelState {
  readonly activeTab: SymfonyWorkspacePanelTab;
  readonly busy: boolean;
  readonly commands: SymfonyConsoleCommandsResult;
  readonly error: string | null;
  readonly ownerKey: string;
  readonly query: string;
  readonly routes: SymfonyRoutesResult;
  readonly services: SymfonyServicesResult;
}

export interface UseSymfonyWorkspacePanelControllerOptions {
  readonly discoveryVersion: number;
  readonly enabled: boolean;
  readonly gateway: SymfonyWorkspaceIntelligenceGateway;
  readonly onOpenController: SymfonyRouteControllerNavigation;
  readonly onOpenService: SymfonyServiceNavigation;
  readonly rootPath: string | null;
  readonly workspaceId: string | null;
}

export function useSymfonyWorkspacePanelController({
  discoveryVersion,
  enabled,
  gateway,
  onOpenController,
  onOpenService,
  rootPath,
  workspaceId,
}: UseSymfonyWorkspacePanelControllerOptions): SymfonyWorkspacePanelModel {
  const ownerKey = `${workspaceId ?? ""}\0${rootPath ?? ""}`;
  const [stored, setStored] = useState<StoredPanelState>(() => emptyState(ownerKey));
  const state = stored.ownerKey === ownerKey ? stored : emptyState(ownerKey);
  const ownerRef = useRef({ enabled, ownerKey, workspaceId });
  ownerRef.current = { enabled, ownerKey, workspaceId };
  const requestSequenceRef = useRef(0);

  const update = useCallback(
    (values: Partial<Omit<StoredPanelState, "ownerKey">>) => {
      setStored((current) => ({
        ...(current.ownerKey === ownerKey ? current : emptyState(ownerKey)),
        ...values,
        ownerKey,
      }));
    },
    [ownerKey],
  );
  const isCurrent = useCallback(
    (capturedOwnerKey: string, capturedWorkspaceId: string, sequence?: number) => {
      const current = ownerRef.current;
      return (
        current.enabled &&
        current.ownerKey === capturedOwnerKey &&
        current.workspaceId === capturedWorkspaceId &&
        (sequence === undefined || requestSequenceRef.current === sequence)
      );
    },
    [],
  );

  const refresh = useCallback(async (): Promise<boolean> => {
    const capturedWorkspaceId = workspaceId;
    const capturedOwnerKey = ownerKey;
    if (!enabled || !capturedWorkspaceId) return false;
    const sequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = sequence;
    update({ busy: true, error: null });
    try {
      const [commands, routes, services] = await Promise.all([
        gateway.listSymfonyConsoleCommands(capturedWorkspaceId),
        gateway.listSymfonyRoutes(capturedWorkspaceId),
        gateway.listSymfonyServices(capturedWorkspaceId),
      ]);
      if (!isCurrent(capturedOwnerKey, capturedWorkspaceId, sequence)) return false;
      update({ busy: false, commands, error: null, routes, services });
      return true;
    } catch {
      if (!isCurrent(capturedOwnerKey, capturedWorkspaceId, sequence)) return false;
      update({ busy: false, error: "Could not inspect the Symfony workspace." });
      return false;
    }
  }, [enabled, gateway, isCurrent, ownerKey, update, workspaceId]);

  useEffect(() => {
    if (!enabled || !workspaceId) return;
    void refresh();
  }, [discoveryVersion, enabled, refresh, workspaceId]);

  const navigate = useCallback(
    async <Item>(
      item: Item,
      target: SymfonyRouteControllerNavigation | SymfonyServiceNavigation,
    ): Promise<boolean> => {
      const capturedWorkspaceId = workspaceId;
      const capturedOwnerKey = ownerKey;
      if (!enabled || !capturedWorkspaceId) return false;
      const shouldCommit = () => isCurrent(capturedOwnerKey, capturedWorkspaceId);
      update({ error: null });
      try {
        const opened = await (
          target as (value: Item, guard: () => boolean) => Promise<boolean> | boolean
        )(item, shouldCommit);
        return shouldCommit() && opened;
      } catch {
        if (shouldCommit()) update({ error: "Could not open the Symfony declaration." });
        return false;
      }
    },
    [enabled, isCurrent, ownerKey, update, workspaceId],
  );

  const onOpenRouteController = useCallback(
    (route: SymfonyRoute) => navigate(route, onOpenController),
    [navigate, onOpenController],
  );
  const onOpenServiceDefinition = useCallback(
    (service: SymfonyService) => navigate(service, onOpenService),
    [navigate, onOpenService],
  );
  const onQueryChange = useCallback((query: string) => update({ query }), [update]);
  const onTabChange = useCallback(
    (activeTab: SymfonyWorkspacePanelTab) => {
      if (SYMFONY_WORKSPACE_PANEL_TABS.includes(activeTab)) update({ activeTab });
    },
    [update],
  );

  const filteredCommands = useMemo(
    () =>
      state.commands.status === "ok"
        ? filterSymfonyConsoleCommands(state.commands.commands, state.query)
        : [],
    [state.commands, state.query],
  );
  const filteredRoutes = useMemo(
    () =>
      state.routes.status === "ok" ? filterSymfonyRoutes(state.routes.routes, state.query) : [],
    [state.query, state.routes],
  );
  const filteredServices = useMemo(
    () =>
      state.services.status === "ok"
        ? filterSymfonyServices(state.services.services, state.query)
        : [],
    [state.query, state.services],
  );

  return {
    activeTab: state.activeTab,
    busy: state.busy,
    commands: state.commands,
    error: state.error,
    filteredCommands,
    filteredRoutes,
    filteredServices,
    onOpenRouteController,
    onOpenService: onOpenServiceDefinition,
    onQueryChange,
    onRefresh: refresh,
    onTabChange,
    query: state.query,
    routes: state.routes,
    services: state.services,
  };
}

function emptyState(ownerKey: string): StoredPanelState {
  return {
    activeTab: "commands",
    busy: false,
    commands: NO_WORKSPACE,
    error: null,
    ownerKey,
    query: "",
    routes: NO_WORKSPACE,
    services: NO_WORKSPACE,
  };
}
