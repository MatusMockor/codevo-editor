import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef } from "react";
import { AGENT_TURN_LOG_QUIT_FLUSH_BUDGET_MS } from "../agentTurnLogPorts";
import { flushSessionRestore } from "../sessionRestorePersistence";

export type NativeCloseKind = "close" | "quit";

const NATIVE_CLOSE_REQUEST_EVENT = "mockor-native-close-requested";

export interface AgentNativeShutdownPort {
  readonly available: () => boolean;
  readonly confirmShutdown: (kind: NativeCloseKind) => Promise<void>;
  readonly listenCloseRequests: (handler: (payload: unknown) => void) => Promise<() => void>;
  readonly quit: () => Promise<void>;
  readonly setCloseListenerReady: (ready: boolean) => Promise<void>;
}

export const tauriAgentNativeShutdownPort: AgentNativeShutdownPort = {
  available: () => isTauri(),
  confirmShutdown: (kind) => invoke("confirm_native_shutdown", { kind }),
  listenCloseRequests: (handler) =>
    listen<unknown>(NATIVE_CLOSE_REQUEST_EVENT, (event) => handler(event.payload)),
  quit: () => invoke("quit_application"),
  setCloseListenerReady: (ready) => invoke("set_native_close_listener_ready", { ready }),
};

const AGENT_QUIT_PREPARATION_MARGIN_MS = 250;

export const AGENT_QUIT_PREPARATION_TIMEOUT_MS =
  AGENT_TURN_LOG_QUIT_FLUSH_BUDGET_MS + AGENT_QUIT_PREPARATION_MARGIN_MS;

type CloseScopeGuard = () => boolean;
type ShutdownCommit = (scopeIsCurrent: CloseScopeGuard) => Promise<boolean>;

export interface AgentApplicationShutdownOptions {
  readonly nativeShutdown?: AgentNativeShutdownPort;
  readonly prepareAgentQuit: (budgetMs: number) => Promise<void>;
  readonly reportError: (source: string, error: unknown) => void;
}

export function useAgentApplicationShutdown({
  nativeShutdown = tauriAgentNativeShutdownPort,
  prepareAgentQuit,
  reportError,
}: AgentApplicationShutdownOptions) {
  const activeRef = useRef(true);
  const shutdownInFlightRef = useRef(false);
  const nativeCloseRequestRef = useRef<(payload: unknown) => void>(() => undefined);

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  const prepareShutdownWhileWindowIsAlive = useCallback(
    async (scopeIsCurrent: CloseScopeGuard): Promise<boolean> => {
      flushSessionRestore();
      await settleWithinBudget(
        () => prepareAgentQuit(AGENT_TURN_LOG_QUIT_FLUSH_BUDGET_MS),
        AGENT_QUIT_PREPARATION_TIMEOUT_MS,
        (error) => reportError("Agent", error),
      );
      return scopeIsCurrent();
    },
    [prepareAgentQuit, reportError],
  );

  const confirmNativeShutdown = useCallback(
    async (kind: NativeCloseKind, scopeIsCurrent: CloseScopeGuard): Promise<boolean> => {
      if (!(await prepareShutdownWhileWindowIsAlive(scopeIsCurrent))) return false;
      flushSessionRestore();
      await nativeShutdown.confirmShutdown(kind);
      return true;
    },
    [nativeShutdown, prepareShutdownWhileWindowIsAlive],
  );

  const requestApplicationShutdown = useCallback(
    (shutdown: ShutdownCommit, errorSource: string) => {
      if (shutdownInFlightRef.current) return;
      shutdownInFlightRef.current = true;
      void shutdown(() => activeRef.current)
        .then((committed) => {
          if (!committed) shutdownInFlightRef.current = false;
        })
        .catch((error) => {
          shutdownInFlightRef.current = false;
          reportError(errorSource, error);
        });
    },
    [reportError],
  );

  nativeCloseRequestRef.current = (payload) => {
    if (!isNativeCloseKind(payload)) {
      reportError("Application", new Error("Invalid native close request"));
      return;
    }
    requestApplicationShutdown(
      (scopeIsCurrent) => confirmNativeShutdown(payload, scopeIsCurrent),
      "Application",
    );
  };

  useEffect(() => {
    if (!nativeShutdown.available()) return;
    let active = true;
    let unlisten: (() => void) | null = null;
    nativeShutdown
      .listenCloseRequests((payload) => nativeCloseRequestRef.current(payload))
      .then(async (dispose) => {
        if (!active) {
          dispose();
          return;
        }
        unlisten = dispose;
        try {
          await nativeShutdown.setCloseListenerReady(true);
          if (!active) await nativeShutdown.setCloseListenerReady(false);
        } catch (error) {
          dispose();
          unlisten = null;
          throw error;
        }
      })
      .catch((error) => reportError("Application", error));
    return () => {
      active = false;
      unlisten?.();
      if (!unlisten) return;
      void nativeShutdown
        .setCloseListenerReady(false)
        .catch((error) => reportError("Application", error));
    };
  }, [nativeShutdown, reportError]);

  const quitApplication = useCallback(() => {
    if (!nativeShutdown.available()) return;
    requestApplicationShutdown(async (scopeIsCurrent) => {
      if (!(await prepareShutdownWhileWindowIsAlive(scopeIsCurrent))) return false;
      flushSessionRestore();
      await nativeShutdown.quit();
      return true;
    }, "Application");
  }, [nativeShutdown, prepareShutdownWhileWindowIsAlive, requestApplicationShutdown]);

  const closeApplicationWindow = useCallback(() => {
    if (!nativeShutdown.available()) return;
    requestApplicationShutdown(
      (scopeIsCurrent) => confirmNativeShutdown("close", scopeIsCurrent),
      "Window",
    );
  }, [confirmNativeShutdown, nativeShutdown, requestApplicationShutdown]);

  return { closeApplicationWindow, quitApplication };
}

function isNativeCloseKind(payload: unknown): payload is NativeCloseKind {
  return payload === "close" || payload === "quit";
}

function settleWithinBudget(
  operation: () => Promise<void>,
  budgetMs: number,
  onFailure: (error: unknown) => void,
): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, budgetMs);
    const settle = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const fail = (error: unknown): void => {
      onFailure(error);
      settle();
    };
    let pending: Promise<void>;
    try {
      pending = operation();
    } catch (error) {
      fail(error);
      return;
    }
    pending.then(settle, fail);
  });
}
