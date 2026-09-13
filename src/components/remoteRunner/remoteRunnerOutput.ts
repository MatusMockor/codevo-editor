import {
  createAgentOutputParserState,
  feedAgentOutput,
  finishAgentOutput,
} from "../../domain/agentOutput/agentOutputParser";
import type { AgentTurnEvent } from "../../domain/agentThread";
import type { RemoteRunnerEvent, RemoteRunnerProvider } from "../../domain/remoteRunner";

const MAX_OUTPUT = 64_000;
/** Reuses the provider parsers so protocol JSON never becomes the conversation UI. */
export function remoteRunnerOutput(
  events: readonly RemoteRunnerEvent[],
  provider: RemoteRunnerProvider,
): Readonly<{ text: string; truncated: boolean }> {
  let parser = createAgentOutputParserState(provider === "claude" ? "claudeCode" : "codex");
  let text = "";
  let truncated = false;
  function append(event: AgentTurnEvent) {
    let line = "";
    switch (event.kind) {
      case "assistantText":
      case "result":
        line = event.text;
        break;
      case "reasoning":
        break;
      case "toolCall":
        line = `${event.name}: ${event.inputSummary}`;
        break;
      case "toolResult":
        line = event.outputSummary;
        break;
      case "error":
        line = event.message;
        break;
      case "unknownLine":
        truncated ||= event.clipped;
        line = event.raw.trimStart().startsWith("{") ? "" : event.raw;
        break;
      case "contextCompaction":
        line = "Context compacted";
        break;
      case "subagent":
        line = event.description ?? "";
        break;
    }
    if (line) text += `${line}\n\n`;
    if (text.length > MAX_OUTPUT) {
      text = text.slice(-MAX_OUTPUT);
      truncated = true;
    }
  }
  for (const event of events) {
    if (event.type === "task.output" && event.text) {
      const next = feedAgentOutput(parser, event.channel ?? "stdout", event.text);
      parser = next.state;
      next.events.forEach(append);
    } else if (event.error) append({ kind: "error", message: event.error });
  }
  finishAgentOutput(parser).events.forEach(append);
  return { text: text.trim(), truncated };
}
