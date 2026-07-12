import type * as Monaco from "monaco-editor";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

interface WorkspaceLease {
  owners: Set<symbol>;
  root: string;
}

const leasesByMonaco = new WeakMap<object, WorkspaceLease[]>();

export function retainEditorRuntimeWorkspace(
  monacoApi: typeof Monaco,
  root: string,
  owner: symbol,
): void {
  const leases = leasesByMonaco.get(monacoApi) ?? [];
  const lease = leases.find((candidate) =>
    workspaceRootKeysEqual(candidate.root, root)
  );
  if (lease) {
    lease.owners.add(owner);
    return;
  }
  leases.push({ owners: new Set([owner]), root });
  leasesByMonaco.set(monacoApi, leases);
}

/** Returns true only when the released owner held the final lease. */
export function releaseEditorRuntimeWorkspace(
  monacoApi: typeof Monaco,
  root: string,
  owner: symbol,
): boolean {
  const leases = leasesByMonaco.get(monacoApi);
  const lease = leases?.find((candidate) =>
    workspaceRootKeysEqual(candidate.root, root)
  );
  if (!leases || !lease || !lease.owners.delete(owner)) {
    return false;
  }
  if (lease.owners.size > 0) {
    return false;
  }
  const remaining = leases.filter((candidate) => candidate !== lease);
  if (remaining.length > 0) {
    leasesByMonaco.set(monacoApi, remaining);
  } else {
    leasesByMonaco.delete(monacoApi);
  }
  return true;
}
