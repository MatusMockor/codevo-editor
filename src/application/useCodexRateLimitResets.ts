import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  CODEX_RESET_CONFIRMATION_TIMEOUT_MS,
  parseCodexRateLimitResetPreparation,
  parseCodexRateLimitResetReceipt,
  parseCodexRateLimitResetSnapshot,
  type CodexRateLimitResetDisplaySnapshot,
  type CodexRateLimitResetOutcome,
  type CodexRateLimitResetSnapshot,
} from "../domain/codexRateLimitResets";
import type { CodexRateLimitResetGateway } from "./codexRateLimitResetGateway";

export interface CodexRateLimitResetState {
  readonly status:
    "idle" | "loading" | "ready" | "preparing" | "confirming" | "consuming" | "uncertain" | "error";
  readonly snapshot: CodexRateLimitResetDisplaySnapshot | null;
  readonly outcome: CodexRateLimitResetOutcome | "notApplied" | null;
  readonly error: string | null;
  readonly targetCreditId: string | null;
  readonly intent: "reset" | "retry" | null;
}

interface Options {
  readonly gateway: CodexRateLimitResetGateway | undefined;
  readonly providerGeneration: number | null;
  readonly accountIdentity?: string | null;
  readonly refreshLimits: () => void | Promise<void>;
}

interface Attempt {
  readonly accountIdentity: string;
  readonly idempotencyKey: string;
  confirmation: { readonly token: string; readonly expiresAt: number } | null;
  uncertain: boolean;
}

const INITIAL_STATE: CodexRateLimitResetState = {
  status: "idle",
  snapshot: null,
  outcome: null,
  error: null,
  targetCreditId: null,
  intent: null,
};

export function useCodexRateLimitResets({
  gateway,
  providerGeneration,
  accountIdentity,
  refreshLimits,
}: Options) {
  const lease = useMemo(
    () => ({
      active: false,
      gateway,
      providerGeneration,
      accountIdentity,
      sequence: 0,
      snapshot: null as CodexRateLimitResetSnapshot | null,
      attempt: null as Attempt | null,
      state: INITIAL_STATE,
    }),
    [gateway, providerGeneration, accountIdentity],
  );
  const [published, setPublished] = useState({ lease, state: INITIAL_STATE });
  const refreshLimitsRef = useRef(refreshLimits);
  useLayoutEffect(() => {
    refreshLimitsRef.current = refreshLimits;
  }, [refreshLimits]);

  const publish = useCallback(
    (state: CodexRateLimitResetState) => {
      if (!lease.active) return;
      lease.state = state;
      setPublished({ lease, state });
    },
    [lease],
  );

  const read = useCallback(
    async (sequence: number): Promise<CodexRateLimitResetSnapshot | null> => {
      if (!lease.active || !gateway || providerGeneration === null) return null;
      const snapshot = parseCodexRateLimitResetSnapshot(await gateway.read({ providerGeneration }));
      if (!lease.active || lease.sequence !== sequence) return null;
      if (accountIdentity !== undefined && snapshot.accountIdentity !== accountIdentity) {
        lease.attempt = null;
        lease.snapshot = null;
        throw new Error("Account changed");
      }
      return snapshot;
    },
    [accountIdentity, gateway, lease, providerGeneration],
  );

  const settle = useCallback(
    async (sequence: number, snapshot: CodexRateLimitResetSnapshot, attempt: Attempt) => {
      lease.attempt = null;
      const applied = snapshot.history.some(
        (entry) => entry.operationId === attempt.idempotencyKey,
      );
      publish({
        ...INITIAL_STATE,
        status: "ready",
        snapshot: display(snapshot),
        outcome: applied ? "reset" : "notApplied",
      });
      if (!applied) return;
      try {
        await refreshLimitsRef.current();
      } catch {
        if (!lease.active || lease.sequence !== sequence) return;
        publish({
          ...lease.state,
          error: "Reset result received. Refresh usage to update the displayed limits.",
        });
      }
    },
    [lease, publish],
  );

  const refresh = useCallback(async () => {
    if (
      !lease.active ||
      !gateway ||
      providerGeneration === null ||
      ["preparing", "confirming", "consuming"].includes(lease.state.status)
    )
      return;
    const sequence = ++lease.sequence;
    publish({ ...INITIAL_STATE, status: "loading" });
    try {
      const snapshot = await read(sequence);
      if (!lease.active || lease.sequence !== sequence || !snapshot) return;
      if (lease.attempt && lease.attempt.accountIdentity !== snapshot.accountIdentity)
        lease.attempt = null;
      if (snapshot.accountIdentity && snapshot.pendingOperationId) {
        lease.attempt = {
          accountIdentity: snapshot.accountIdentity,
          idempotencyKey: snapshot.pendingOperationId,
          confirmation: null,
          uncertain: true,
        };
      }
      lease.snapshot = snapshot;
      if (lease.attempt?.uncertain && !snapshot.pendingOperationId) {
        await settle(sequence, snapshot, lease.attempt);
        return;
      }
      publish({
        ...INITIAL_STATE,
        status: lease.attempt ? "uncertain" : "ready",
        snapshot: display(snapshot),
      });
    } catch {
      if (!lease.active || lease.sequence !== sequence) return;
      lease.snapshot = null;
      publish({
        ...INITIAL_STATE,
        status: "error",
        error: "Reset information is unavailable. Try refreshing.",
      });
    }
  }, [gateway, lease, providerGeneration, publish, read, settle]);

  useLayoutEffect(() => {
    lease.active = true;
    void refresh();
    return () => {
      lease.active = false;
      lease.sequence += 1;
      lease.attempt = null;
      lease.snapshot = null;
    };
  }, [lease, refresh]);

  const requestReset = useCallback(
    async (creditId: string | null) => {
      if (
        !lease.active ||
        !gateway ||
        providerGeneration === null ||
        !["ready", "uncertain"].includes(lease.state.status)
      )
        return;
      const sequence = ++lease.sequence;
      const previous = lease.snapshot;
      let retry = lease.attempt;
      if (
        !previous?.accountIdentity ||
        (!retry && (previous.availableCount === null || previous.availableCount < 1))
      )
        return;
      let targetCreditId = retry ? null : creditId;
      if (targetCreditId !== null && !hasCredit(previous, targetCreditId)) return;
      publish({
        ...lease.state,
        status: "preparing",
        outcome: null,
        error: null,
        targetCreditId,
        intent: retry ? "retry" : "reset",
      });
      try {
        const snapshot = await read(sequence);
        if (!lease.active || lease.sequence !== sequence || !snapshot) return;
        if (
          snapshot.accountIdentity !== previous.accountIdentity ||
          (retry && retry.accountIdentity !== snapshot.accountIdentity)
        ) {
          lease.attempt = null;
          lease.snapshot = null;
          throw new Error("Account changed");
        }
        lease.snapshot = snapshot;
        if (snapshot.pendingOperationId) {
          retry = {
            accountIdentity: previous.accountIdentity,
            idempotencyKey: snapshot.pendingOperationId,
            confirmation: null,
            uncertain: true,
          };
          lease.attempt = retry;
          targetCreditId = null;
          publish({ ...lease.state, targetCreditId, intent: "retry" });
        }
        if (!snapshot.pendingOperationId && retry?.uncertain) {
          await settle(sequence, snapshot, retry);
          return;
        }
        if (!retry && (snapshot.availableCount === null || snapshot.availableCount < 1)) {
          publish({ ...INITIAL_STATE, status: "ready", snapshot: display(snapshot) });
          return;
        }
        if (targetCreditId !== null && !hasCredit(snapshot, targetCreditId)) {
          publish({
            ...INITIAL_STATE,
            status: "ready",
            snapshot: display(snapshot),
            error: "This reset is no longer available. Check resets again.",
          });
          return;
        }
        const attempt: Attempt = retry ?? {
          accountIdentity: previous.accountIdentity,
          idempotencyKey: crypto.randomUUID(),
          confirmation: null,
          uncertain: false,
        };
        lease.attempt = attempt;
        const preparation = parseCodexRateLimitResetPreparation(
          await gateway.prepare({
            providerGeneration,
            accountIdentity: attempt.accountIdentity,
            creditId: targetCreditId,
          }),
        );
        if (!lease.active || lease.sequence !== sequence || lease.attempt !== attempt) return;
        attempt.confirmation = {
          token: preparation.confirmationToken,
          expiresAt: Date.now() + CODEX_RESET_CONFIRMATION_TIMEOUT_MS,
        };
        publish({
          ...INITIAL_STATE,
          status: "confirming",
          snapshot: display(snapshot),
          targetCreditId,
          intent: retry ? "retry" : "reset",
        });
      } catch {
        if (!lease.active || lease.sequence !== sequence) return;
        if (!lease.attempt?.uncertain) lease.attempt = null;
        publish({
          ...INITIAL_STATE,
          status: lease.attempt ? "uncertain" : "error",
          snapshot: lease.snapshot ? display(lease.snapshot) : null,
          error: "Could not prepare the reset. Refresh and try again.",
        });
      }
    },
    [gateway, lease, providerGeneration, publish, read, settle],
  );

  const retryReset = useCallback(() => requestReset(null), [requestReset]);

  const cancelReset = useCallback(() => {
    if (!lease.active || lease.state.status !== "confirming") return;
    const attempt = lease.attempt;
    if (attempt) attempt.confirmation = null;
    if (!attempt?.uncertain) lease.attempt = null;
    ++lease.sequence;
    publish({
      ...lease.state,
      status: attempt?.uncertain ? "uncertain" : "ready",
      error: null,
      targetCreditId: null,
      intent: null,
    });
  }, [lease, publish]);

  const confirmReset = useCallback(async () => {
    const attempt = lease.attempt;
    if (
      !lease.active ||
      !gateway ||
      providerGeneration === null ||
      lease.state.status !== "confirming" ||
      !attempt?.confirmation
    )
      return;
    const { token, expiresAt } = attempt.confirmation;
    attempt.confirmation = null;
    if (Date.now() >= expiresAt) {
      if (!attempt.uncertain) lease.attempt = null;
      publish({
        ...lease.state,
        status: attempt.uncertain ? "uncertain" : "ready",
        error: "Confirmation expired. Prepare the reset again.",
        targetCreditId: null,
        intent: null,
      });
      return;
    }
    const sequence = ++lease.sequence;
    attempt.uncertain = true;
    publish({ ...lease.state, status: "consuming", error: null });
    let outcome: CodexRateLimitResetOutcome;
    try {
      const receipt = parseCodexRateLimitResetReceipt(
        await gateway.consume({
          providerGeneration,
          confirmationToken: token,
          idempotencyKey: attempt.idempotencyKey,
        }),
      );
      if (!lease.active || lease.sequence !== sequence || lease.attempt !== attempt) return;
      outcome = receipt.outcome;
    } catch {
      if (!lease.active || lease.sequence !== sequence || lease.attempt !== attempt) return;
      publish({
        ...lease.state,
        status: "uncertain",
        error: "The reset result is unknown. Retry safely to check the result.",
        targetCreditId: null,
        intent: null,
      });
      return;
    }
    lease.attempt = null;
    publish({ ...lease.state, status: "loading", outcome, targetCreditId: null, intent: null });
    try {
      const snapshot = await read(sequence);
      if (!lease.active || lease.sequence !== sequence || !snapshot) return;
      if (snapshot.accountIdentity !== attempt.accountIdentity) {
        lease.snapshot = null;
        publish(INITIAL_STATE);
        return;
      }
      lease.snapshot = snapshot;
      publish({ ...INITIAL_STATE, status: "ready", snapshot: display(snapshot), outcome });
      await refreshLimitsRef.current();
      if (!lease.active || lease.sequence !== sequence) return;
    } catch {
      if (!lease.active || lease.sequence !== sequence) return;
      publish({
        ...INITIAL_STATE,
        status: "ready",
        outcome,
        error: "Reset result received. Refresh usage to update the displayed limits.",
      });
    }
  }, [gateway, lease, providerGeneration, publish, read]);

  return {
    state: published.lease === lease ? published.state : INITIAL_STATE,
    canReset:
      lease.active &&
      lease.state.status === "ready" &&
      lease.snapshot?.accountIdentity !== null &&
      lease.snapshot?.accountIdentity !== undefined &&
      lease.snapshot.availableCount !== null &&
      lease.snapshot.availableCount > 0,
    refresh,
    requestReset,
    confirmReset,
    cancelReset,
    retryReset,
  };
}

function display(snapshot: CodexRateLimitResetSnapshot): CodexRateLimitResetDisplaySnapshot {
  return {
    availableCount: snapshot.availableCount,
    credits: snapshot.credits,
    history: snapshot.history,
    historyTruncated: snapshot.historyTruncated,
  };
}

function hasCredit(snapshot: CodexRateLimitResetSnapshot, creditId: string): boolean {
  return snapshot.credits?.some((credit) => credit.id === creditId) === true;
}
