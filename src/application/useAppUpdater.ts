import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  initialAppUpdaterState,
  reduceAppUpdaterState,
  type AppUpdateCandidate,
  type AppUpdaterAction,
  type AppUpdaterGateway,
  type AppUpdaterState,
} from "../domain/appUpdater";

export interface AppUpdaterSurface {
  readonly state: AppUpdaterState;
  check(): Promise<void>;
  download(): Promise<void>;
  installAndRestart(): Promise<void>;
}

export interface UseAppUpdaterOptions {
  readonly currentVersion: string;
  readonly gateway: AppUpdaterGateway;
}

export function useAppUpdater({
  currentVersion,
  gateway,
}: UseAppUpdaterOptions): AppUpdaterSurface {
  const [state, setState] = useState(() => initialAppUpdaterState(currentVersion));
  const stateRef = useRef(state);
  const candidateRef = useRef<AppUpdateCandidate | null>(null);
  const generationRef = useRef(0);
  const mountedRef = useRef(true);
  const authorityRef = useRef({ currentVersion, gateway });

  const publish = useCallback((action: AppUpdaterAction) => {
    const next = reduceAppUpdaterState(stateRef.current, action);
    stateRef.current = next;
    setState(next);
  }, []);

  useLayoutEffect(() => {
    if (
      authorityRef.current.gateway === gateway &&
      authorityRef.current.currentVersion === currentVersion
    ) {
      return;
    }
    const previousOwner = authorityRef.current;
    authorityRef.current = { currentVersion, gateway };
    generationRef.current += 1;
    candidateRef.current = null;
    publish({ kind: "reset", currentVersion });
    void disposeGateway(previousOwner.gateway);
  }, [currentVersion, gateway, publish]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      candidateRef.current = null;
      void disposeGateway(authorityRef.current.gateway);
    };
  }, []);

  const check = useCallback(async () => {
    const generation = nextGeneration(generationRef);
    const owner = authorityRef.current;
    candidateRef.current = null;
    publish({ kind: "checkStarted", generation });
    try {
      const result = await owner.gateway.check();
      if (!ownsRequest(owner, generation, authorityRef, generationRef, mountedRef)) return;
      if (result.kind === "available") candidateRef.current = result.candidate;
      publish({ kind: "checkSettled", generation, result });
    } catch {
      if (!ownsRequest(owner, generation, authorityRef, generationRef, mountedRef)) return;
      publish({
        kind: "failed",
        generation,
        operation: "check",
        message: "Unable to check for application updates.",
      });
    }
  }, [publish]);

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
      publish({
        kind: "failed",
        generation,
        operation: "installAndRestart",
        message: "Unable to install the application update.",
      });
    }
  }, [publish]);

  return { state, check, download, installAndRestart };
}

type Authority = UseAppUpdaterOptions;
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
