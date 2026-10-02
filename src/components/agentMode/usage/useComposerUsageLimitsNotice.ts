import { useCallback, useMemo, useState } from "react";
import type { AgentAccountUsageWindow } from "../../../domain/agentAccountUsage";
import { isAgentAccountUsageWindowExpired } from "../../../domain/agentAccountUsageFreshness";
import {
  representableResetEpochMs,
  USAGE_HOT_PERCENT,
  type UsageAccountStates,
  type UsageProviderKind,
} from "../../usage/usagePresentation";

const PROVIDERS: ReadonlyArray<UsageProviderKind> = ["claudeCode", "codex"];
const NO_KEYS: ReadonlySet<string> = new Set();

export interface ComposerUsageLimitsEntry {
  readonly provider: UsageProviderKind;
  readonly observedAtEpochMs: number;
  readonly windows: ReadonlyArray<AgentAccountUsageWindow>;
}

export interface ComposerUsageLimitsNotice {
  readonly providers: ReadonlyArray<ComposerUsageLimitsEntry>;
  readonly visible: boolean;
  dismiss(): void;
  show(): void;
}

export function useComposerUsageLimitsNotice(
  accountUsage: UsageAccountStates | undefined,
  now: () => number = Date.now,
): ComposerUsageLimitsNotice {
  const providers = useMemo(() => readyProviders(accountUsage), [accountUsage]);
  const snapshotKey = useMemo(() => snapshotKeyOf(accountUsage), [accountUsage]);
  const hotKeys = useMemo(() => hotWindowKeys(providers, now()), [providers, now]);
  const [dismissedKeys, setDismissedKeys] = useState<ReadonlySet<string>>(NO_KEYS);
  const [requestedKey, setRequestedKey] = useState<string | null>(null);
  const requested = requestedKey === snapshotKey;
  const undismissedHot = hotKeys.some((key) => !dismissedKeys.has(key));
  const visible = providers.length > 0 && (requested || undismissedHot);
  const show = useCallback(() => {
    setRequestedKey(snapshotKey);
  }, [snapshotKey]);
  const dismiss = useCallback(() => {
    setDismissedKeys(new Set(hotKeys));
    setRequestedKey(null);
  }, [hotKeys]);
  return useMemo(
    () => ({ dismiss, providers, show, visible }),
    [dismiss, providers, show, visible],
  );
}

function readyProviders(
  accountUsage: UsageAccountStates | undefined,
): ReadonlyArray<ComposerUsageLimitsEntry> {
  if (accountUsage === undefined) return [];
  return PROVIDERS.flatMap((provider) => {
    const state = accountUsage[provider];
    if (state.kind !== "ready" || state.snapshot.windows.length === 0) return [];
    return [
      {
        provider,
        observedAtEpochMs: state.snapshot.fetchedAtEpochMs,
        windows: state.snapshot.windows,
      },
    ];
  });
}

function hotWindowKeys(
  providers: ReadonlyArray<ComposerUsageLimitsEntry>,
  nowEpochMs: number,
): ReadonlyArray<string> {
  return providers.flatMap(({ provider, windows }) =>
    windows.flatMap((window) => {
      if (window.usedPercent < USAGE_HOT_PERCENT) return [];
      if (isAgentAccountUsageWindowExpired(window, nowEpochMs)) return [];
      return [windowResetKey(provider, window)];
    }),
  );
}

function windowResetKey(provider: UsageProviderKind, window: AgentAccountUsageWindow): string {
  const resetsAtEpochMs = representableResetEpochMs(window.resetsAtEpochMs);
  const reset =
    resetsAtEpochMs === null ? `label:${window.resetsLabel ?? ""}` : `at:${resetsAtEpochMs}`;
  return JSON.stringify([provider, window.id, reset]);
}

function snapshotKeyOf(accountUsage: UsageAccountStates | undefined): string {
  return PROVIDERS.map((provider) => {
    const state = accountUsage?.[provider];
    if (state?.kind !== "ready") return `${provider}:-`;
    return `${provider}:${state.snapshot.fetchedAtEpochMs}`;
  }).join("|");
}
