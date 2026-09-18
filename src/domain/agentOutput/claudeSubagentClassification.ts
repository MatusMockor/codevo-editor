import type { AgentTurnEvent } from "../agentThread";

const MAX_NON_AGENT_TASKS = 512;
const EMPTY_TASK_IDS: ReadonlySet<string> = new Set();
export interface ClaudeSubagentClassification {
  readonly nonAgentTaskIds: ReadonlySet<string>;
  readonly full: boolean;
}

/** Untyped terminal notifications must not turn known shell/monitor jobs into agents. */
export function classifyClaudeSubagentTelemetry(
  previous: ClaudeSubagentClassification | undefined,
  events: ReadonlyArray<AgentTurnEvent>,
): {
  readonly state: ClaudeSubagentClassification;
  readonly events: ReadonlyArray<AgentTurnEvent>;
} {
  let nonAgentTaskIds = previous?.nonAgentTaskIds ?? EMPTY_TASK_IDS;
  let full = previous?.full ?? false;
  const explicitAgents = new Set<string>();
  for (const event of events) {
    if (event.kind !== "backgroundTask") continue;
    if (event.taskType === "agent") explicitAgents.add(event.taskId);
    if (event.taskType !== "shell" && event.taskType !== "monitor") continue;
    if (nonAgentTaskIds.has(event.taskId)) continue;
    if (nonAgentTaskIds.size >= MAX_NON_AGENT_TASKS) full = true;
    else nonAgentTaskIds = new Set([...nonAgentTaskIds, event.taskId]);
  }
  return {
    state: { nonAgentTaskIds, full },
    events: [
      ...events.filter(
        (event) =>
          event.kind !== "subagent" ||
          event.taskId === undefined ||
          explicitAgents.has(event.taskId) ||
          (!full && !nonAgentTaskIds.has(event.taskId)),
      ),
      ...(full && previous?.full !== true
        ? [
            {
              kind: "unknownLine" as const,
              stream: "stdout" as const,
              raw: "<subagent task classification limit reached; untyped updates omitted>",
              clipped: true,
            },
          ]
        : []),
    ],
  };
}
