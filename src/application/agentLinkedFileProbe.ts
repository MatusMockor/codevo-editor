import type { AgentLocalFileOpenOutcome } from "../domain/agentMarkdown/agentLocalFileLinkFailure";
import type { FileEntry, WorkspaceFileGateway } from "../domain/workspace";

export const MAX_LINKED_FILE_PROBE_ENTRIES = 5_000;
export const MAX_LINKED_FILE_PROBE_DEPTH = 32;

export type LinkedFileDirectoryReader = Partial<
  Pick<WorkspaceFileGateway, "readDirectory" | "readDirectoryBounded">
>;

export type UnopenedLinkedFileOutcome = Exclude<AgentLocalFileOpenOutcome, "opened">;

interface Listing {
  readonly entries: ReadonlyArray<FileEntry>;
  readonly truncated: boolean;
}

const UNLISTED_NAMES: ReadonlySet<string> = new Set([".git"]);

export async function openOrClassifyLinkedFile(
  open: () => Promise<boolean>,
  path: string,
  root: string,
  reader: LinkedFileDirectoryReader,
): Promise<AgentLocalFileOpenOutcome> {
  if (await open()) return "opened";
  return classifyUnopenedLinkedFile(path, root, reader);
}

export async function classifyUnopenedLinkedFile(
  path: string,
  root: string,
  reader: LinkedFileDirectoryReader,
): Promise<UnopenedLinkedFileOutcome> {
  const base = root.replace(/\/+$/, "");
  const segments = segmentsBelowRoot(path, base);
  if (segments === null || segments.length === 0) return "failed";
  if (segments.some((segment) => UNLISTED_NAMES.has(segment))) return "failed";
  const floor = Math.max(0, segments.length - MAX_LINKED_FILE_PROBE_DEPTH);
  for (let depth = segments.length - 1; depth >= floor; depth -= 1) {
    const directory = [base, ...segments.slice(0, depth)].join("/");
    const listing = await readListing(reader, directory);
    if (listing === null) continue;
    const name = segments[depth] ?? "";
    const match = listedMatch(listing.entries, name);
    if (match === "absent") return listing.truncated ? "failed" : "notFound";
    if (depth !== segments.length - 1) return "failed";
    return match === "file" ? "unreadable" : "failed";
  }
  return "failed";
}

function segmentsBelowRoot(path: string, base: string): string[] | null {
  if (base === "" || !path.startsWith(`${base}/`)) return null;
  const segments = path.slice(base.length + 1).split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return null;
  }
  return segments;
}

async function readListing(
  reader: LinkedFileDirectoryReader,
  directory: string,
): Promise<Listing | null> {
  try {
    if (reader.readDirectoryBounded !== undefined) {
      return await reader.readDirectoryBounded(directory, MAX_LINKED_FILE_PROBE_ENTRIES);
    }
    if (reader.readDirectory === undefined) return null;
    const entries = await reader.readDirectory(directory);
    return {
      entries: entries.slice(0, MAX_LINKED_FILE_PROBE_ENTRIES),
      truncated: entries.length > MAX_LINKED_FILE_PROBE_ENTRIES,
    };
  } catch {
    return null;
  }
}

type ListedMatch = "file" | "other" | "absent";

function listedMatch(entries: ReadonlyArray<FileEntry>, name: string): ListedMatch {
  const exact = entries.find((entry) => entry.name === name);
  if (exact !== undefined) return exact.kind === "file" ? "file" : "other";
  const folded = name.toLowerCase();
  return entries.some((entry) => entry.name.toLowerCase() === folded) ? "other" : "absent";
}
