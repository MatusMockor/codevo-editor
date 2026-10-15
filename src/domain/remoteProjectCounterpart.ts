import type { DirectoryListing } from "./directoryListing";
import { isRemoteProjectRegistrationPath } from "./remoteProjectRegistration";

export function localProjectFolderName(rootPath: string): string | null {
  if (!rootPath.startsWith("/")) return null;
  const name = rootPath.slice(rootPath.lastIndexOf("/") + 1);
  if (name === "" || name === "." || name === "..") return null;
  return name;
}

export function counterpartFolderPath(listing: DirectoryListing, name: string): string | null {
  const found = listing.entries.some((entry) => entry.kind === "directory" && entry.name === name);
  if (!found) return null;
  const path = listing.path === "/" ? `/${name}` : `${listing.path}/${name}`;
  if (!isRemoteProjectRegistrationPath(path)) return null;
  return path;
}
