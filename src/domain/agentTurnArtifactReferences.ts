import { extractAgentArtifactReferences, type AgentArtifactReference } from "./agentArtifact";
import type { AgentTurn } from "./agentThread";
import { agentTurnWindowDisplay, type AgentTurnLogEvidence } from "./agentTurnContentLoss";

/** Match presentation references without ever inspecting prompts, reasoning or tool logs. */
export function agentTurnArtifactReferences(
  turn: AgentTurn,
  evidence: AgentTurnLogEvidence | null,
): readonly AgentArtifactReference[] {
  // A missing prefix can contain a Markdown fence or other parsing context.
  // Never promote a retained example link into authority to capture a workspace file.
  if (agentTurnWindowDisplay(turn.eventsTruncated, evidence) !== "complete") return [];
  let markdown = "";
  for (const event of turn.events) {
    if (event.kind === "assistantText") markdown += event.text;
    else if (event.kind === "result") markdown += `\n${event.text}\n`;
    if (markdown.length > 256 * 1024) return [];
  }
  return extractAgentArtifactReferences(markdown);
}
