import type {
  AgentThreadNotificationEvent,
  AgentThreadNotificationKind,
} from "../domain/agentNotification";

export type AgentThreadNotificationTone = "success" | "error" | "info";

export interface AgentThreadNotificationView {
  readonly title: string;
  readonly description: string;
  readonly project: string | null;
  readonly tone: AgentThreadNotificationTone;
}

export const MAX_AGENT_THREAD_NOTIFICATION_TITLE_CHARS = 80;
export const MAX_AGENT_THREAD_NOTIFICATION_PROJECT_CHARS = 60;

export function agentThreadNotificationView(
  event: AgentThreadNotificationEvent,
): AgentThreadNotificationView {
  return {
    title: systemTitle(event.kind),
    description: threadTitle(event),
    project: projectLabel(event),
    tone: notificationTone(event.kind),
  };
}

export function agentThreadUnavailableView(
  event: AgentThreadNotificationEvent,
): AgentThreadNotificationView {
  return {
    title: "Thread unavailable",
    description: threadTitle(event),
    project: projectLabel(event),
    tone: "info",
  };
}

export function agentThreadSystemNotification(event: AgentThreadNotificationEvent): {
  readonly title: string;
  readonly body: string;
} {
  const title = threadTitle(event);
  const project = projectLabel(event);
  return {
    title: systemTitle(event.kind),
    body: project === null ? title : `${title} · ${project}`,
  };
}

function threadTitle(event: AgentThreadNotificationEvent): string {
  return bounded(event.title, MAX_AGENT_THREAD_NOTIFICATION_TITLE_CHARS, "Untitled thread");
}

function projectLabel(event: AgentThreadNotificationEvent): string | null {
  const project = bounded(event.projectLabel, MAX_AGENT_THREAD_NOTIFICATION_PROJECT_CHARS, "");
  return project === "" ? null : project;
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
