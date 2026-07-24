import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  NetteWorkspaceService,
  NetteWorkspaceServicesResult,
} from "../domain/netteWorkspaceServices";
import type {
  NetteWorkspaceServiceOverlay,
  NetteWorkspaceServicesGateway,
} from "../domain/netteWorkspaceServicesGateway";
import {
  type NetteServiceClassNavigation,
  type NetteServiceDefinitionNavigation,
  type NetteWorkspacePanelModel,
} from "./netteWorkspacePanelModel";

const NO_WORKSPACE = { status: "unavailable", message: "No Nette workspace is active." } as const;
const OVERLAY_REFRESH_DELAY_MS = 200;

interface StoredPanelState {
  readonly busy: boolean;
  readonly error: string | null;
  readonly ownerKey: string;
  readonly query: string;
  readonly services: NetteWorkspaceServicesResult;
}

export interface UseNetteWorkspacePanelControllerOptions {
  readonly discoveryVersion: number;
  readonly enabled: boolean;
  readonly gateway: NetteWorkspaceServicesGateway;
  readonly onOpenClass: NetteServiceClassNavigation;
  readonly onOpenSource: NetteServiceDefinitionNavigation;
  readonly overlays: readonly NetteWorkspaceServiceOverlay[];
  readonly rootPath: string | null;
}

export function useNetteWorkspacePanelController({
  discoveryVersion,
  enabled,
  gateway,
  onOpenClass,
  onOpenSource,
  overlays,
  rootPath,
}: UseNetteWorkspacePanelControllerOptions): NetteWorkspacePanelModel {
  const ownerKey = rootPath ?? "";
  const [stored, setStored] = useState<StoredPanelState>(() => emptyState(ownerKey));
  const state = stored.ownerKey === ownerKey ? stored : emptyState(ownerKey);
  const ownerRef = useRef({ enabled, ownerKey });
  ownerRef.current = { enabled, ownerKey };
  const overlaysRef = useRef(overlays);
  overlaysRef.current = overlays;
  const overlayRevision = useMemo(() => netteOverlayRevision(overlays), [overlays]);
  const requestSequenceRef = useRef(0);
  const activeRefreshRef = useRef<Promise<boolean> | null>(null);
  const queuedRefreshRef = useRef(false);
  const refreshRunnerRef = useRef<() => Promise<boolean>>(async () => false);

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
      const services = await gateway.inspectNetteWorkspaceServices(
        capturedRootPath,
        overlaysRef.current,
      );
      if (!isCurrent(capturedOwnerKey, sequence)) return false;
      update({ busy: false, error: null, services });
      return services.status === "ok";
    } catch {
      if (!isCurrent(capturedOwnerKey, sequence)) return false;
      update({ busy: false, error: "Could not inspect the Nette workspace." });
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
    if (!enabled || !rootPath) return;
    void refresh();
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
    ) {
      return;
    }

    const timeout = window.setTimeout(() => void refresh(), OVERLAY_REFRESH_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [enabled, overlayRevision, ownerKey, refresh, rootPath]);

  const navigate = useCallback(
    async (
      operation: (shouldCommit: () => boolean) => Promise<boolean> | boolean,
    ): Promise<boolean> => {
      const capturedOwnerKey = ownerKey;
      if (!enabled || !rootPath) return false;
      const shouldCommit = () => isCurrent(capturedOwnerKey);
      update({ error: null });
      try {
        const opened = await operation(shouldCommit);
        return shouldCommit() && opened;
      } catch {
        if (shouldCommit()) update({ error: "Could not open the Nette declaration." });
        return false;
      }
    },
    [enabled, isCurrent, ownerKey, rootPath, update],
  );

  const onOpenDefinition = useCallback(
    (service: NetteWorkspaceService) =>
      navigate((shouldCommit) => onOpenSource(service.source, shouldCommit)),
    [navigate, onOpenSource],
  );
  const onOpenServiceClass = useCallback(
    (service: NetteWorkspaceService) =>
      service.className
        ? navigate((shouldCommit) => onOpenClass(service, shouldCommit))
        : Promise.resolve(false),
    [navigate, onOpenClass],
  );
  const onQueryChange = useCallback((query: string) => update({ query }), [update]);
  const filteredServices = useMemo(
    () =>
      state.services.status === "ok" ? filterServices(state.services.services, state.query) : [],
    [state.query, state.services],
  );

  return {
    busy: state.busy,
    error: state.error,
    filteredServices,
    onOpenClass: onOpenServiceClass,
    onOpenDefinition,
    onQueryChange,
    onRefresh: refresh,
    query: state.query,
    services: state.services,
  };
}

function netteOverlayRevision(overlays: readonly NetteWorkspaceServiceOverlay[]): string {
  return overlays
    .map(({ path, source }) => `${path.length}:${path}${source.length}:${source}`)
    .join("|");
}

function emptyState(ownerKey: string): StoredPanelState {
  return {
    busy: false,
    error: null,
    ownerKey,
    query: "",
    services: NO_WORKSPACE,
  };
}

function filterServices(
  services: readonly NetteWorkspaceService[],
  query: string,
): NetteWorkspaceService[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [...services];
  return services.filter((service) =>
    [service.id, service.className, service.alias, service.source.path]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLocaleLowerCase().includes(normalized)),
  );
}
