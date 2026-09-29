import {
  agentBackgroundTurn,
  agentBackgroundTurnPreview,
  parseAgentBackgroundTurn,
  type AgentBackgroundTurnContent,
} from "../domain/agentBackgroundTurn";
import { runningTurn, type AgentThread, type AgentThreadsAction } from "../domain/agentThread";
import type { AgentSessionBackgroundTurnEvent } from "../domain/agentThreadSession";
import { isAgentBackgroundTurn } from "../domain/agentTurnOrigin";
import { info } from "./agentProjectAuthority";
import type { AgentTasksNotice } from "./agentThreadPorts";

export const MAX_HELD_BACKGROUND_TURNS_PER_THREAD = 2;
export const MAX_THREADS_WITH_HELD_BACKGROUND_TURNS = 8;

export interface AgentBackgroundTurnPorts {
  mintTurnId(): string | null;
  dispatch(action: AgentThreadsAction): void;
  now(): number;
}

export interface AgentBackgroundTurnRecording {
  readonly ports: AgentBackgroundTurnPorts;
  readonly readThread: (threadId: string) => AgentThread | undefined;
  readonly setNotice: (notice: AgentTasksNotice) => void;
}

type BackgroundReplyFate = "runningTurn" | "superseded" | "notRecorded" | "unreadable" | "released";

interface HeldBackgroundTurns {
  readonly ownerId: string;
  readonly title: string;
  readonly runningTurnId: string;
  readonly contents: ReadonlyArray<AgentBackgroundTurnContent>;
}

export class AgentBackgroundTurnRecorder {
  private readonly held = new Map<string, HeldBackgroundTurns>();

  receive(
    recording: AgentBackgroundTurnRecording,
    thread: AgentThread,
    event: AgentSessionBackgroundTurnEvent,
  ): void {
    this.settle(recording, thread.threadId);
    const content = parseAgentBackgroundTurn(event);
    if (content.events.length === 0) {
      if (backgroundTurnWasEmpty(event)) return;
      recording.setNotice(backgroundReplyNotice(thread.title, content, "unreadable"));
      return;
    }
    const current = recording.readThread(thread.threadId) ?? thread;
    const running = runningTurn(current);
    if (running !== null) {
      this.hold(recording, current, running.turnId, content);
      return;
    }
    recordBackgroundTurn(recording, current.threadId, event.workspaceId, content);
  }

  flush(recording: AgentBackgroundTurnRecording): void {
    for (const threadId of [...this.held.keys()]) this.settle(recording, threadId);
  }

  clear(recording: AgentBackgroundTurnRecording | null): void {
    const entries = [...this.held];
    this.held.clear();
    if (recording === null) return;
    for (const [threadId, entry] of entries) releaseHeld(recording, threadId, entry);
  }

  private hold(
    recording: AgentBackgroundTurnRecording,
    thread: AgentThread,
    runningTurnId: string,
    content: AgentBackgroundTurnContent,
  ): void {
    const existing = this.held.get(thread.threadId);
    const contents = [...(existing?.contents ?? []), content];
    const overflow = contents.splice(0, contents.length - MAX_HELD_BACKGROUND_TURNS_PER_THREAD);
    for (const superseded of overflow) {
      recording.setNotice(backgroundReplyNotice(thread.title, superseded, "superseded"));
    }
    this.held.delete(thread.threadId);
    this.held.set(thread.threadId, {
      ownerId: thread.owner.ownerId,
      title: thread.title,
      runningTurnId,
      contents,
    });
    this.evictOldestThread(recording);
  }

  private evictOldestThread(recording: AgentBackgroundTurnRecording): void {
    if (this.held.size <= MAX_THREADS_WITH_HELD_BACKGROUND_TURNS) return;
    const oldest = this.held.keys().next();
    if (oldest.done === true) return;
    const entry = this.held.get(oldest.value);
    this.held.delete(oldest.value);
    if (entry === undefined) return;
    const thread = heldThread(recording, oldest.value, entry);
    if (thread === null) {
      announceHeld(recording, entry, "released");
      return;
    }
    announceHeld(recording, { ...entry, title: thread.title }, "superseded");
  }

  private settle(recording: AgentBackgroundTurnRecording, threadId: string): void {
    const entry = this.held.get(threadId);
    if (entry === undefined) return;
    const thread = heldThread(recording, threadId, entry);
    if (thread === null) {
      this.held.delete(threadId);
      announceHeld(recording, entry, "released");
      return;
    }
    const running = runningTurn(thread);
    if (running?.turnId === entry.runningTurnId) return;
    this.held.delete(threadId);
    if (running !== null) {
      announceHeld(recording, { ...entry, title: thread.title }, "runningTurn");
      return;
    }
    for (const content of entry.contents) {
      recordBackgroundTurn(recording, threadId, entry.ownerId, content);
    }
  }
}

function releaseHeld(
  recording: AgentBackgroundTurnRecording,
  threadId: string,
  entry: HeldBackgroundTurns,
): void {
  const thread = heldThread(recording, threadId, entry);
  if (thread === null || runningTurn(thread) !== null) {
    announceHeld(recording, { ...entry, title: thread?.title ?? entry.title }, "released");
    return;
  }
  for (const content of entry.contents) {
    recordBackgroundTurn(recording, threadId, entry.ownerId, content);
  }
}

function heldThread(
  recording: AgentBackgroundTurnRecording,
  threadId: string,
  entry: HeldBackgroundTurns,
): AgentThread | null {
  const thread = recording.readThread(threadId);
  if (thread === undefined || thread.owner.ownerId !== entry.ownerId) return null;
  return thread;
}

function announceHeld(
  recording: AgentBackgroundTurnRecording,
  entry: HeldBackgroundTurns,
  fate: BackgroundReplyFate,
): void {
  for (const content of entry.contents) {
    recording.setNotice(backgroundReplyNotice(entry.title, content, fate));
  }
}

function recordBackgroundTurn(
  recording: AgentBackgroundTurnRecording,
  threadId: string,
  ownerId: string,
  content: AgentBackgroundTurnContent,
): void {
  const thread = recording.readThread(threadId);
  if (thread === undefined || thread.owner.ownerId !== ownerId) return;
  const turnId = recording.ports.mintTurnId();
  if (turnId === null) {
    recording.setNotice(backgroundReplyNotice(thread.title, content, "notRecorded"));
    return;
  }
  recording.ports.dispatch({
    kind: "backgroundTurnRecorded",
    threadId,
    workspaceId: ownerId,
    turn: agentBackgroundTurn(turnId, content, recording.ports.now()),
  });
  const recorded = recording.readThread(threadId)?.turns.find((turn) => turn.turnId === turnId);
  if (recorded !== undefined && isAgentBackgroundTurn(recorded)) return;
  recording.setNotice(backgroundReplyNotice(thread.title, content, "notRecorded"));
}

function backgroundTurnWasEmpty(event: AgentSessionBackgroundTurnEvent): boolean {
  return event.output.trim() === "" && event.complete && !event.truncated;
}

function backgroundReplyNotice(
  title: string,
  content: AgentBackgroundTurnContent,
  fate: BackgroundReplyFate,
): AgentTasksNotice {
  const preview = agentBackgroundTurnPreview(content.events);
  const incomplete = content.complete ? "" : " (incomplete)";
  const quoted = preview === null ? "." : `: "${preview}"${incomplete}`;
  return info(`Claude replied in "${title}" ${causeText(content)}, but ${fateText(fate)}${quoted}`);
}

function causeText(content: AgentBackgroundTurnContent): string {
  if (content.cause === "taskNotification") return "after background work finished";
  return "without a new message";
}

function fateText(fate: BackgroundReplyFate): string {
  switch (fate) {
    case "runningTurn":
      return "the reply was not added to the thread because your next message is running";
    case "superseded":
      return "newer replies arrived before it could be added to the thread";
    case "notRecorded":
      return "the reply could not be added to the thread";
    case "unreadable":
      return "Codevo could not read the reply";
    case "released":
      return "Codevo stopped tracking the thread before the reply could be added";
    default:
      return unsupportedFate(fate);
  }
}

function unsupportedFate(fate: never): never {
  throw new TypeError(`Unsupported background reply fate: ${String(fate)}.`);
}
