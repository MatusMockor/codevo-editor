import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  NetteWorkspaceRoute,
  NetteWorkspaceRoutesResult,
} from "../domain/netteWorkspaceRoutes";
import type {
  NetteWorkspaceRouteOverlay,
  NetteWorkspaceRoutesGateway,
} from "../domain/netteWorkspaceRoutesGateway";
import type {
  NetteRouteDefinitionNavigation,
  NetteRouteTargetNavigation,
  NetteWorkspaceRoutesPanelModel,
} from "./netteWorkspaceRoutesPanelModel";

const NO_WORKSPACE = { status: "unavailable", message: "No Nette workspace is active." } as const;
const OVERLAY_REFRESH_DELAY_MS = 200;

interface StoredState {
  readonly busy: boolean;
  readonly error: string | null;
  readonly ownerKey: string;
  readonly query: string;
  readonly routes: NetteWorkspaceRoutesResult;
}

export interface UseNetteWorkspaceRoutesPanelControllerOptions {
  readonly discoveryVersion: number;
  readonly enabled: boolean;
  readonly gateway: NetteWorkspaceRoutesGateway;
  readonly onOpenDefinition: NetteRouteDefinitionNavigation;
  readonly onOpenTarget: NetteRouteTargetNavigation;
  readonly overlays: readonly NetteWorkspaceRouteOverlay[];
  readonly rootPath: string | null;
}

export function useNetteWorkspaceRoutesPanelController({
  discoveryVersion,
  enabled,
  gateway,
  onOpenDefinition,
  onOpenTarget,
  overlays,
  rootPath,
}: UseNetteWorkspaceRoutesPanelControllerOptions): NetteWorkspaceRoutesPanelModel {
  const ownerKey = rootPath ?? "";
  const [stored, setStored] = useState<StoredState>(() => emptyState(ownerKey));
  const state = stored.ownerKey === ownerKey ? stored : emptyState(ownerKey);
  const ownerRef = useRef({ enabled, ownerKey });
  ownerRef.current = { enabled, ownerKey };
  const overlaysRef = useRef(overlays);
  overlaysRef.current = overlays;
  const overlayRevision = useMemo(() => routeOverlayRevision(overlays), [overlays]);
  const requestSequenceRef = useRef(0);
  const activeRefreshRef = useRef<Promise<boolean> | null>(null);
  const queuedRefreshRef = useRef(false);
  const refreshRunnerRef = useRef<() => Promise<boolean>>(async () => false);

  const update = useCallback(
    (values: Partial<Omit<StoredState, "ownerKey">>) => {
      setStored((current) => ({
        ...(current.ownerKey === ownerKey ? current : emptyState(ownerKey)),
        ...values,
        ownerKey,
      }));
    },
    [ownerKey],
  );
  const isCurrent = useCallback((capturedOwnerKey: string, sequence?: number) => {
    const current = ownerRef.current;
    return (
      current.enabled &&
      current.ownerKey === capturedOwnerKey &&
      (sequence === undefined || requestSequenceRef.current === sequence)
    );
  }, []);

  const runInspection = useCallback(async (): Promise<boolean> => {
    const capturedRootPath = rootPath;
    const capturedOwnerKey = ownerKey;
    if (!enabled || !capturedRootPath) return false;
    const sequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = sequence;
    update({ busy: true, error: null });
    try {
      const routes = await gateway.inspectNetteWorkspaceRoutes(
        capturedRootPath,
        overlaysRef.current,
      );
      if (!isCurrent(capturedOwnerKey, sequence)) return false;
      update({ busy: false, error: null, routes });
      return routes.status === "ok";
    } catch {
      if (!isCurrent(capturedOwnerKey, sequence)) return false;
      update({ busy: false, error: "Could not inspect the Nette routes." });
      return false;
    }
  }, [enabled, gateway, isCurrent, ownerKey, rootPath, update]);

  const refresh = useCallback((): Promise<boolean> => {
    const active = activeRefreshRef.current;
    if (active) {
      queuedRefreshRef.current = true;
      return active.then(() => false);
    }
    const request = runInspection();
    activeRefreshRef.current = request;
    void request.finally(() => {
      if (activeRefreshRef.current === request) activeRefreshRef.current = null;
      if (!queuedRefreshRef.current) return;
      queuedRefreshRef.current = false;
      void refreshRunnerRef.current();
    });
    return request;
  }, [runInspection]);
  refreshRunnerRef.current = refresh;

  useEffect(() => {
    if (enabled && rootPath) void refresh();
  }, [discoveryVersion, enabled, refresh, rootPath]);

  const previousOverlayRef = useRef({ ownerKey, revision: overlayRevision });
  useEffect(() => {
    const previous = previousOverlayRef.current;
    previousOverlayRef.current = { ownerKey, revision: overlayRevision };
    if (
      !enabled ||
      !rootPath ||
      previous.ownerKey !== ownerKey ||
      previous.revision === overlayRevision
    )
      return;
    const timeout = window.setTimeout(() => void refresh(), OVERLAY_REFRESH_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [enabled, overlayRevision, ownerKey, refresh, rootPath]);

  const navigate = useCallback(
    async (operation: (guard: () => boolean) => Promise<boolean> | boolean) => {
      const capturedOwnerKey = ownerKey;
      if (!enabled || !rootPath) return false;
      const shouldCommit = () => isCurrent(capturedOwnerKey);
      update({ error: null });
      try {
        const opened = await operation(shouldCommit);
        return shouldCommit() && opened;
      } catch {
        if (shouldCommit()) update({ error: "Could not open the Nette route declaration." });
        return false;
      }
    },
    [enabled, isCurrent, ownerKey, rootPath, update],
  );
  const openDefinition = useCallback(
    (route: NetteWorkspaceRoute) => navigate((guard) => onOpenDefinition(route.source, guard)),
    [navigate, onOpenDefinition],
  );
  const openTarget = useCallback(
    (route: NetteWorkspaceRoute) =>
      route.target
        ? navigate((guard) => onOpenTarget(route.target as NonNullable<typeof route.target>, guard))
        : Promise.resolve(false),
    [navigate, onOpenTarget],
  );
  const onQueryChange = useCallback((query: string) => update({ query }), [update]);
  const filteredRoutes = useMemo(
    () => (state.routes.status === "ok" ? filterRoutes(state.routes.routes, state.query) : []),
    [state.query, state.routes],
  );

  return {
    busy: state.busy,
    error: state.error,
    filteredRoutes,
    onOpenDefinition: openDefinition,
    onOpenTarget: openTarget,
    onQueryChange,
    onRefresh: refresh,
    query: state.query,
    routes: state.routes,
  };
}

function routeOverlayRevision(overlays: readonly NetteWorkspaceRouteOverlay[]): string {
  return overlays
    .map(({ path, source }) => `${path.length}:${path}${source.length}:${source}`)
    .join("|");
}

function emptyState(ownerKey: string): StoredState {
  return { busy: false, error: null, ownerKey, query: "", routes: NO_WORKSPACE };
}

function filterRoutes(
  routes: readonly NetteWorkspaceRoute[],
  query: string,
): NetteWorkspaceRoute[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [...routes];
  return routes.filter((route) =>
    [
      route.mask,
      ...route.methods,
      route.target?.raw,
      route.target?.presenter,
      route.target?.action,
      route.source.path,
    ].some((value) => value?.toLocaleLowerCase().includes(normalized)),
  );
}
