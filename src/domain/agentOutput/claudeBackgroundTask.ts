import {
  MAX_AGENT_TOOL_ID_BYTES,
  MAX_AGENT_TOOL_SUMMARY_BYTES,
  type AgentTurnEvent,
} from "../agentThread";
import { boundedUtf8Text, utf8ByteLength } from "./utf8Text";

type BackgroundEvent = Extract<AgentTurnEvent, { kind: "backgroundTask" }>;

/** Native lifecycle only: assistant promises and arbitrary tool output are not tasks. */
export function claudeBackgroundTask(value: Record<string, unknown>): BackgroundEvent | null {
  if (value.parent_tool_use_id != null) return null;
  const taskId = value.task_id;
  if (
    typeof taskId !== "string" ||
    taskId.length === 0 ||
    /\p{Cc}/u.test(taskId) ||
    utf8ByteLength(taskId) > MAX_AGENT_TOOL_ID_BYTES
  )
    return null;
  if (value.task_type === "plan" || value.task_type === "dream") return null;
  const patch =
    typeof value.patch === "object" && value.patch !== null && !Array.isArray(value.patch)
      ? (value.patch as Record<string, unknown>)
      : null;
  const status =
    value.subtype === "task_started"
      ? "starting"
      : value.subtype === "task_progress"
        ? "running"
        : value.subtype === "task_notification"
          ? nativeStatus(value.status)
          : value.subtype === "task_updated"
            ? nativeStatus(patch?.status)
            : null;
  if (status === null) return null;
  const description = value.description ?? patch?.description;
  return {
    kind: "backgroundTask",
    taskId,
    status,
    taskType: taskType(value.task_type),
    ...(typeof description === "string" && description.length > 0 && !/\p{Cc}/u.test(description)
      ? { description: boundedUtf8Text(description, MAX_AGENT_TOOL_SUMMARY_BYTES) }
      : {}),
  };
}
function nativeStatus(value: unknown): BackgroundEvent["status"] | null {
  if (value === "running" || value === "completed" || value === "failed") return value;
  if (value === "killed" || value === "cancelled" || value === "stopped" || value === "interrupted")
    return "stopped";
  return null;
}
function taskType(value: unknown): BackgroundEvent["taskType"] {
  if (value === "monitor" || value === "monitor_mcp") return "monitor";
  if (value === "shell" || value === "local_bash") return "shell";
  if (value === "agent" || value === "local_agent" || value === "remote_agent") return "agent";
  return "other";
}
