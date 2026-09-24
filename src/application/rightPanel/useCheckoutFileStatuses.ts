import { useEffect, useState } from "react";
import type { GitChangeStatus, GitGateway, GitStatus } from "../../domain/git";

export const MAX_CHECKOUT_FILE_STATUSES = 5000;

export type CheckoutFileStatuses = Readonly<Record<string, GitChangeStatus>>;

export interface UseCheckoutFileStatusesOptions {
  readonly git: Pick<GitGateway, "getStatus"> | null;
  readonly root: string | null;
  readonly revision: unknown;
}

interface OwnedStatuses {
  readonly root: string;
  readonly statuses: CheckoutFileStatuses;
}

export function useCheckoutFileStatuses({
  git,
  revision,
  root,
}: UseCheckoutFileStatusesOptions): CheckoutFileStatuses | null {
  const [owned, setOwned] = useState<OwnedStatuses | null>(null);

  useEffect(() => {
    if (git === null || root === null) return;
    let current = true;
    git.getStatus(root).then(
      (status) => {
        if (!current) return;
        setOwned({ root, statuses: checkoutFileStatuses(status) });
      },
      () => {
        if (!current) return;
        setOwned({ root, statuses: {} });
      },
    );
    return () => {
      current = false;
    };
  }, [git, revision, root]);

  if (root === null || owned === null || owned.root !== root) return null;
  return owned.statuses;
}

export function checkoutFileStatuses(status: GitStatus): CheckoutFileStatuses {
  const statuses: Record<string, GitChangeStatus> = {};
  for (const change of status.changes.slice(0, MAX_CHECKOUT_FILE_STATUSES)) {
    if (change.path in statuses) continue;
    statuses[change.path] = change.status;
  }
  return statuses;
}
