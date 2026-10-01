import type {
  AgentThreadNotificationEvent,
  AgentThreadNotificationKind,
} from "../domain/agentNotification";

export type AgentThreadNotificationTone = "success" | "error" | "info";

export interface AgentThreadNotificationCopy {
  readonly message: string;
  readonly tone: AgentThreadNotificationTone;
}

export const MAX_AGENT_THREAD_NOTIFICATION_TITLE_CHARS = 80;
export const MAX_AGENT_THREAD_NOTIFICATION_PROJECT_CHARS = 60;

export function agentThreadNotificationCopy(
  event: AgentThreadNotificationEvent,
): AgentThreadNotificationCopy {
  const title = bounded(event.title, MAX_AGENT_THREAD_NOTIFICATION_TITLE_CHARS, "Untitled thread");
  const project = bounded(event.projectLabel, MAX_AGENT_THREAD_NOTIFICATION_PROJECT_CHARS, "");
  const where = project === "" ? "" : ` in ${project}`;
  return {
    message: `${title} ${outcomePhrase(event.kind)}${where}`,
    tone: notificationTone(event.kind),
  };
}

export function agentThreadUnavailableCopy(
  event: AgentThreadNotificationEvent,
): AgentThreadNotificationCopy {
  const title = bounded(event.title, MAX_AGENT_THREAD_NOTIFICATION_TITLE_CHARS, "Untitled thread");
  return { message: `${title} is no longer available`, tone: "info" };
}

export function agentThreadSystemNotification(event: AgentThreadNotificationEvent): {
  readonly title: string;
  readonly body: string;
} {
  const title = bounded(event.title, MAX_AGENT_THREAD_NOTIFICATION_TITLE_CHARS, "Untitled thread");
  const project = bounded(event.projectLabel, MAX_AGENT_THREAD_NOTIFICATION_PROJECT_CHARS, "");
  return {
    title: systemTitle(event.kind),
    body: project === "" ? title : `${title} · ${project}`,
  };
}

function outcomePhrase(kind: AgentThreadNotificationKind): string {
  switch (kind) {
    case "completed":
      return "finished";
    case "failed":
      return "failed";
    case "approval":
      return "needs your approval";
    case "input":
      return "needs your input";
    default:
      return unsupportedKind(kind);
  }
}

function systemTitle(kind: AgentThreadNotificationKind): string {
  switch (kind) {
    case "completed":
      return "Thread finished";
    case "failed":
      return "Thread failed";
    case "approval":
      return "Approval needed";
    case "input":
      return "Input needed";
    default:
      return unsupportedKind(kind);
  }
}

function notificationTone(kind: AgentThreadNotificationKind): AgentThreadNotificationTone {
  switch (kind) {
    case "completed":
      return "success";
    case "failed":
      return "error";
    case "approval":
    case "input":
      return "info";
    default:
      return unsupportedKind(kind);
  }
}

function bounded(value: string, limit: number, fallback: string): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  if (singleLine === "") return fallback;
  const characters = Array.from(singleLine);
  if (characters.length <= limit) return singleLine;
  return `${characters.slice(0, limit - 1).join("")}…`;
}

function unsupportedKind(kind: never): never {
  throw new TypeError(`Unsupported agent thread notification kind: ${String(kind)}`);
}
