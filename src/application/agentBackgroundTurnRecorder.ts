import {
  agentBackgroundTurn,
  agentBackgroundTurnPreview,
  parseAgentBackgroundTurn,
  type AgentBackgroundTurnContent,
} from "../domain/agentBackgroundTurn";
import type { AgentThread, AgentThreadsAction } from "../domain/agentThread";
import type { AgentSessionBackgroundTurnEvent } from "../domain/agentThreadSession";
import { isAgentBackgroundTurn } from "../domain/agentTurnOrigin";
import { info } from "./agentProjectAuthority";
import type { AgentTasksNotice } from "./agentThreadPorts";

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

type BackgroundReplyFailure = "notRecorded" | "unreadable";

export function recordAgentBackgroundTurn(
  recording: AgentBackgroundTurnRecording,
  thread: AgentThread,
  event: AgentSessionBackgroundTurnEvent,
): void {
  const content = parseAgentBackgroundTurn(event);
  if (content.events.length === 0) {
    if (backgroundTurnWasEmpty(event)) return;
    recording.setNotice(backgroundReplyNotice(thread.title, content, "unreadable"));
    return;
  }
  const turnId = recording.ports.mintTurnId();
  if (turnId === null) {
    recording.setNotice(backgroundReplyNotice(thread.title, content, "notRecorded"));
    return;
  }
  recording.ports.dispatch({
    kind: "backgroundTurnRecorded",
    threadId: thread.threadId,
    workspaceId: event.workspaceId,
    turn: agentBackgroundTurn(turnId, content, recording.ports.now()),
  });
  const recorded = recording
    .readThread(thread.threadId)
    ?.turns.find((turn) => turn.turnId === turnId);
  if (recorded !== undefined && isAgentBackgroundTurn(recorded)) return;
  recording.setNotice(backgroundReplyNotice(thread.title, content, "notRecorded"));
}

export function reportUnrecordedAgentBackgroundTurn(
  setNotice: (notice: AgentTasksNotice) => void,
  title: string | null,
  event: AgentSessionBackgroundTurnEvent,
): void {
  const content = parseAgentBackgroundTurn(event);
  if (content.events.length > 0) {
    setNotice(backgroundReplyNotice(title, content, "notRecorded"));
    return;
  }
  if (backgroundTurnWasEmpty(event)) return;
  setNotice(backgroundReplyNotice(title, content, "unreadable"));
}

function backgroundTurnWasEmpty(event: AgentSessionBackgroundTurnEvent): boolean {
  return event.output.trim() === "" && event.complete && !event.truncated;
}

function backgroundReplyNotice(
  title: string | null,
  content: AgentBackgroundTurnContent,
  failure: BackgroundReplyFailure,
): AgentTasksNotice {
  const preview = agentBackgroundTurnPreview(content.events);
  const incomplete = content.complete ? "" : " (incomplete)";
  const quoted = preview === null ? "." : `: "${preview}"${incomplete}`;
  return info(
    `Claude replied in ${threadText(title)} ${causeText(content)}, but ${failureText(failure)}${quoted}`,
  );
}

function threadText(title: string | null): string {
  if (title === null) return "a thread that is not open";
  return `"${title}"`;
}

function causeText(content: AgentBackgroundTurnContent): string {
  if (content.cause === "taskNotification") return "after background work finished";
  return "without a new message";
}

function failureText(failure: BackgroundReplyFailure): string {
  switch (failure) {
    case "notRecorded":
      return "the reply could not be added to the thread";
    case "unreadable":
      return "Codevo could not read the reply";
    default:
      return unsupportedFailure(failure);
  }
}

function unsupportedFailure(failure: never): never {
  throw new TypeError(`Unsupported background reply failure: ${String(failure)}.`);
}
