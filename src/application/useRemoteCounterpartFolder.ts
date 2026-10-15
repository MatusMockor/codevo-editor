import { useEffect, useState } from "react";
import type { DirectoryListingGateway } from "../domain/directoryListing";
import { counterpartFolderPath } from "../domain/remoteProjectCounterpart";

export type RemoteCounterpartFolder =
  | Readonly<{ status: "checking" }>
  | Readonly<{ status: "found"; path: string }>
  | Readonly<{ status: "absent" }>;

type Settled = Readonly<{
  gateway: DirectoryListingGateway;
  folderName: string;
  result: RemoteCounterpartFolder;
}>;

const CHECKING: RemoteCounterpartFolder = Object.freeze({ status: "checking" });
const ABSENT: RemoteCounterpartFolder = Object.freeze({ status: "absent" });

export function useRemoteCounterpartFolder(
  gateway: DirectoryListingGateway | null,
  folderName: string | null,
): RemoteCounterpartFolder {
  const [settled, setSettled] = useState<Settled | null>(null);
  useEffect(() => {
    if (gateway === null || folderName === null) return;
    let current = true;
    void located(gateway, folderName).then((result) => {
      if (!current) return;
      setSettled({ gateway, folderName, result });
    });
    return () => {
      current = false;
    };
  }, [gateway, folderName]);
  const current = settled?.gateway === gateway && settled.folderName === folderName;
  if (settled !== null && !current) setSettled(null);
  if (gateway === null || folderName === null) return ABSENT;
  if (!current) return CHECKING;
  return settled.result;
}

async function located(
  gateway: DirectoryListingGateway,
  folderName: string,
): Promise<RemoteCounterpartFolder> {
  try {
    const listing = await gateway.listDirectoryEntries({ path: null, includeFiles: false });
    const path = counterpartFolderPath(listing, folderName);
    if (path === null) return ABSENT;
    return { status: "found", path };
  } catch {
    return ABSENT;
  }
}
