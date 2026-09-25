import { useEffect, useState } from "react";
import type { WorkspaceHomeReference } from "../domain/workspaceRootEligibility";

export type HomeDirectoryResolver = () => Promise<WorkspaceHomeReference>;

export function useHomeDirectory(resolveHome: HomeDirectoryResolver | null): string | null {
  const [home, setHome] = useState<Readonly<{
    resolver: HomeDirectoryResolver;
    path: string | null;
  }> | null>(null);
  useEffect(() => {
    if (resolveHome === null) return;
    let disposed = false;
    void resolveHome()
      .then((reference) => {
        if (!disposed) setHome({ resolver: resolveHome, path: reference.path });
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [resolveHome]);
  return home !== null && home.resolver === resolveHome ? home.path : null;
}
