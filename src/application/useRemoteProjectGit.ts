import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  remoteGitErrorMessage,
  type RemoteGitBranchList,
  type RemoteGitCheckoutStatus,
  type RemoteGitErrorCode,
  type RemoteGitOperationOutcome,
  type RemoteGitProjectKey,
  type RemoteGitSyncPort,
} from "../domain/remoteGitSync";
import { attempt, errorMessageOf } from "./agentProjectAuthority";

export const REMOTE_PROJECT_GIT_UNCONFIRMED =
  "The server did not confirm the result. The Git status was refreshed.";

export type RemoteGitLoad<T> =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "loading"; value: T | null }>
  | Readonly<{ kind: "ready"; value: T }>
  | Readonly<{ kind: "failed"; value: T | null; message: string }>;

export type RemoteProjectGitAction = "fetch" | "update";

export type RemoteProjectGitNetwork =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "running"; action: RemoteProjectGitAction }>
  | Readonly<{ kind: "succeeded"; action: RemoteProjectGitAction }>
  | Readonly<{
      kind: "failed";
      action: RemoteProjectGitAction;
      error: RemoteGitErrorCode | null;
      message: string;
    }>;

export interface RemoteProjectGitState {
  readonly branches: RemoteGitLoad<RemoteGitBranchList>;
  readonly checkout: RemoteGitLoad<RemoteGitCheckoutStatus>;
  readonly network: RemoteProjectGitNetwork;
}

export interface RemoteProjectGit extends RemoteProjectGitState {
  refresh(): Promise<void>;
  fetch(): Promise<void>;
  update(): Promise<void>;
}

export interface RemoteProjectGitOptions {
  readonly port: RemoteGitSyncPort | null;
  readonly project: RemoteGitProjectKey | null;
}

interface Capture {
  readonly generation: number;
  readonly port: RemoteGitSyncPort;
  readonly project: RemoteGitProjectKey;
}

const INITIAL: RemoteProjectGitState = Object.freeze({
  branches: { kind: "idle" } as const,
  checkout: { kind: "idle" } as const,
  network: { kind: "idle" } as const,
});

function previous<T>(load: RemoteGitLoad<T>): T | null {
  return load.kind === "idle" ? null : load.value;
}

function projectKey(project: RemoteGitProjectKey | null): string | null {
  return project === null
    ? null
    : JSON.stringify([project.serverId, project.runnerId, project.projectId]);
}

function networkOutcome(
  action: RemoteProjectGitAction,
  outcome: RemoteGitOperationOutcome,
): RemoteProjectGitNetwork | null {
  switch (outcome.kind) {
    case "succeeded":
      return { kind: "succeeded", action };
    case "failed":
      return {
        kind: "failed",
        action,
        error: outcome.error,
        message: remoteGitErrorMessage(outcome.error),
      };
    case "unknown":
    case "timedOut":
      return { kind: "failed", action, error: null, message: REMOTE_PROJECT_GIT_UNCONFIRMED };
    case "aborted":
      return null;
    default:
      return unsupported(outcome);
  }
}

export function useRemoteProjectGit(options: RemoteProjectGitOptions): RemoteProjectGit {
  const [state, setState] = useState<RemoteProjectGitState>(INITIAL);
  const key = projectKey(options.project);
  const latest = useRef(options);
  const generation = useRef(0);
  const mounted = useRef(true);
  const network = useRef<AbortController | null>(null);
  const sequences = useRef({ branches: 0, checkout: 0 });

  useLayoutEffect(() => {
    latest.current = options;
  });

  useLayoutEffect(() => {
    generation.current += 1;
    network.current?.abort();
    network.current = null;
    setState(INITIAL);
  }, [key, options.port]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      network.current?.abort();
    };
  }, []);

  const capture = useCallback((): Capture | null => {
    const { port, project } = latest.current;
    if (port === null || project === null) return null;
    return { generation: generation.current, port, project };
  }, []);

  const current = useCallback(
    (captured: Capture): boolean =>
      mounted.current &&
      generation.current === captured.generation &&
      latest.current.port === captured.port &&
      projectKey(latest.current.project) === projectKey(captured.project),
    [],
  );

  const publish = useCallback(
    (captured: Capture, change: (state: RemoteProjectGitState) => RemoteProjectGitState) => {
      if (current(captured)) setState(change);
    },
    [current],
  );

  const nextLoad = useCallback((resource: "branches" | "checkout"): (() => boolean) => {
    const sequence = (sequences.current[resource] += 1);
    return () => sequences.current[resource] === sequence;
  }, []);

  const refreshBranches = useCallback(
    async (captured: Capture): Promise<void> => {
      const latestLoad = nextLoad("branches");
      publish(captured, (s) => ({
        ...s,
        branches: { kind: "loading", value: previous(s.branches) },
      }));
      const loaded = await attempt(() => captured.port.branches(captured.project));
      if (!latestLoad()) return;
      publish(captured, (s) => ({
        ...s,
        branches: loaded.ok
          ? { kind: "ready", value: loaded.value }
          : { kind: "failed", value: previous(s.branches), message: errorMessageOf(loaded.error) },
      }));
    },
    [nextLoad, publish],
  );

  const refreshCheckout = useCallback(
    async (captured: Capture): Promise<void> => {
      const latestLoad = nextLoad("checkout");
      publish(captured, (s) => ({
        ...s,
        checkout: { kind: "loading", value: previous(s.checkout) },
      }));
      const loaded = await attempt(() => captured.port.projectStatus(captured.project));
      if (!latestLoad()) return;
      publish(captured, (s) => ({
        ...s,
        checkout: loaded.ok
          ? { kind: "ready", value: loaded.value }
          : { kind: "failed", value: previous(s.checkout), message: errorMessageOf(loaded.error) },
      }));
    },
    [nextLoad, publish],
  );

  const refresh = useCallback(async (): Promise<void> => {
    const captured = capture();
    if (captured === null) return;
    await Promise.all([refreshBranches(captured), refreshCheckout(captured)]);
  }, [capture, refreshBranches, refreshCheckout]);

  const run = useCallback(
    async (action: RemoteProjectGitAction): Promise<void> => {
      const captured = capture();
      if (captured === null || network.current !== null) return;
      const controller = new AbortController();
      network.current = controller;
      setState((s) => ({ ...s, network: { kind: "running", action } }));
      try {
        const start = action === "fetch" ? captured.port.fetch : captured.port.update;
        const admission = await start.call(captured.port, captured.project, crypto.randomUUID());
        if (!current(captured)) return;
        if (admission.kind === "refused") {
          const message = remoteGitErrorMessage(admission.error);
          setState((s) => ({
            ...s,
            network: { kind: "failed", action, error: admission.error, message },
          }));
          return;
        }
        const outcome = await captured.port.awaitOperation(
          captured.project,
          admission.value,
          controller.signal,
        );
        const settled = networkOutcome(action, outcome);
        if (settled === null || !current(captured)) return;
        setState((s) => ({ ...s, network: settled }));
        if (action === "fetch") await refreshBranches(captured);
        await refreshCheckout(captured);
      } catch (error) {
        const message = errorMessageOf(error) || "Remote Git request failed.";
        publish(captured, (s) => ({
          ...s,
          network: { kind: "failed", action, error: null, message },
        }));
      } finally {
        if (network.current === controller) network.current = null;
      }
    },
    [capture, current, publish, refreshBranches, refreshCheckout],
  );

  const fetch = useCallback(() => run("fetch"), [run]);
  const update = useCallback(() => run("update"), [run]);

  return useMemo(() => ({ ...state, refresh, fetch, update }), [state, refresh, fetch, update]);
}

function unsupported(value: never): never {
  throw new TypeError(`Unsupported remote Git outcome: ${JSON.stringify(value)}.`);
}
