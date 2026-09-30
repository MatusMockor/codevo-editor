import type {
  AgentSessionTaskStopResult,
  AgentTasksNotice,
} from "../../application/agentThreadPorts";

export interface AgentSessionTaskStopReport {
  readonly notice: AgentTasksNotice;
  readonly suggestEndSession: boolean;
}

const END_SESSION_HINT = "You can end Claude's session instead.";

export function agentSessionTaskStopReport(
  result: AgentSessionTaskStopResult,
  label: string,
): AgentSessionTaskStopReport | null {
  switch (result.kind) {
    case "stopping":
    case "stale":
      return null;
    case "refused":
      return endSessionReport(
        "error",
        `Claude could not stop "${label}": ${sentence(result.reason)} ${END_SESSION_HINT}`,
      );
    case "unconfirmed":
      return endSessionReport(
        "warning",
        `Claude did not confirm that it is stopping "${label}". It may still be running. ${END_SESSION_HINT}`,
      );
    case "notLive":
      return infoReport(`"${label}" had already finished.`);
    case "noSession":
      return infoReport(
        `Claude's session for this thread is no longer running, so Codevo could not ask it to stop "${label}".`,
      );
    case "unavailable":
      return endSessionReport(
        "error",
        `Codevo could not send the stop request for "${label}" to Claude. ${END_SESSION_HINT}`,
      );
    default:
      return unsupportedStopResult(result);
  }
}

export function agentSessionTaskStopTimedOutReport(label: string): AgentSessionTaskStopReport {
  return endSessionReport(
    "warning",
    `Claude has not reported that "${label}" stopped. It may still be running. ${END_SESSION_HINT}`,
  );
}

function sentence(text: string): string {
  const trimmed = text.trim().replace(/[.!?]+$/u, "");
  return `${trimmed}.`;
}

function endSessionReport(
  kind: AgentTasksNotice["kind"],
  message: string,
): AgentSessionTaskStopReport {
  return { notice: { kind, message, action: null }, suggestEndSession: true };
}

function infoReport(message: string): AgentSessionTaskStopReport {
  return { notice: { kind: "info", message, action: null }, suggestEndSession: false };
}

function unsupportedStopResult(result: never): never {
  throw new TypeError(`Unsupported background task stop result: ${JSON.stringify(result)}.`);
}
