import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AppUpdateChannel } from "../domain/appUpdateChannel";
import {
  isSkippedAppUpdateVersion,
  initialAppUpdaterState,
  reduceAppUpdaterState,
  type AppUpdateCandidate,
  type AppUpdateCheckResult,
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
  readonly channel: AppUpdateChannel;
  readonly currentVersion: string;
  readonly gateway: AppUpdaterGateway;
  readonly preferencesGateway: AppUpdaterPreferencesGateway;
  readonly scheduleAfterUiInteractive?: (task: () => void) => () => void;
  readonly logStartupFailure?: (message: string) => void;
  readonly persistSkippedVersion: (version: string) => Promise<void>;
  readonly settingsHydrated: boolean;
}

export function useAppUpdater({
  channel,
  currentVersion,
  gateway,
  preferencesGateway,
  scheduleAfterUiInteractive = defaultUiInteractiveScheduler,
  logStartupFailure = defaultStartupFailureLogger,
  persistSkippedVersion,
  settingsHydrated,
}: UseAppUpdaterOptions): AppUpdaterSurface {
  const [state, setState] = useState(() => initialAppUpdaterState(currentVersion));
  const stateRef = useRef(state);
  const candidateRef = useRef<AppUpdateCandidate | null>(null);
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  const startupCheckStartedRef = useRef(false);
  const authorityRef = useRef({ channel, currentVersion, gateway, preferencesGateway });

  const publish = useCallback((action: AppUpdaterAction) => {
    const next = reduceAppUpdaterState(stateRef.current, action);
    stateRef.current = next;
    setState(next);
  }, []);

  useLayoutEffect(() => {
    if (
      authorityRef.current.channel === channel &&
      authorityRef.current.gateway === gateway &&
      authorityRef.current.preferencesGateway === preferencesGateway &&
      authorityRef.current.currentVersion === currentVersion
    ) {
      return;
    }
    const previousOwner = authorityRef.current;
    authorityRef.current = { channel, currentVersion, gateway, preferencesGateway };
    generationRef.current += 1;
    candidateRef.current = null;
    publish({ kind: "reset", currentVersion });
    void disposeGateway(previousOwner.gateway);
  }, [channel, currentVersion, gateway, preferencesGateway, publish]);

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
        const result = await owner.gateway.check(owner.channel);
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
        candidateRef.current = checkResultCandidate(result);
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
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      candidateRef.current = null;
      void disposeGateway(authorityRef.current.gateway);
    };
  }, []);

  useEffect(() => {
    if (!settingsHydrated || startupCheckStartedRef.current) return;
    return scheduleAfterUiInteractive(() => {
      startupCheckStartedRef.current = true;
      void performCheck("startup");
    });
  }, [performCheck, scheduleAfterUiInteractive, settingsHydrated]);

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
      const preparation = await owner.gateway.download(candidate.candidateRevision);
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
      publish({ kind: "downloadSettled", generation, preparation });
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
        message: "Unable to prepare the application update.",
      });
    }
  }, [publish]);

  const installAndRestart = useCallback(async () => {
    const candidate = candidateRef.current;
    if (!candidate) return;
    const readiness = stateRef.current.kind;
    if (
      readiness !== "readyToInstall" &&
      readiness !== "readyToRestart" &&
      readiness !== "readyToRestartOutdated"
    ) {
      return;
    }
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
        message:
          readiness === "readyToInstall"
            ? "Unable to install the application update."
            : "The update is installed. Quit and reopen Codevo to use it.",
      });
    }
  }, [publish]);

  return { state, check, dismiss, download, installAndRestart, skipVersion };
}

type Authority = Pick<
  UseAppUpdaterOptions,
  "channel" | "currentVersion" | "gateway" | "preferencesGateway"
>;
type Ref<T> = { current: T };

function checkResultCandidate(result: AppUpdateCheckResult): AppUpdateCandidate | null {
  switch (result.kind) {
    case "upToDate":
    case "noRelease":
      return null;
    case "available":
    case "readyToRestart":
    case "readyToRestartOutdated":
      return result.candidate;
  }
}

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
