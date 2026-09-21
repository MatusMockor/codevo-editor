import type { AgentSubagentLifecycle } from "./agentSubagentLifecycle";
import type {
  RemoteRunnerCollectInstructionsRequest,
  RemoteRunnerInstructionSnapshot,
} from "./remoteRunnerInstructions";
import type { AgentLaunchOptions } from "./agentLaunch";

/** Closed editor-facing runner protocol. Credentials and server paths stay native. */
export type RemoteRunnerIsolation = "in-place" | "worktree";
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
  executionTimeoutMs?: number;
  capabilities: Readonly<{
    taskExecution: boolean;
    eventReplay: boolean;
    taskDrafts?: boolean;
    imageAttachments?: boolean;
    textAttachments?: boolean;
    projectCloning?: boolean;
    taskContinuation?: boolean;
    taskLaunchOptions?: boolean;
    taskIsolation?: boolean;
    taskFileDiffs?: boolean;
    pendingMessages?: boolean;
    taskSteering?: boolean;
    subagentTelemetry?: boolean;
    subagentLifecycleRetention?: boolean;
    outputArtifacts?: boolean;
    instructionSync?: boolean;
    interactiveQuestions?: boolean;
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
  isolation?: RemoteRunnerIsolation;
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
    instructions?: RemoteRunnerInstructionSnapshot;
    parts: readonly RemoteRunnerPart[];
    launch?: AgentLaunchOptions;
  }>;
export type RemoteRunnerSteerTaskRequest = RemoteRunnerTaskRequest &
  Readonly<{ idempotencyKey: string; parts: readonly RemoteRunnerPart[] }>;
export type RemoteRunnerSteerResponse = Readonly<{
  taskId: string;
  messageId: string;
  status: "accepted";
}>;
export type RemoteRunnerSteerPendingRequest = RemoteRunnerTaskRequest &
  Readonly<{ pendingId: string }>;
export type RemoteRunnerPendingMessage = Readonly<{
  id: string;
  conversationId: string;
  status: "queued" | "paused" | "dispatched" | "cancelled" | "uncertain";
  parts: readonly RemoteRunnerPart[];
  createdAt: string;
  launch?: AgentLaunchOptions;
  taskId: string | null;
}>;
export type RemoteRunnerPendingMessages = Readonly<{
  items: readonly RemoteRunnerPendingMessage[];
}>;
export type RemoteRunnerCancelPendingRequest = RemoteRunnerTaskRequest &
  Readonly<{ pendingId: string }>;
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
    | "task.output"
    | "task.input";
  createdAt: string;
  channel?: "stdout" | "stderr";
  text?: string;
  messageId?: string;
  parts?: readonly RemoteRunnerPart[];
  exitCode?: number | null;
  error?: string;
}>;
export type RemoteRunnerPage<T> = Readonly<{ items: readonly T[]; nextCursor: number | null }>;
export type RemoteRunnerEventPage = RemoteRunnerPage<RemoteRunnerEvent> &
  Readonly<{
    /** Highest output sequence evicted by the runner; lifecycle events remain replayable. */
    subagentLifecycle?: AgentSubagentLifecycle;
    outputTruncatedBeforeSequence?: number;
    outputStartsAtLineBoundary?: boolean;
  }>;
export type RemoteRunnerDiff = Readonly<{
  patch: string;
  truncated: boolean;
  untrackedFiles: readonly string[];
}>;
export type RemoteRunnerAttachment = Readonly<{
  id: string;
  runnerId: string;
  name: string;
  mediaType: "image/png" | "image/jpeg" | "text/plain";
  bytes: number;
  sha256: string;
  createdAt: string;
}> &
  (
    | Readonly<{ mediaType: "image/png" | "image/jpeg"; width: number; height: number }>
    | Readonly<{ mediaType: "text/plain"; width?: never; height?: never }>
  );
export type RemoteRunnerCreateTaskRequest = RemoteRunnerServerRequest &
  Readonly<{
    idempotencyKey: string;
    provider: RemoteRunnerProvider;
    isolation?: RemoteRunnerIsolation;
    instructions?: RemoteRunnerInstructionSnapshot;
    launch?: AgentLaunchOptions;
    parts: readonly RemoteRunnerPart[];
  }>;
export type RemoteRunnerUploadRequest = RemoteRunnerServerRequest &
  Readonly<{
    attachmentId: string;
    name: string;
    mediaType: "image/png" | "image/jpeg" | "text/plain";
    base64: string;
  }>;

export type RemoteRunnerAttachmentRequest = RemoteRunnerServerRequest &
  Readonly<{ attachmentId: string }>;
export type RemoteRunnerAttachmentContent = Readonly<{
  base64: string;
  mediaType: "image/png" | "image/jpeg" | "text/plain";
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
  steerTask?(request: RemoteRunnerSteerTaskRequest): Promise<RemoteRunnerSteerResponse>;
  steerPendingMessage?(
    request: RemoteRunnerSteerPendingRequest,
  ): Promise<RemoteRunnerSteerResponse>;
  collectInstructions?(
    request: RemoteRunnerCollectInstructionsRequest,
  ): Promise<RemoteRunnerInstructionSnapshot>;
  listPendingMessages?(request: RemoteRunnerTaskRequest): Promise<RemoteRunnerPendingMessages>;
  enqueueMessage?(
    request: RemoteRunnerContinueTaskRequest,
  ): Promise<Readonly<{ pending: RemoteRunnerPendingMessage; created: boolean }>>;
  cancelPendingMessage?(
    request: RemoteRunnerCancelPendingRequest,
  ): Promise<RemoteRunnerPendingMessage>;
  resumePendingMessages?(request: RemoteRunnerTaskRequest): Promise<RemoteRunnerPendingMessages>;
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
  ): Promise<RemoteRunnerEventPage>;
  getDiff(request: RemoteRunnerTaskRequest): Promise<RemoteRunnerDiff>;
  uploadAttachment(
    request: RemoteRunnerUploadRequest,
  ): Promise<Readonly<{ attachment: RemoteRunnerAttachment; created: boolean }>>;
}
