import {
  MAX_AGENT_LINKED_FILE_BASENAME_CANDIDATES,
  agentLinkedFileBasename,
  agentLinkedFileBasenameMatch,
} from "../domain/agentMarkdown/agentLinkedFileBasenameMatch";
import type { AgentLocalFileOpenOutcome } from "../domain/agentMarkdown/agentLocalFileLinkFailure";
import type { FileSearchGateway } from "../domain/workspace";
import {
  classifyUnopenedLinkedFile,
  openClassifiedLinkedFile,
  openOrClassifyLinkedFile,
  type LinkedFileDirectoryReader,
} from "./agentLinkedFileProbe";

export type LinkedFileSearch = Pick<FileSearchGateway, "searchFilesWithMetadata">;

export const LINKED_FILE_SEARCH_GENERATION = "agent-linked-file";

export interface NamedLinkedFileOpening {
  readonly directories: LinkedFileDirectoryReader;
  readonly search: LinkedFileSearch | null;
  isCurrent(): boolean;
  open(path: string): Promise<boolean>;
}

export async function openNamedLinkedFile(
  path: string,
  root: string,
  opening: NamedLinkedFileOpening,
): Promise<AgentLocalFileOpenOutcome> {
  const { directories, isCurrent } = opening;
  const presence = await classifyUnopenedLinkedFile(path, root, directories);
  if (!isCurrent()) return "superseded";
  if (presence !== "notFound") {
    return openClassifiedLinkedFile(() => opening.open(path), presence, isCurrent);
  }
  const match = await findLinkedFileByBasename(agentLinkedFileBasename(path), root, opening.search);
  if (!isCurrent()) return "superseded";
  if (match === null) return "notFound";
  return openOrClassifyLinkedFile(() => opening.open(match), match, root, directories, isCurrent);
}

export async function findLinkedFileByBasename(
  name: string,
  root: string,
  search: LinkedFileSearch | null,
): Promise<string | null> {
  if (search?.searchFilesWithMetadata === undefined || name === "") return null;
  try {
    const found = await search.searchFilesWithMetadata(
      root,
      name,
      MAX_AGENT_LINKED_FILE_BASENAME_CANDIDATES,
      LINKED_FILE_SEARCH_GENERATION,
    );
    if (found.requestGeneration !== LINKED_FILE_SEARCH_GENERATION) return null;
    return agentLinkedFileBasenameMatch(name, root, found);
  } catch {
    return null;
  }
}
