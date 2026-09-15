import type { AgentLaunchOptions } from "./agentLaunch";

/** Closed editor-facing runner protocol. Credentials and server paths stay native. */
export type RemoteRunnerProvider = "claude" | "codex";
export type RemoteRunnerServerInput = Readonly<{
  id: string;
  name: string;
  host: string;
  username: string;
  port: number;
}>;
export type RemoteRunnerServer = RemoteRunnerServerInput & Readonly<{ connected: boolean }>;
export type RemoteRunnerServerRequest = Readonly<{ serverId: string }>;
export type RemoteRunnerTaskRequest = RemoteRunnerServerRequest & Readonly<{ taskId: string }>;
export type RemoteRunnerDescriptor = Readonly<{
  protocolVersion: 1;
  runnerId: string;
  name: string;
  capabilities: Readonly<{
    taskExecution: boolean;
    eventReplay: boolean;
    taskDrafts?: boolean;
    imageAttachments?: boolean;
    projectCloning?: boolean;
    taskContinuation?: boolean;
    taskLaunchOptions?: boolean;
    taskFileDiffs?: boolean;
  }>;
}>;
export type RemoteRunnerProject = Readonly<{ id: string; name: string }>;
export type RemoteRunnerCloneRequest = RemoteRunnerServerRequest &
  Readonly<{
    idempotencyKey: string;
    url: string;
    name: string;
    branch?: string;
  }>;
export type RemoteRunnerCloneJobRequest = RemoteRunnerServerRequest & Readonly<{ cloneId: string }>;
export type RemoteRunnerCloneJob = Readonly<{
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "interrupted" | "cancelled";
  project: RemoteRunnerProject | null;
  error: string | null;
}>;
export type RemoteRunnerPart =
  Readonly<{ type: "text"; text: string }> | Readonly<{ type: "attachment"; attachmentId: string }>;
export type RemoteRunnerTaskStatus =
  "draft" | "queued" | "running" | "succeeded" | "failed" | "interrupted" | "cancelled";
export type RemoteRunnerTask = Readonly<{
  id: string;
  sequence: number;
  runnerId: string;
  provider: RemoteRunnerProvider;
  status: RemoteRunnerTaskStatus;
  projectId?: string;
  conversationId?: string;
  parentTaskId?: string;
  launch?: AgentLaunchOptions;
  parts: readonly RemoteRunnerPart[];
  createdAt: string;
}>;
export type RemoteRunnerTaskResume =
  | Readonly<{ available: true; reason: null }>
  | Readonly<{
      available: false;
      reason: "task_not_finished" | "session_unavailable" | "newer_turn_exists";
    }>;
export type RemoteRunnerContinueTaskRequest = RemoteRunnerTaskRequest &
  Readonly<{
    idempotencyKey: string;
    parts: readonly RemoteRunnerPart[];
    launch?: AgentLaunchOptions;
  }>;
export type RemoteRunnerEvent = Readonly<{
  sequence: number;
  taskId: string;
  type:
    | "task.created"
    | "task.queued"
    | "task.running"
    | "task.succeeded"
    | "task.failed"
    | "task.interrupted"
    | "task.cancelled"
    | "task.output";
  createdAt: string;
  channel?: "stdout" | "stderr";
  text?: string;
  exitCode?: number | null;
  error?: string;
}>;
export type RemoteRunnerPage<T> = Readonly<{ items: readonly T[]; nextCursor: number | null }>;
export type RemoteRunnerDiff = Readonly<{
  patch: string;
  truncated: boolean;
  untrackedFiles: readonly string[];
}>;
export type RemoteRunnerAttachment = Readonly<{
  id: string;
  runnerId: string;
  name: string;
  mediaType: "image/png" | "image/jpeg";
  bytes: number;
  sha256: string;
  width: number;
  height: number;
  createdAt: string;
}>;
export type RemoteRunnerCreateTaskRequest = RemoteRunnerServerRequest &
  Readonly<{
    idempotencyKey: string;
    provider: RemoteRunnerProvider;
    launch?: AgentLaunchOptions;
    parts: readonly RemoteRunnerPart[];
  }>;
export type RemoteRunnerUploadRequest = RemoteRunnerServerRequest &
  Readonly<{
    attachmentId: string;
    name: string;
    mediaType: "image/png" | "image/jpeg";
    base64: string;
  }>;

export type RemoteRunnerAttachmentRequest = RemoteRunnerServerRequest &
  Readonly<{ attachmentId: string }>;
export type RemoteRunnerAttachmentContent = Readonly<{
  base64: string;
  mediaType: "image/png" | "image/jpeg";
}>;

export type RemoteRunnerTaskFile = Readonly<{
  path: string;
  status: "added" | "modified" | "deleted" | "renamed" | "untracked";
  oldPath?: string;
}>;
export type RemoteRunnerTaskFiles = Readonly<{
  files: readonly RemoteRunnerTaskFile[];
  truncated: boolean;
}>;
export type RemoteRunnerTaskFileDiff = Readonly<{
  path: string;
  original: Readonly<{ text: string; truncated: boolean }>;
  modified: Readonly<{ text: string; truncated: boolean }>;
  unavailableReason: "binary" | "large" | null;
}>;
export type RemoteRunnerTaskFileDiffRequest = RemoteRunnerTaskRequest & Readonly<{ path: string }>;

export type RemoteRunnerInventoryEvent = Readonly<{
  type: "connected" | "changed" | "disconnected";
}>;

export type RemoteRunnerHistorySearchRequest = RemoteRunnerServerRequest &
  Readonly<{ query: string; after?: number; projectId?: string }>;
export type RemoteRunnerHistorySearchMatch = Readonly<{
  taskId: string;
  conversationId: string;
  projectId: string | null;
  taskSequence: number;
  role: "user" | "assistant";
  eventSequence: number | null;
  snippet: string;
}>;
export type RemoteRunnerHistorySearchPage = Readonly<{
  items: readonly RemoteRunnerHistorySearchMatch[];
  nextCursor: number | null;
  scope: "retained_runner_history";
  incomplete: boolean;
}>;

export interface RemoteRunnerGateway {
  searchHistory?(request: RemoteRunnerHistorySearchRequest): Promise<RemoteRunnerHistorySearchPage>;
  watchInventory?(
    request: RemoteRunnerServerRequest,
    listener: (event: RemoteRunnerInventoryEvent) => void,
  ): Promise<() => void>;
  listTaskFiles?(request: RemoteRunnerTaskRequest): Promise<RemoteRunnerTaskFiles>;
  getTaskFileDiff?(request: RemoteRunnerTaskFileDiffRequest): Promise<RemoteRunnerTaskFileDiff>;
  getAttachment?(request: RemoteRunnerAttachmentRequest): Promise<RemoteRunnerAttachment>;
  readAttachment?(request: RemoteRunnerAttachmentRequest): Promise<RemoteRunnerAttachmentContent>;
  listServers(): Promise<readonly RemoteRunnerServer[]>;
  connectServer(request: RemoteRunnerServerInput): Promise<RemoteRunnerServer>;
  disconnectServer(request: RemoteRunnerServerRequest): Promise<void>;
  removeServer(request: RemoteRunnerServerRequest): Promise<void>;
  getRunner(request: RemoteRunnerServerRequest): Promise<RemoteRunnerDescriptor>;
  listProjects(
    request: RemoteRunnerServerRequest,
  ): Promise<Readonly<{ items: readonly RemoteRunnerProject[] }>>;
  cloneProject(request: RemoteRunnerCloneRequest): Promise<RemoteRunnerCloneJob>;
  getProjectClone(request: RemoteRunnerCloneJobRequest): Promise<RemoteRunnerCloneJob>;
  cancelProjectClone(request: RemoteRunnerCloneJobRequest): Promise<RemoteRunnerCloneJob>;
  listTasks(
    request: RemoteRunnerServerRequest & Readonly<{ after: number }>,
  ): Promise<RemoteRunnerPage<RemoteRunnerTask>>;
  createTask(
    request: RemoteRunnerCreateTaskRequest,
  ): Promise<Readonly<{ task: RemoteRunnerTask; created: boolean }>>;
  startTask(
    request: RemoteRunnerTaskRequest & Readonly<{ projectId: string }>,
  ): Promise<RemoteRunnerTask>;
  getTask(request: RemoteRunnerTaskRequest): Promise<RemoteRunnerTask>;
  getTaskResume(request: RemoteRunnerTaskRequest): Promise<RemoteRunnerTaskResume>;
  continueTask(
    request: RemoteRunnerContinueTaskRequest,
  ): Promise<Readonly<{ task: RemoteRunnerTask; created: boolean }>>;
  cancelTask(request: RemoteRunnerTaskRequest): Promise<RemoteRunnerTask>;
  listEvents(
    request: RemoteRunnerTaskRequest & Readonly<{ after: number }>,
  ): Promise<RemoteRunnerPage<RemoteRunnerEvent>>;
  getDiff(request: RemoteRunnerTaskRequest): Promise<RemoteRunnerDiff>;
  uploadAttachment(
    request: RemoteRunnerUploadRequest,
  ): Promise<Readonly<{ attachment: RemoteRunnerAttachment; created: boolean }>>;
}
