import { MAX_AGENT_EVENT_TEXT_BYTES, type AgentTurnEvent } from "../agentThread";
import { boundedUtf8Text, utf8ByteLength } from "./utf8Text";

/** Context observations belong to a single main-loop request, never result totals. */
export function claudeAssistantContext(value: Record<string, unknown>): AgentTurnEvent[] {
  if (value.parent_tool_use_id != null || value.error != null) return [];
  const message = record(value.message);
  if (
    message === null ||
    !modelName(message.model) ||
    message.model.startsWith("<") ||
    message.error != null
  )
    return [];
  const usage = record(message.usage);
  if (usage === null) return [];
  const input = count(usage.input_tokens);
  const creation =
    usage.cache_creation_input_tokens === undefined ? 0 : count(usage.cache_creation_input_tokens);
  const read =
    usage.cache_read_input_tokens === undefined ? 0 : count(usage.cache_read_input_tokens);
  if (input === null || creation === null || read === null) return [];
  const inputTokens = input + creation + read;
  if (!Number.isSafeInteger(inputTokens)) return [];
  return [{ kind: "contextUsage", model: message.model, inputTokens, contextWindow: null }];
}

export function claudeModelCapacities(value: Record<string, unknown>): AgentTurnEvent[] {
  if (value.parent_tool_use_id != null) return [];
  const models = record(value.modelUsage);
  if (models === null || Object.keys(models).length > 16) return [];
  return Object.entries(models).flatMap(([model, raw]) => {
    const contextWindow = count(record(raw)?.contextWindow);
    return modelName(model) && contextWindow !== null && contextWindow > 0
      ? [{ kind: "contextUsage" as const, model, inputTokens: null, contextWindow }]
      : [];
  });
}

export function claudeCompactionStatus(value: Record<string, unknown>): AgentTurnEvent | null {
  if (value.parent_tool_use_id != null) return null;
  if (value.subtype !== "status") return null;
  if (value.status !== "compacting" && value.status !== "requesting" && value.status !== null)
    return null;
  if (value.compact_result === "failed")
    return {
      kind: "contextCompactionStatus",
      status: "failed",
      message:
        typeof value.compact_error === "string"
          ? boundedUtf8Text(value.compact_error.replace(/\0/gu, ""), MAX_AGENT_EVENT_TEXT_BYTES)
          : null,
    };
  if (value.status === "compacting")
    return { kind: "contextCompactionStatus", status: "compacting", message: null };
  if (value.status === null || value.status === "requesting")
    return { kind: "contextCompactionStatus", status: "idle", message: null };
  return null;
}

function modelName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !/\p{Cc}/u.test(value) &&
    utf8ByteLength(value) <= 256
  );
}
function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
