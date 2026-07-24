import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  NetteWorkspacePresenter,
  NetteWorkspacePresenterAction,
  NetteWorkspacePresenterMethod,
  NetteWorkspacePresenterSignal,
  NetteWorkspacePresentersResult,
  NetteWorkspaceTemplateSource,
} from "../domain/netteWorkspacePresenters";
import type {
  NetteWorkspacePresenterOverlay,
  NetteWorkspacePresentersGateway,
} from "../domain/netteWorkspacePresentersGateway";
import type {
  NettePresenterMethodNavigation,
  NettePresenterNavigation,
  NettePresenterTemplateNavigation,
  NetteWorkspacePresenterMatch,
  NetteWorkspacePresentersPanelModel,
} from "./netteWorkspacePresentersPanelModel";

const NO_WORKSPACE = { status: "unavailable", message: "No Nette workspace is active." } as const;
const OVERLAY_REFRESH_DELAY_MS = 200;

interface StoredPanelState {
  readonly busy: boolean;
  readonly error: string | null;
  readonly ownerKey: string;
  readonly presenters: NetteWorkspacePresentersResult;
  readonly query: string;
}

export interface UseNetteWorkspacePresentersPanelControllerOptions {
  readonly discoveryVersion: number;
  readonly enabled: boolean;
  readonly gateway: NetteWorkspacePresentersGateway;
  readonly onOpenMethod: NettePresenterMethodNavigation;
  readonly onOpenPresenter: NettePresenterNavigation;
  readonly onOpenTemplate: NettePresenterTemplateNavigation;
  readonly overlays: readonly NetteWorkspacePresenterOverlay[];
  readonly rootPath: string | null;
}

export function useNetteWorkspacePresentersPanelController({
  discoveryVersion,
  enabled,
  gateway,
  onOpenMethod,
  onOpenPresenter,
  onOpenTemplate,
  overlays,
  rootPath,
}: UseNetteWorkspacePresentersPanelControllerOptions): NetteWorkspacePresentersPanelModel {
  const ownerKey = rootPath ?? "";
  const [stored, setStored] = useState<StoredPanelState>(() => emptyState(ownerKey));
  const state = stored.ownerKey === ownerKey ? stored : emptyState(ownerKey);
  const ownerRef = useRef({ enabled, ownerKey });
  ownerRef.current = { enabled, ownerKey };
  const overlaysRef = useRef(overlays);
  overlaysRef.current = overlays;
  const overlayRevision = useMemo(() => presenterOverlayRevision(overlays), [overlays]);
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
      const presenters = await gateway.inspectNetteWorkspacePresenters(
        capturedRootPath,
        overlaysRef.current,
      );
      if (!isCurrent(capturedOwnerKey, sequence)) return false;
      update({ busy: false, error: null, presenters });
      return presenters.status === "ok";
    } catch {
      if (!isCurrent(capturedOwnerKey, sequence)) return false;
      update({ busy: false, error: "Could not inspect the Nette presenters." });
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
    async (operation: (guard: () => boolean) => Promise<boolean> | boolean) => {
      const capturedOwnerKey = ownerKey;
      if (!enabled || !rootPath) return false;
      const shouldCommit = () => isCurrent(capturedOwnerKey);
      update({ error: null });
      try {
        const opened = await operation(shouldCommit);
        return shouldCommit() && opened;
      } catch {
        if (shouldCommit()) update({ error: "Could not open the Nette presenter declaration." });
        return false;
      }
    },
    [enabled, isCurrent, ownerKey, rootPath, update],
  );

  const openPresenter = useCallback(
    (presenter: NetteWorkspacePresenter) =>
      navigate((shouldCommit) => onOpenPresenter(presenter, shouldCommit)),
    [navigate, onOpenPresenter],
  );
  const openMethod = useCallback(
    (method: NetteWorkspacePresenterMethod) =>
      navigate((shouldCommit) => onOpenMethod(method, shouldCommit)),
    [navigate, onOpenMethod],
  );
  const openTemplate = useCallback(
    (template: NetteWorkspaceTemplateSource) =>
      navigate((shouldCommit) => onOpenTemplate(template, shouldCommit)),
    [navigate, onOpenTemplate],
  );
  const onQueryChange = useCallback((query: string) => update({ query }), [update]);
  const filteredPresenters = useMemo(
    () =>
      state.presenters.status === "ok"
        ? filterPresenters(state.presenters.presenters, state.query)
        : [],
    [state.presenters, state.query],
  );

  return {
    busy: state.busy,
    error: state.error,
    filteredPresenters,
    onOpenMethod: openMethod,
    onOpenPresenter: openPresenter,
    onOpenTemplate: openTemplate,
    onQueryChange,
    onRefresh: refresh,
    presenters: state.presenters,
    query: state.query,
  };
}

function presenterOverlayRevision(overlays: readonly NetteWorkspacePresenterOverlay[]): string {
  return overlays
    .map(({ path, source }) => `${path.length}:${path}${source.length}:${source}`)
    .join("|");
}

function emptyState(ownerKey: string): StoredPanelState {
  return { busy: false, error: null, ownerKey, presenters: NO_WORKSPACE, query: "" };
}

function filterPresenters(
  presenters: readonly NetteWorkspacePresenter[],
  query: string,
): NetteWorkspacePresenterMatch[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) {
    return presenters.map((presenter) => ({
      actions: presenter.actions,
      presenter,
      signals: presenter.signals,
    }));
  }

  return presenters.flatMap((presenter) => {
    const presenterMatches = matches(
      [presenter.name, presenter.className, presenter.source.path],
      normalized,
    );
    const actions = presenterMatches
      ? presenter.actions
      : presenter.actions.filter((action) => actionMatches(action, normalized));
    const signals = presenterMatches
      ? presenter.signals
      : presenter.signals.filter((signal) => signalMatches(signal, normalized));
    return presenterMatches || actions.length > 0 || signals.length > 0
      ? [{ actions, presenter, signals }]
      : [];
  });
}

function actionMatches(action: NetteWorkspacePresenterAction, query: string): boolean {
  return matches(
    [
      action.name,
      action.actionMethod?.methodName,
      action.renderMethod?.methodName,
      ...action.templates.map((template) => template.path),
    ],
    query,
  );
}

function signalMatches(signal: NetteWorkspacePresenterSignal, query: string): boolean {
  return matches([signal.name, signal.method.methodName, signal.method.source.path], query);
}

function matches(values: readonly (string | null | undefined)[], query: string): boolean {
  return values.some((value) => value?.toLocaleLowerCase().includes(query));
}
