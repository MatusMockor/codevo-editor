import { useEffect, useMemo, useState } from "react";
import { joinClonePath } from "../domain/cloneDestination";
import type { CloneDestinationProbe } from "../domain/cloneForm";
import type { DirectoryListingGateway } from "../domain/directoryListing";
import { normalizedWorkspaceRootKey } from "../domain/workspaceRootKey";

const CHECKING: CloneDestinationProbe = Object.freeze({ kind: "checking" });
const UNKNOWN: CloneDestinationProbe = Object.freeze({ kind: "unknown" });
const EXISTS: CloneDestinationProbe = Object.freeze({ kind: "exists" });
const FREE: CloneDestinationProbe = Object.freeze({ kind: "free" });

type ProbeAnswer = Readonly<{
  gateway: Pick<DirectoryListingGateway, "listDirectoryEntries">;
  key: string;
  probe: CloneDestinationProbe;
}>;

export function useCloneDestinationProbe(
  gateway: Pick<DirectoryListingGateway, "listDirectoryEntries"> | null,
  target: Readonly<{ parentPath: string; name: string }> | null,
  projectRootPaths: readonly string[],
  delayMs = 200,
): CloneDestinationProbe {
  const parentPath = target?.parentPath ?? null;
  const name = target?.name ?? null;
  const key = parentPath === null || name === null ? null : joinClonePath(parentPath, name);
  const project = useMemo(() => {
    if (key === null) return null;
    const wanted = normalizedWorkspaceRootKey(key);
    return projectRootPaths.find((root) => normalizedWorkspaceRootKey(root) === wanted) ?? null;
  }, [key, projectRootPaths]);
  const [answer, setAnswer] = useState<ProbeAnswer | null>(null);
  useEffect(() => {
    if (gateway === null || key === null || parentPath === null || name === null) return;
    if (project !== null) return;
    let disposed = false;
    const publish = (probe: CloneDestinationProbe) => {
      if (!disposed) setAnswer({ gateway, key, probe });
    };
    const timer = setTimeout(() => {
      void gateway
        .listDirectoryEntries({ path: parentPath, includeFiles: true })
        .then((listing) => {
          const wanted = name.toLowerCase();
          if (listing.entries.some((entry) => entry.name.toLowerCase() === wanted))
            return publish(EXISTS);
          publish(listing.truncated ? UNKNOWN : FREE);
        })
        .catch(() => publish(UNKNOWN));
    }, delayMs);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [delayMs, gateway, key, name, parentPath, project]);
  if (key === null) return UNKNOWN;
  if (project !== null) return { kind: "project", rootPath: project };
  if (gateway === null) return UNKNOWN;
  return answer?.key === key && answer.gateway === gateway ? answer.probe : CHECKING;
}
