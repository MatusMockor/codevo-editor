import { useCallback, useEffect, useRef, useState } from "react";
import {
  canStartManualAppUpdateCheck,
  manualAppUpdateCheckBlockedReason,
  manualAppUpdateCheckOutcome,
  type ManualAppUpdateCheckOutcome,
} from "../domain/appUpdateCheck";
import type { AppUpdaterSurface } from "./useAppUpdater";

export const APP_UPDATE_CHECK_STATUS_MS = 6000;

export interface CombinedUpdateCheckTargets {
  readonly appUpdater: AppUpdaterSurface | null;
  readonly refreshProviders: (() => Promise<void>) | null;
}

export interface CombinedUpdateCheck {
  readonly appBlockedReason: string | null;
  readonly appCheckable: boolean;
  readonly appOutcome: ManualAppUpdateCheckOutcome | null;
  readonly available: boolean;
  readonly checking: boolean;
  checkAll(): void;
}

export function useCombinedUpdateCheck({
  appUpdater,
  refreshProviders,
}: CombinedUpdateCheckTargets): CombinedUpdateCheck {
  const [pending, setPending] = useState(false);
  const [appRequested, setAppRequested] = useState(false);
  const pendingRef = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const appState = appUpdater?.state ?? null;
  const appBlockedReason = appState === null ? null : manualAppUpdateCheckBlockedReason(appState);
  const appCheckable = appState !== null && appBlockedReason === null;
  const appOutcome =
    appRequested && appState !== null ? manualAppUpdateCheckOutcome(appState) : null;
  const outcomeKind = appOutcome?.kind ?? null;

  useEffect(() => {
    if (outcomeKind === "release") {
      setAppRequested(false);
      return;
    }
    if (outcomeKind !== "upToDate") return;
    const timer = setTimeout(() => setAppRequested(false), APP_UPDATE_CHECK_STATUS_MS);
    return () => clearTimeout(timer);
  }, [outcomeKind]);

  const checkAll = useCallback((): void => {
    if (pendingRef.current) return;
    const checks: Array<Promise<void>> = [];
    if (refreshProviders !== null) checks.push(settle(refreshProviders));
    if (appUpdater !== null && canStartManualAppUpdateCheck(appUpdater.state)) {
      setAppRequested(true);
      checks.push(settle(appUpdater.check));
    }
    if (checks.length === 0) return;
    pendingRef.current = true;
    setPending(true);
    void Promise.allSettled(checks).then(() => {
      pendingRef.current = false;
      if (!mounted.current) return;
      setPending(false);
    });
  }, [appUpdater, refreshProviders]);

  return {
    appBlockedReason,
    appCheckable,
    appOutcome,
    available: refreshProviders !== null || appCheckable,
    checking: pending || appState?.kind === "checking",
    checkAll,
  };
}

async function settle(check: () => Promise<void>): Promise<void> {
  await check();
}
