import {
  agentThreadAttention,
  agentThreadLifecycle,
  agentThreadTitle,
  MAX_AGENT_TURNS_PER_THREAD,
  type AgentThread,
  type AgentTurnStatus,
} from "../domain/agentThread";
import {
  appendRemoteAgentTranscript,
  createRemoteAgentTranscript,
  type RemoteAgentTranscript,
} from "../domain/remoteAgentTranscript";
import type {
  RemoteRunnerEvent,
  RemoteRunnerProject,
  RemoteRunnerTask,
  RemoteRunnerTaskResume,
} from "../domain/remoteRunner";
import type { AgentThreadView } from "./agentThreadPorts";
import { stabilizeRemoteAgentViews } from "./remoteAgentProjectionStability";
import type { AgentAttachment } from "../domain/agentAttachment";

export function remoteAgentProjectKey(
  serverId: string,
  runnerId: string,
  projectId: string,
): string {
  return `remote:${encodeURIComponent(serverId)}:${encodeURIComponent(runnerId)}:${encodeURIComponent(projectId)}`;
}
export function remoteAgentThreadKey(
  serverId: string,
  runnerId: string,
  conversationId: string,
): string {
  return `remote-thread:${encodeURIComponent(serverId)}:${encodeURIComponent(runnerId)}:${encodeURIComponent(conversationId)}`;
}

export interface RemoteAgentProjectionInput {
  readonly serverId: string;
  readonly runnerId: string;
  readonly projects: readonly RemoteRunnerProject[];
  readonly tasks: readonly RemoteRunnerTask[];
  readonly replays: ReadonlyMap<string, readonly RemoteRunnerEvent[]>;
  readonly resumes: ReadonlyMap<string, RemoteRunnerTaskResume>;
  readonly replayComplete?: ReadonlySet<string>;
  readonly replayTruncated?: ReadonlySet<string>;
  readonly attachmentsByTask?: ReadonlyMap<string, readonly AgentAttachment[]>;
}

export function projectRemoteAgentThreads(
  input: RemoteAgentProjectionInput,
): readonly AgentThreadView[] {
  return new RemoteAgentProjection().project(input);
}

/** Owner-scoped cache. Retains parser state between polling snapshots, never CLI authority. */
export class RemoteAgentProjection {
  private owner = "";
  private views: readonly AgentThreadView[] = [];
  private readonly transcripts = new Map<string, RemoteAgentTranscript>();
  private readonly identities = new Map<
    string,
    { readonly recipe: string; readonly projectId?: string }
  >();

  /** Speculative render work must never advance the committed parser cursor. */
  fork(): RemoteAgentProjection {
    const next = new RemoteAgentProjection();
    next.owner = this.owner;
    next.views = this.views;
    for (const [id, transcript] of this.transcripts) next.transcripts.set(id, transcript);
    for (const [id, identity] of this.identities) next.identities.set(id, identity);
    return next;
  }

  project(input: RemoteAgentProjectionInput): readonly AgentThreadView[] {
    const owner = `${input.serverId}\u0000${input.runnerId}`;
    if (owner !== this.owner) {
      this.owner = owner;
      this.views = [];
      this.transcripts.clear();
      this.identities.clear();
    }
    const groups = new Map<string, RemoteRunnerTask[]>();
    const retained = new Set<string>();
    const taskById = new Map(input.tasks.map((task) => [task.id, task]));
    for (const task of input.tasks) {
      if (task.runnerId !== input.runnerId)
        throw new Error("Remote task belongs to another runner.");
      if (retained.has(task.id)) throw new Error("Duplicate remote task.");
      const id = task.conversationId ?? task.id;
      const group = groups.get(id) ?? [];
      group.push(task);
      groups.set(id, group);
      retained.add(task.id);
      const parent = task.parentTaskId === undefined ? undefined : taskById.get(task.parentTaskId);
      if (
        parent !== undefined &&
        ((parent.conversationId ?? parent.id) !== id ||
          parent.provider !== task.provider ||
          parent.projectId !== task.projectId)
      )
        throw new Error("Remote continuation parent belongs to another conversation.");
      const identity = JSON.stringify([
        task.provider,
        id,
        task.parentTaskId,
        task.sequence,
        task.createdAt,
      ]);
      const previousIdentity = this.identities.get(task.id);
      if (
        previousIdentity !== undefined &&
        (previousIdentity.recipe !== identity ||
          (previousIdentity.projectId !== undefined &&
            previousIdentity.projectId !== task.projectId))
      )
        throw new Error("Remote task identity changed.");
      this.identities.set(task.id, { recipe: identity, projectId: task.projectId });
      const cached = this.transcripts.get(task.id);
      if (
        !input.replays.has(task.id) &&
        cached &&
        (cached.lastRunnerSequence > 0 ||
          cached.finished !== (input.replayComplete?.has(task.id) === true && isTerminal(task)) ||
          cached.eventsTruncated !== (input.replayTruncated?.has(task.id) === true))
      )
        this.transcripts.delete(task.id);
      let transcript =
        this.transcripts.get(task.id) ?? createRemoteAgentTranscript(task.id, task.provider);
      const replay = input.replays.get(task.id) ?? [];
      let previousSequence = 0;
      for (const event of replay) {
        if (event.taskId !== task.id || event.sequence <= previousSequence)
          throw new Error("Invalid remote transcript event ordering or owner.");
        previousSequence = event.sequence;
      }
      const incoming = replay.filter((event) => event.sequence > transcript.lastRunnerSequence);
      if (
        incoming.length > 0 ||
        (!transcript.finished && input.replayComplete?.has(task.id) && isTerminal(task)) ||
        (!transcript.eventsTruncated && input.replayTruncated?.has(task.id))
      )
        transcript = appendRemoteAgentTranscript(transcript, incoming, {
          complete: input.replayComplete?.has(task.id) === true,
          terminal: isTerminal(task),
          truncated: input.replayTruncated?.has(task.id),
        });
      this.transcripts.set(task.id, transcript);
    }
    for (const id of this.transcripts.keys())
      if (!retained.has(id)) {
        this.transcripts.delete(id);
        this.identities.delete(id);
      }
    this.views = stabilizeRemoteAgentViews(
      this.views,
      [...groups.entries()].map(([conversationId, tasks]) =>
        projectConversation(input, conversationId, tasks, this.transcripts),
      ),
    );
    return this.views;
  }
}

function projectConversation(
  input: RemoteAgentProjectionInput,
  conversationId: string,
  unsorted: readonly RemoteRunnerTask[],
  transcripts: ReadonlyMap<string, RemoteAgentTranscript>,
): AgentThreadView {
  const all = [...unsorted].sort((a, b) => a.sequence - b.sequence);
  const first = all[0]!;
  const latest = all[all.length - 1]!;
  if (all.some((task) => task.provider !== first.provider || task.projectId !== first.projectId))
    throw new Error("Remote conversation changed provider or project.");
  const known = new Map(all.map((task) => [task.id, task]));
  const children = new Set<string>();
  const sequences = new Set<number>();
  for (const task of all) {
    if (sequences.has(task.sequence)) throw new Error("Duplicate remote task sequence.");
    sequences.add(task.sequence);
    if (task.id === conversationId && task.parentTaskId !== undefined)
      throw new Error("Remote conversation root has a parent.");
    if (task.parentTaskId !== undefined) {
      const parent = known.get(task.parentTaskId);
      if (children.has(task.parentTaskId) || (parent && parent.sequence >= task.sequence))
        throw new Error("Remote conversation has invalid continuation lineage.");
      children.add(task.parentTaskId);
    } else if (task.id !== conversationId) {
      throw new Error("Remote conversation child has no parent.");
    }
  }
  const tasks = all.slice(-MAX_AGENT_TURNS_PER_THREAD);
  const projectId = first.projectId ?? "";
  const projectKey = remoteAgentProjectKey(input.serverId, input.runnerId, projectId);
  const thread: AgentThread = {
    threadId: remoteAgentThreadKey(input.serverId, input.runnerId, conversationId),
    owner: { rootKey: projectKey, ownerId: projectKey, repositoryRoot: projectKey },
    target: { isolation: "worktree", worktreePath: null },
    provider: { kind: first.provider === "claude" ? "claudeCode" : "codex", sessionId: null },
    title: agentThreadTitle(prompt(first)),
    pinned: false,
    archived: false,
    createdAtEpochMs: timestamp(first.createdAt),
    updatedAtEpochMs: timestamp(latest.createdAt),
    turns: tasks.map((task) => {
      const transcript = transcripts.get(task.id)!;
      return {
        turnId: task.id,
        prompt: prompt(task),
        status: turnStatus(task, transcript),
        startedAtEpochMs: timestamp(task.createdAt),
        endedAtEpochMs: transcript.finished ? transcript.endedAtEpochMs : null,
        events: transcript.events,
        eventsTruncated: transcript.eventsTruncated,
        lastStatusSequence: transcript.lastRunnerSequence,
        lastOutputSequence: transcript.outputOrdinal,
        streamMetrics: {
          receivedUtf8Bytes: transcript.receivedUtf8Bytes,
          complete: transcript.finished && !transcript.eventsTruncated,
        },
        launch: task.launch ?? null,
        cliVersion: null,
        attachments: input.attachmentsByTask?.get(task.id),
      };
    }),
    turnsTruncated:
      tasks.length !== all.length ||
      !all.some((task) => task.id === conversationId) ||
      all.some((task) => task.parentTaskId !== undefined && !known.has(task.parentTaskId)),
    integration: null,
    viewedAtEpochMs: null,
    externalOrigin: null,
  };
  return {
    thread,
    lifecycle: agentThreadLifecycle(thread),
    attention: agentThreadAttention(thread),
    unread: false,
    repositoryLabel:
      input.projects.find((project) => project.id === projectId)?.name ?? "Server project",
    projectOrigin: "active-tab",
    worktreeRemoved: false,
    worktreeMissing: false,
    changeSummary: null,
    ship: { kind: "idle", status: null, loadingStatus: false },
    editorAvailability: { kind: "blocked", reason: "This working copy is on the server." },
    execution: {
      kind: "remote",
      serverId: input.serverId,
      runnerId: input.runnerId,
      projectId,
      conversationId,
      latestTaskId: latest.id,
      resume: input.resumes.get(latest.id) ?? null,
    },
  };
}

function prompt(task: RemoteRunnerTask): string {
  return task.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n\n");
}
function timestamp(raw: string): number {
  const value = Date.parse(raw);
  return Number.isFinite(value) ? value : 0;
}
function isTerminal(task: RemoteRunnerTask): boolean {
  return !["draft", "queued", "running"].includes(task.status);
}
function turnStatus(task: RemoteRunnerTask, transcript: RemoteAgentTranscript): AgentTurnStatus {
  switch (task.status) {
    case "draft":
    case "queued":
      return { kind: "pending" };
    case "running":
      return { kind: "running" };
    case "succeeded":
      return { kind: "exited", exitCode: 0 };
    case "cancelled":
      return { kind: "stopped" };
    case "interrupted":
      return { kind: "interrupted" };
    case "failed":
      return { kind: "failed", message: transcript.error ?? "The server task failed." };
  }
}
