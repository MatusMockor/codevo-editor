import { useEffect, useMemo, useState } from "react";
import type { GitChangeStatus, GitGateway, GitStatus } from "../../domain/git";

export const MAX_CHECKOUT_FILE_STATUSES = 5000;

export type CheckoutFileStatuses = Readonly<Record<string, GitChangeStatus>>;

export interface LoadedCheckoutFileStatuses {
  readonly statuses: CheckoutFileStatuses;
  readonly truncated: boolean;
}

export type CheckoutFileStatusesState =
  | { readonly kind: "unavailable" }
  | { readonly kind: "loading" }
  | ({ readonly kind: "loaded" } & LoadedCheckoutFileStatuses)
  | { readonly kind: "failed" };

export interface UseCheckoutFileStatusesOptions {
  readonly git: Pick<GitGateway, "getStatus"> | null;
  readonly root: string | null;
  readonly revision: unknown;
}

interface CheckoutLease {
  readonly git: Pick<GitGateway, "getStatus">;
  readonly root: string;
}

interface OwnedResult {
  readonly lease: CheckoutLease;
  readonly state: CheckoutFileStatusesState;
}

const UNAVAILABLE: CheckoutFileStatusesState = Object.freeze({ kind: "unavailable" });
const LOADING: CheckoutFileStatusesState = Object.freeze({ kind: "loading" });
const FAILED: CheckoutFileStatusesState = Object.freeze({ kind: "failed" });

export function useCheckoutFileStatuses({
  git,
  revision,
  root,
}: UseCheckoutFileStatusesOptions): CheckoutFileStatusesState {
  const lease = useMemo<CheckoutLease | null>(
    () => (git === null || root === null ? null : { git, root }),
    [git, root],
  );
  const [owned, setOwned] = useState<OwnedResult | null>(null);

  useEffect(() => {
    if (lease === null) return;
    let current = true;
    lease.git.getStatus(lease.root).then(
      (status) => {
        if (!current) return;
        setOwned({ lease, state: { kind: "loaded", ...checkoutFileStatuses(status) } });
      },
      () => {
        if (!current) return;
        setOwned({ lease, state: FAILED });
      },
    );
    return () => {
      current = false;
    };
  }, [lease, revision]);

  if (lease === null) return UNAVAILABLE;
  if (owned === null || owned.lease !== lease) return LOADING;
  return owned.state;
}

export function checkoutFileStatuses(status: GitStatus): LoadedCheckoutFileStatuses {
  const statuses: Record<string, GitChangeStatus> = {};
  for (const change of status.changes.slice(0, MAX_CHECKOUT_FILE_STATUSES)) {
    if (change.path in statuses) continue;
    statuses[change.path] = change.status;
  }
  return { statuses, truncated: status.changes.length > MAX_CHECKOUT_FILE_STATUSES };
}
