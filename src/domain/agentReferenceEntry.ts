import type { AgentAttachment } from "./agentAttachment";

export type AgentReferenceEntry = "file" | "directory";

export type AgentReferenceAttachment = Extract<AgentAttachment, { readonly kind: "reference" }>;

export type AgentReferenceIdentity = Pick<AgentReferenceAttachment, "name" | "path">;

export type AgentReferenceEntryResolver = (
  reference: AgentReferenceIdentity,
) => AgentReferenceEntry;

const FOLDER_PROMPT_LINE_PREFIX = '[Attached folder "';
const FILE_PROMPT_LINE_PREFIX = '[Attached file "';

export function agentReferenceEntryOf(inspected: {
  readonly isDirectory: boolean;
}): AgentReferenceEntry {
  if (inspected.isDirectory) return "directory";
  return "file";
}

export function agentReferencePromptLine(
  reference: AgentReferenceIdentity,
  entry: AgentReferenceEntry,
): string {
  switch (entry) {
    case "directory":
      return `${FOLDER_PROMPT_LINE_PREFIX}${reference.name}" is at: ${reference.path}]`;
    case "file":
      return `${FILE_PROMPT_LINE_PREFIX}${reference.name}" is at: ${reference.path}]`;
    default:
      return unsupportedReferenceEntry(entry);
  }
}

export const agentReferencesAreFiles: AgentReferenceEntryResolver = () => "file";

export function agentReferenceEntriesInPrompt(prompt: string): AgentReferenceEntryResolver {
  if (!prompt.includes(FOLDER_PROMPT_LINE_PREFIX)) return agentReferencesAreFiles;
  return unambiguousFolderLineResolver(new Set(prompt.split("\n")));
}

export function agentDirectoryReferenceEntries(
  directories: ReadonlyArray<AgentReferenceIdentity>,
): AgentReferenceEntryResolver {
  if (directories.length === 0) return agentReferencesAreFiles;
  return folderLineResolver(new Set(directories.map(folderPromptLine)));
}

export function anyAgentReferenceDirectory(
  resolvers: ReadonlyArray<AgentReferenceEntryResolver>,
): AgentReferenceEntryResolver {
  return (reference) => {
    if (resolvers.some((resolve) => resolve(reference) === "directory")) return "directory";
    return "file";
  };
}

function folderLineResolver(folderLines: ReadonlySet<string>): AgentReferenceEntryResolver {
  return (reference) => {
    if (folderLines.has(folderPromptLine(reference))) return "directory";
    return "file";
  };
}

function unambiguousFolderLineResolver(
  promptLines: ReadonlySet<string>,
): AgentReferenceEntryResolver {
  const folderEntryOf = folderLineResolver(promptLines);
  return (reference) => {
    if (promptLines.has(agentReferencePromptLine(reference, "file"))) return "file";
    return folderEntryOf(reference);
  };
}

function folderPromptLine(reference: AgentReferenceIdentity): string {
  return agentReferencePromptLine(reference, "directory");
}

function unsupportedReferenceEntry(entry: never): never {
  throw new TypeError(`Unsupported agent reference entry: ${String(entry)}.`);
}
