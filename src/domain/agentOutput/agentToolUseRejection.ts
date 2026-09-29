const CLAUDE_TOOL_USE_REJECTION = "The user doesn't want to proceed with this tool use.";

export function isAgentToolUseRejection(outputSummary: string): boolean {
  return outputSummary.trimStart().startsWith(CLAUDE_TOOL_USE_REJECTION);
}
