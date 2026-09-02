import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  isSkippedAppUpdateVersion,
  initialAppUpdaterState,
  reduceAppUpdaterState,
  type AppUpdateCandidate,
  type AppUpdaterAction,
  type AppUpdaterGateway,
  type AppUpdaterPreferencesGateway,
  type AppUpdaterState,
} from "../domain/appUpdater";

export interface AppUpdaterSurface {
  readonly state: AppUpdaterState;
  check(): Promise<void>;
  download(): Promise<void>;
  dismiss(): void;
  installAndRestart(): Promise<void>;
  skipVersion(): Promise<void>;
}

export interface UseAppUpdaterOptions {
  readonly currentVersion: string;
  readonly gateway: AppUpdaterGateway;
  readonly preferencesGateway: AppUpdaterPreferencesGateway;
  readonly scheduleAfterUiInteractive?: (task: () => void) => () => void;
  readonly logStartupFailure?: (message: string) => void;
  readonly persistSkippedVersion: (version: string) => Promise<void>;
}

export function useAppUpdater({
  currentVersion,
  gateway,
  preferencesGateway,
  scheduleAfterUiInteractive = defaultUiInteractiveScheduler,
  logStartupFailure = defaultStartupFailureLogger,
  persistSkippedVersion,
}: UseAppUpdaterOptions): AppUpdaterSurface {
  const [state, setState] = useState(() => initialAppUpdaterState(currentVersion));
  const stateRef = useRef(state);
  const candidateRef = useRef<AppUpdateCandidate | null>(null);
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  const authorityRef = useRef({ currentVersion, gateway, preferencesGateway });

  const publish = useCallback((action: AppUpdaterAction) => {
    const next = reduceAppUpdaterState(stateRef.current, action);
    stateRef.current = next;
    setState(next);
  }, []);

  useLayoutEffect(() => {
    if (
      authorityRef.current.gateway === gateway &&
      authorityRef.current.preferencesGateway === preferencesGateway &&
      authorityRef.current.currentVersion === currentVersion
    ) {
      return;
    }
    const previousOwner = authorityRef.current;
    authorityRef.current = { currentVersion, gateway, preferencesGateway };
    generationRef.current += 1;
    candidateRef.current = null;
    publish({ kind: "reset", currentVersion });
    void disposeGateway(previousOwner.gateway);
  }, [currentVersion, gateway, preferencesGateway, publish]);

  const performCheck = useCallback(
    async (intent: "manual" | "startup") => {
      const generation = nextGeneration(generationRef);
      const owner = authorityRef.current;
      candidateRef.current = null;
      publish({ kind: "checkStarted", generation });
      try {
        let skippedVersion: string | null = null;
        if (intent === "startup") {
          try {
            skippedVersion = await owner.preferencesGateway.loadSkippedVersion();
          } catch {
            logStartupFailure("Application update skip preference could not be read.");
          }
        }
        if (!ownsRequest(owner, generation, authorityRef, generationRef, mountedRef)) return;
        const result = await owner.gateway.check();
        if (!ownsRequest(owner, generation, authorityRef, generationRef, mountedRef)) return;
        if (
          result.kind === "available" &&
          isSkippedAppUpdateVersion(result.candidate, skippedVersion)
        ) {
          await owner.gateway.dispose();
          if (!ownsRequest(owner, generation, authorityRef, generationRef, mountedRef)) return;
          publish({ kind: "dismissed" });
          return;
        }
        if (result.kind === "available") candidateRef.current = result.candidate;
        publish({ kind: "checkSettled", generation, result });
      } catch {
        if (!ownsRequest(owner, generation, authorityRef, generationRef, mountedRef)) return;
        if (intent === "startup") {
          publish({ kind: "dismissed" });
          logStartupFailure("Application update check failed during startup.");
          return;
        }
        publish({
          kind: "failed",
          generation,
          operation: "check",
          message: "Unable to check for application updates.",
        });
      }
    },
    [logStartupFailure, publish],
  );

  useEffect(() => {
    mountedRef.current = true;
    const cancelStartupCheck = scheduleAfterUiInteractive(() => {
      void performCheck("startup");
    });
    return () => {
      cancelStartupCheck();
      mountedRef.current = false;
      generationRef.current += 1;
      candidateRef.current = null;
      void disposeGateway(authorityRef.current.gateway);
    };
  }, [performCheck, scheduleAfterUiInteractive]);

  const check = useCallback(async () => {
    await performCheck("manual");
  }, [performCheck]);

  const dismiss = useCallback(() => {
    generationRef.current += 1;
    candidateRef.current = null;
    publish({ kind: "dismissed" });
    void disposeGateway(authorityRef.current.gateway);
  }, [publish]);

  const skipVersion = useCallback(async () => {
    const candidate = candidateRef.current;
    if (!candidate || stateRef.current.kind !== "available") return;
    const generation = generationRef.current;
    const owner = authorityRef.current;
    try {
      await persistSkippedVersion(candidate.version);
    } catch {
      logStartupFailure("Application update skip preference could not be saved.");
      return;
    }
    if (
      !ownsCandidate(
        owner,
        candidate,
        generation,
        authorityRef,
        candidateRef,
        generationRef,
        mountedRef,
      )
    ) {
      return;
    }
    dismiss();
  }, [dismiss, logStartupFailure, persistSkippedVersion]);

  const download = useCallback(async () => {
    const candidate = candidateRef.current;
    if (!candidate || stateRef.current.kind !== "available") return;
    const generation = nextGeneration(generationRef);
    const owner = authorityRef.current;
    publish({ kind: "downloadStarted", generation });
    try {
      await owner.gateway.download(candidate.candidateRevision);
      if (
        !ownsCandidate(
          owner,
          candidate,
          generation,
          authorityRef,
          candidateRef,
          generationRef,
          mountedRef,
        )
      )
        return;
      publish({ kind: "downloadSettled", generation });
    } catch {
      if (
        !ownsCandidate(
          owner,
          candidate,
          generation,
          authorityRef,
          candidateRef,
          generationRef,
          mountedRef,
        )
      )
        return;
      candidateRef.current = null;
      await disposeGateway(owner.gateway);
      if (!ownsRequest(owner, generation, authorityRef, generationRef, mountedRef)) return;
      publish({
        kind: "failed",
        generation,
        operation: "download",
        message: "Unable to download the application update.",
      });
    }
  }, [publish]);

  const installAndRestart = useCallback(async () => {
    const candidate = candidateRef.current;
    if (!candidate || stateRef.current.kind !== "readyToInstall") return;
    const generation = nextGeneration(generationRef);
    const owner = authorityRef.current;
    publish({ kind: "installStarted", generation });
    try {
      await owner.gateway.installAndRestart(candidate.candidateRevision);
      if (
        !ownsCandidate(
          owner,
          candidate,
          generation,
          authorityRef,
          candidateRef,
          generationRef,
          mountedRef,
        )
      )
        return;
      candidateRef.current = null;
    } catch {
      if (
        !ownsCandidate(
          owner,
          candidate,
          generation,
          authorityRef,
          candidateRef,
          generationRef,
          mountedRef,
        )
      )
        return;
      candidateRef.current = null;
      await disposeGateway(owner.gateway);
      if (!ownsRequest(owner, generation, authorityRef, generationRef, mountedRef)) return;
      publish({
        kind: "failed",
        generation,
        operation: "installAndRestart",
        message: "Unable to install the application update.",
      });
    }
  }, [publish]);

  return { state, check, dismiss, download, installAndRestart, skipVersion };
}

type Authority = Pick<UseAppUpdaterOptions, "currentVersion" | "gateway" | "preferencesGateway">;
type Ref<T> = { current: T };

function nextGeneration(generationRef: Ref<number>): number {
  generationRef.current += 1;
  return generationRef.current;
}

async function disposeGateway(gateway: AppUpdaterGateway): Promise<void> {
  try {
    await gateway.dispose();
  } catch {
    return;
  }
}

function defaultUiInteractiveScheduler(task: () => void): () => void {
  const timer = window.setTimeout(task, 0);
  return () => window.clearTimeout(timer);
}

function defaultStartupFailureLogger(message: string): void {
  console.info(`[app-updater] ${message.slice(0, 160)}`);
}

function ownsRequest(
  owner: Authority,
  generation: number,
  authorityRef: Ref<Authority>,
  generationRef: Ref<number>,
  mountedRef: Ref<boolean>,
): boolean {
  if (!mountedRef.current) return false;
  if (authorityRef.current !== owner) return false;
  return generationRef.current === generation;
}

function ownsCandidate(
  owner: Authority,
  candidate: AppUpdateCandidate,
  generation: number,
  authorityRef: Ref<Authority>,
  candidateRef: Ref<AppUpdateCandidate | null>,
  generationRef: Ref<number>,
  mountedRef: Ref<boolean>,
): boolean {
  if (!ownsRequest(owner, generation, authorityRef, generationRef, mountedRef)) return false;
  return candidateRef.current === candidate;
}
