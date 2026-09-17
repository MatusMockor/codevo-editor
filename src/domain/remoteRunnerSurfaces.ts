import type { RemoteRunnerTaskFileDiff } from "./remoteRunner";

export type RemoteSurfaceScope = Readonly<{
  serverId: string;
  runnerId: string;
  projectId: string;
  taskId?: string;
}>;
export type RemoteSurfaceCapabilities = Readonly<{
  files: boolean;
  history: boolean;
  terminal: boolean;
}>;
export type RemoteDirectory = Readonly<{
  entries: readonly Readonly<{
    name: string;
    path: string;
    kind: "file" | "directory" | "symlink";
  }>[];
  nextOffset: number | null;
  truncated: boolean;
}>;
export type RemoteFileContent = Readonly<{
  path: string;
  text: string;
  version: string | null;
  unavailableReason: "binary" | "large" | null;
}>;
export type RemoteGitHistory = Readonly<{
  commits: readonly Readonly<{
    id: string;
    parents: readonly string[];
    subject: string;
    authorName: string;
    authoredAt: string;
  }>[];
  nextOffset: number | null;
  truncated: boolean;
}>;
export type RemoteCommitFiles = Readonly<{
  files: readonly Readonly<{
    path: string;
    status: "added" | "modified" | "deleted" | "renamed";
    oldPath?: string;
  }>[];
  truncated: boolean;
}>;
export type RemoteTerminalSnapshot = Readonly<{
  id: string;
  projectId: string;
  taskId: string | null;
  cols: number;
  rows: number;
  status: "running" | "exited";
  exitCode: number | null;
  sequence: number;
}>;
export type RemoteTerminalOutput = RemoteTerminalSnapshot &
  Readonly<{ chunks: readonly Readonly<{ sequence: number; data: string }>[]; truncated: boolean }>;
export type RemoteSurfaceRequests = {
  capabilities: RemoteSurfaceScope;
  listDirectory: RemoteSurfaceScope & Readonly<{ path: string; offset: number }>;
  readFile: RemoteSurfaceScope & Readonly<{ path: string }>;
  writeFile: RemoteSurfaceScope & Readonly<{ path: string; text: string; expectedVersion: string }>;
  history: RemoteSurfaceScope & Readonly<{ offset: number }>;
  commitFiles: RemoteSurfaceScope & Readonly<{ commit: string }>;
  commitDiff: RemoteSurfaceScope & Readonly<{ commit: string; path: string }>;
  openTerminal: RemoteSurfaceScope & Readonly<{ cols: number; rows: number }>;
  pollTerminal: RemoteSurfaceScope & Readonly<{ terminalId: string; after: number }>;
  writeTerminal: RemoteSurfaceScope & Readonly<{ terminalId: string; data: string }>;
  resizeTerminal: RemoteSurfaceScope & Readonly<{ terminalId: string; cols: number; rows: number }>;
  closeTerminal: RemoteSurfaceScope & Readonly<{ terminalId: string }>;
};
export type RemoteSurfaceResponses = {
  capabilities: RemoteSurfaceCapabilities;
  listDirectory: RemoteDirectory;
  readFile: RemoteFileContent;
  writeFile: RemoteFileContent;
  history: RemoteGitHistory;
  commitFiles: RemoteCommitFiles;
  commitDiff: RemoteRunnerTaskFileDiff;
  openTerminal: RemoteTerminalSnapshot;
  pollTerminal: RemoteTerminalOutput;
  writeTerminal: Readonly<{ accepted: true }>;
  resizeTerminal: RemoteTerminalSnapshot;
  closeTerminal: Readonly<{ closed: true }>;
};
export type RemoteRunnerSurfacesGateway = {
  readonly [K in keyof RemoteSurfaceRequests]: (
    request: RemoteSurfaceRequests[K],
  ) => Promise<RemoteSurfaceResponses[K]>;
};
