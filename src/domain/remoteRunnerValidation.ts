import {
  parseAgentTurnChangeSummary,
  parseAgentTurnFileDiff,
  isAgentTurnChangePath,
} from "./agentTurnChanges";
import {
  parseRepositoryHostsSnapshot,
  parseRepositoryLookupOutcome,
  parseRepositorySearchOutcome,
  validateRepositoryLookupRequest,
  validateRepositorySearchRequest,
} from "./repositoryLookupValidation";
import type { RepositoryLookupRequest, RepositorySearchRequest } from "./repositoryLookup";
import {
  isRemoteThreadMetadata,
  isRemoteThreadMetadataPatch,
  isRemoteThreadMetadataPage,
  isRemoteThreadMetadataChanges,
} from "./remoteThreadMetadata";
import {
  isRemoteProjectDirectories,
  isRemoteProjectDirectoryPath,
} from "./remoteProjectManagement";
import { parseAgentSubagentLifecycle } from "./agentSubagentLifecycle";
import { isRemoteRunnerInstructionSnapshot } from "./remoteRunnerInstructions";
import { parseAgentLaunchOptions } from "./agentLaunch";
import type * as R from "./remoteRunner";

type Check = (value: unknown) => boolean;
const accepts =
  (parse: (value: unknown) => unknown): Check =>
  (value) => {
    try {
      parse(value);
      return true;
    } catch {
      return false;
    }
  };
const bytes = (value: string) => new TextEncoder().encode(value).length;
const text =
  (max: number, blank = false): Check =>
  (v) =>
    typeof v === "string" && (blank || v.trim().length > 0) && bytes(v) <= max && !v.includes("\0");
const integer =
  (min: number, max = Number.MAX_SAFE_INTEGER): Check =>
  (v) =>
    typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
const boolean: Check = (v) => typeof v === "boolean";
const choice =
  (...values: readonly unknown[]): Check =>
  (v) =>
    values.includes(v);
const optional =
  (check: Check): Check =>
  (v) =>
    v === undefined || check(v);
const array =
  (check: Check, max: number): Check =>
  (v) =>
    Array.isArray(v) && v.length <= max && v.every(check);
const object =
  (fields: Readonly<Record<string, Check>>): Check =>
  (v) =>
    v !== null &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.keys(v).every((key) => Object.prototype.hasOwnProperty.call(fields, key)) &&
    Object.entries(fields).every(([key, check]) => check((v as Record<string, unknown>)[key]));
const id: Check = (v) =>
  typeof v === "string" &&
  v.length === 36 &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const identifier: Check = (v) =>
  typeof v === "string" && !/[\r\n]/.test(v) && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(v);
const historyProject: Check = (v) =>
  typeof v === "string" && v.length > 0 && v.length <= 128 && !/[\u0000-\u001f]/u.test(v);
const host: Check = (v) => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/.test(v);
const username: Check = (v) => typeof v === "string" && /^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$/.test(v);
const cloneHost = "[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?";
const cloneUrl: Check = (value) => {
  if (typeof value !== "string" || value.length > 2048 || /[\x00-\x20\x7f]/.test(value))
    return false;
  const match =
    new RegExp(
      `^(?:https://${cloneHost}|ssh://[A-Za-z0-9_][A-Za-z0-9_-]{0,63}@${cloneHost}(?::[0-9]{1,5})?)/([A-Za-z0-9._/-]+)$`,
    ).exec(value) ??
    new RegExp(`^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}@${cloneHost}:([A-Za-z0-9._/-]+)$`).exec(value);
  if (
    !match ||
    !match[1] ||
    match[1].split("/").some((part) => !part || part === "." || part === "..")
  )
    return false;
  if (value.startsWith("ssh://")) {
    try {
      const port = new URL(value).port;
      if (port && (Number(port) < 1 || Number(port) > 65535)) return false;
    } catch {
      return false;
    }
  }
  return true;
};
const cloneBranch: Check = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 255 &&
  !/[\x00-\x20\x7f~^:?*[\\]/.test(value) &&
  !value.includes("..") &&
  !value.includes("@{") &&
  !value.includes("//") &&
  !value.startsWith("-") &&
  !value.startsWith("/") &&
  !/[/.]$/.test(value) &&
  value !== "@" &&
  !value.split("/").some((part) => part.startsWith(".") || part.endsWith(".lock"));
const relativeFilePath: Check = (v) =>
  typeof v === "string" &&
  text(4096)(v) &&
  !/[\\\x00-\x1f]/.test(v) &&
  !/^[A-Za-z]:/.test(v) &&
  !v
    .split("/")
    .some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git");
const timestamp: Check = (v) => text(64)(v) && Number.isFinite(Date.parse(v as string));
const launch: Check = (value) => {
  try {
    parseAgentLaunchOptions(value, "launch");
    return true;
  } catch {
    return false;
  }
};
const launchProviderMatches: Check = (value) => {
  const item = value as { provider?: string; launch?: { provider: string } };
  return (
    item.launch === undefined ||
    item.provider === undefined ||
    item.launch.provider === (item.provider === "claude" ? "claudeCode" : item.provider)
  );
};
const base64: Check = (v) =>
  typeof v === "string" &&
  v.length > 0 &&
  v.length <= 11184812 &&
  v.length % 4 === 0 &&
  (v.length / 4) * 3 - (v.endsWith("==") ? 2 : v.endsWith("=") ? 1 : 0) <= 8388608 &&
  /^[A-Za-z0-9+/]+={0,2}$/.test(v);
const provider = choice("claude", "codex");
const mediaType = choice("image/png", "image/jpeg", "text/plain");
const part: Check = (v) =>
  object({ type: choice("text"), text: text(48000) })(v) ||
  object({ type: choice("attachment"), attachmentId: id })(v);
const parts: Check = (v) => {
  if (!array(part, 16)(v) || !Array.isArray(v) || v.length === 0) return false;
  const values = v as readonly R.RemoteRunnerPart[];
  const images = values.filter((p) => p.type === "attachment").map((p) => p.attachmentId);
  return (
    images.length <= 8 &&
    new Set(images).size === images.length &&
    values.reduce((sum, p) => sum + (p.type === "text" ? bytes(p.text) : 0), 0) <= 48000
  );
};
const serverFields = {
  id: identifier,
  name: (v: unknown) => text(80)(v) && !/[\x00-\x1f\x7f-\x9f]/.test(v as string),
  host,
  username,
  port: integer(1, 65535),
};
const server = object({ ...serverFields, connected: boolean });
const serverRequest = { serverId: identifier };
const project = object({ id: identifier, name: text(256) });
const cloneJobRequest = { ...serverRequest, cloneId: id };
const cloneJob: Check = (value) => {
  if (
    !object({
      id,
      status: choice("queued", "running", "succeeded", "failed", "interrupted", "cancelled"),
      project: (v) => v === null || project(v),
      error: (v) => v === null || text(256)(v),
    })(value)
  )
    return false;
  const job = value as R.RemoteRunnerCloneJob;
  return job.status === "succeeded"
    ? job.project !== null && job.error === null
    : job.project === null;
};
const taskRequest = { ...serverRequest, taskId: id };
const taskShape = object({
  id,
  sequence: integer(1),
  runnerId: text(128),
  provider,
  status: choice("draft", "queued", "running", "succeeded", "failed", "interrupted", "cancelled"),
  projectId: optional(identifier),
  conversationId: optional(id),
  parentTaskId: optional(id),
  launch: optional(launch),
  isolation: optional(choice("in-place", "worktree")),
  parts,
  createdAt: timestamp,
});
const task: Check = (v) => taskShape(v) && launchProviderMatches(v);
const pendingMessage: Check = (value) => {
  if (
    !object({
      id,
      conversationId: id,
      status: choice("queued", "paused", "dispatched", "cancelled", "uncertain"),
      parts,
      createdAt: (v) =>
        timestamp(v) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(v as string),
      launch: optional(launch),
      taskId: (v) => v === null || id(v),
    })(value)
  )
    return false;
  const pending = value as R.RemoteRunnerPendingMessage;
  return (pending.status === "dispatched") === (pending.taskId !== null);
};
const pendingMessages: Check = (value) => {
  if (!object({ items: array(pendingMessage, 16) })(value)) return false;
  const items = (value as R.RemoteRunnerPendingMessages).items;
  return (
    new Set(items.map((item) => item.id)).size === items.length &&
    new Set(items.map((item) => item.conversationId)).size <= 1 &&
    items.every(
      (item) => item.status === "queued" || item.status === "paused" || item.status === "uncertain",
    )
  );
};
const legacyEvent = object({
  sequence: integer(1),
  taskId: id,
  type: choice(
    "task.created",
    "task.queued",
    "task.running",
    "task.succeeded",
    "task.failed",
    "task.interrupted",
    "task.cancelled",
    "task.output",
  ),
  createdAt: timestamp,
  channel: optional(choice("stdout", "stderr")),
  text: optional(text(8192, true)),
  exitCode: optional((v) => v === null || integer(-2147483648, 2147483647)(v)),
  error: optional(text(1024)),
});
const event: Check = (value) =>
  legacyEvent(value) ||
  object({
    sequence: integer(1),
    taskId: id,
    type: choice("task.input"),
    createdAt: timestamp,
    messageId: id,
    parts,
  })(value);
const eventPage: Check = (value) => {
  if (
    !object({
      items: array(event, 50),
      nextCursor: (v) => v === null || integer(0)(v),
      subagentLifecycle: optional((value) => {
        try {
          return parseAgentSubagentLifecycle(value) !== undefined;
        } catch {
          return false;
        }
      }),
      outputTruncatedBeforeSequence: optional(integer(1)),
      outputStartsAtLineBoundary: optional(boolean),
    })(value)
  )
    return false;
  const page = value as R.RemoteRunnerEventPage;
  return (
    (page.outputTruncatedBeforeSequence === undefined) ===
    (page.outputStartsAtLineBoundary === undefined)
  );
};
const attachmentFields: Readonly<Record<string, Check>> = {
  id,
  runnerId: text(128),
  name: text(255),
  bytes: integer(1, 8388608),
  sha256: (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v),
  createdAt: timestamp,
};
const attachment: Check = (value) =>
  object({
    ...attachmentFields,
    mediaType: choice("image/png", "image/jpeg"),
    width: integer(1, 8192),
    height: integer(1, 8192),
  })(value) ||
  object({
    ...attachmentFields,
    mediaType: choice("text/plain"),
    bytes: integer(1, 5 * 1024 * 1024),
  })(value);
const page = (item: Check) =>
  object({ items: array(item, 50), nextCursor: (v) => v === null || integer(0)(v) });
const voidResponse: Check = (v) => v === null || v === undefined;

export const remoteRunnerChecks = {
  collectInstructions: {
    request: object({ rootPath: optional(text(4096)) }),
    response: isRemoteRunnerInstructionSnapshot,
  },
  listServers: { request: voidResponse, response: array(server, 32) },
  connectServer: { request: object(serverFields), response: server },
  disconnectServer: { request: object(serverRequest), response: voidResponse },
  removeServer: { request: object(serverRequest), response: voidResponse },
  getRunner: {
    request: object(serverRequest),
    response: object({
      protocolVersion: choice(1),
      runnerId: text(128),
      name: text(256),
      executionTimeoutMs: optional(integer(60_000, 604_800_000)),
      capabilities: object({
        taskExecution: boolean,
        eventReplay: boolean,
        taskDrafts: optional(boolean),
        imageAttachments: optional(boolean),
        textAttachments: optional(boolean),
        projectCloning: optional(boolean),
        projectManagement: optional(boolean),
        threadManagement: optional(boolean),
        turnChanges: optional(boolean),
        taskContinuation: optional(boolean),
        taskLaunchOptions: optional(boolean),
        taskIsolation: optional(boolean),
        taskFileDiffs: optional(boolean),
        pendingMessages: optional(boolean),
        taskSteering: optional(boolean),
        subagentTelemetry: optional(boolean),
        subagentLifecycleRetention: optional(boolean),
        outputArtifacts: optional(boolean),
        instructionSync: optional(boolean),
        interactiveQuestions: optional(boolean),
      }),
    }),
  },
  listRepositoryHosts: {
    request: object(serverRequest),
    response: accepts(parseRepositoryHostsSnapshot),
  },
  lookupRepository: {
    request: object({
      ...serverRequest,
      request: accepts((value) =>
        validateRepositoryLookupRequest(value as RepositoryLookupRequest),
      ),
    }),
    response: accepts(parseRepositoryLookupOutcome),
  },
  searchRepositories: {
    request: object({
      ...serverRequest,
      request: accepts((value) =>
        validateRepositorySearchRequest(value as RepositorySearchRequest),
      ),
    }),
    response: accepts(parseRepositorySearchOutcome),
  },
  listProjectDirectories: {
    request: object({ ...serverRequest, path: optional(isRemoteProjectDirectoryPath) }),
    response: isRemoteProjectDirectories,
  },
  getThreadMetadata: { request: object(taskRequest), response: isRemoteThreadMetadata },
  listThreadMetadata: {
    request: object({ ...serverRequest, after: optional(id) }),
    response: isRemoteThreadMetadataPage,
  },
  updateThreadMetadata: {
    request: object({ ...taskRequest, patch: isRemoteThreadMetadataPatch }),
    response: isRemoteThreadMetadata,
  },
  reorderThread: {
    request: object({ ...taskRequest, targetTaskId: id, placement: choice("before", "after") }),
    response: object({
      items: isRemoteThreadMetadataChanges,
    }),
  },
  listProjects: {
    request: object(serverRequest),
    response: object({ items: array(object({ id: identifier, name: text(256) }), 1000) }),
  },
  cloneProject: {
    request: object({
      ...serverRequest,
      idempotencyKey: id,
      url: cloneUrl,
      name: identifier,
      branch: optional(cloneBranch),
      parentPath: optional(isRemoteProjectDirectoryPath),
    }),
    response: cloneJob,
  },
  getProjectClone: { request: object(cloneJobRequest), response: cloneJob },
  cancelProjectClone: { request: object(cloneJobRequest), response: cloneJob },
  listTasks: { request: object({ ...serverRequest, after: integer(0) }), response: page(task) },
  searchHistory: {
    request: object({
      ...serverRequest,
      query: (v: unknown) =>
        typeof v === "string" &&
        v.trim().length >= 2 &&
        v.length <= 256 &&
        bytes(v) <= 1024 &&
        !/[\u0000-\u001f]/u.test(v),
      after: optional(integer(0)),
      projectId: optional(historyProject),
    }),
    response: object({
      items: array(
        object({
          taskId: id,
          conversationId: id,
          projectId: (v) => v === null || historyProject(v),
          taskSequence: integer(1),
          role: choice("user", "assistant"),
          eventSequence: (v) => v === null || integer(1)(v),
          snippet: (v) => text(1528, true)(v) && [...(v as string)].length <= 382,
        }),
        20,
      ),
      nextCursor: (v) => v === null || integer(1)(v),
      scope: choice("retained_runner_history"),
      incomplete: boolean,
    }),
  },
  createTask: {
    request: (v: unknown) =>
      object({
        ...serverRequest,
        idempotencyKey: id,
        provider,
        isolation: optional(choice("in-place", "worktree")),
        parts,
        launch: optional(launch),
        instructions: optional(isRemoteRunnerInstructionSnapshot),
      })(v) && launchProviderMatches(v),
    response: object({ task, created: boolean }),
  },
  startTask: { request: object({ ...taskRequest, projectId: identifier }), response: task },
  getTask: { request: object(taskRequest), response: task },
  getTaskResume: {
    request: object(taskRequest),
    response: (value: unknown) =>
      object({ available: choice(true), reason: choice(null) })(value) ||
      object({
        available: choice(false),
        reason: choice("task_not_finished", "session_unavailable", "newer_turn_exists"),
      })(value),
  },
  continueTask: {
    request: object({
      ...taskRequest,
      idempotencyKey: id,
      parts,
      launch: optional(launch),
      instructions: optional(isRemoteRunnerInstructionSnapshot),
    }),
    response: object({ task, created: boolean }),
  },
  steerTask: {
    request: object({ ...taskRequest, idempotencyKey: id, parts }),
    response: object({ taskId: id, messageId: id, status: choice("accepted") }),
  },
  steerPendingMessage: {
    request: object({ ...taskRequest, pendingId: id }),
    response: object({ taskId: id, messageId: id, status: choice("accepted") }),
  },
  listPendingMessages: { request: object(taskRequest), response: pendingMessages },
  resumePendingMessages: { request: object(taskRequest), response: pendingMessages },
  enqueueMessage: {
    request: object({
      ...taskRequest,
      idempotencyKey: id,
      parts,
      launch: optional(launch),
      instructions: optional(isRemoteRunnerInstructionSnapshot),
    }),
    response: object({ pending: pendingMessage, created: boolean }),
  },
  cancelPendingMessage: {
    request: object({ ...taskRequest, pendingId: id }),
    response: (value: unknown) =>
      pendingMessage(value) && (value as R.RemoteRunnerPendingMessage).status === "cancelled",
  },
  cancelTask: { request: object(taskRequest), response: task },
  listEvents: { request: object({ ...taskRequest, after: integer(0) }), response: eventPage },
  getTurnChanges: { request: object(taskRequest), response: accepts(parseAgentTurnChangeSummary) },
  getTurnFileDiff: {
    request: object({ ...taskRequest, relativePath: isAgentTurnChangePath }),
    response: accepts(parseAgentTurnFileDiff),
  },
  listTaskFiles: {
    request: object(taskRequest),
    response: object({
      files: array(
        object({
          path: relativeFilePath,
          status: choice("added", "modified", "deleted", "renamed", "untracked"),
          oldPath: optional(relativeFilePath),
        }),
        1000,
      ),
      truncated: boolean,
    }),
  },
  getTaskFileDiff: {
    request: object({ ...taskRequest, path: relativeFilePath }),
    response: object({
      path: relativeFilePath,
      original: object({ text: text(65536, true), truncated: boolean }),
      modified: object({ text: text(65536, true), truncated: boolean }),
      unavailableReason: choice("binary", "large", null),
    }),
  },
  getDiff: {
    request: object(taskRequest),
    response: object({
      patch: text(2 * 1024 * 1024, true),
      truncated: boolean,
      untrackedFiles: array(text(4096), 10000),
    }),
  },
  getAttachment: { request: object({ ...serverRequest, attachmentId: id }), response: attachment },
  readAttachment: {
    request: object({ ...serverRequest, attachmentId: id }),
    response: object({ base64, mediaType }),
  },
  uploadAttachment: {
    request: object({
      ...serverRequest,
      attachmentId: id,
      name: (v) => text(255)(v) && !/[\\/\x00-\x1f\x7f]/.test(v as string),
      mediaType,
      base64: (v) =>
        typeof v === "string" &&
        v.length > 0 &&
        v.length <= 11184812 &&
        v.length % 4 === 0 &&
        /^[A-Za-z0-9+/]+={0,2}$/.test(v),
    }),
    response: object({ attachment, created: boolean }),
  },
} as const;

export function validateRemoteRunnerValue(
  operation: keyof typeof remoteRunnerChecks,
  direction: "request" | "response",
  value: unknown,
): void {
  if (!remoteRunnerChecks[operation][direction](value))
    throw new Error(`Invalid remote runner ${operation} ${direction}.`);
}
