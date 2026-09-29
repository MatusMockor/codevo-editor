import { describe, expect, it } from "vitest";
import type { AgentTurnEvent } from "./agentThread";
import {
  projectAgentBackgroundState,
  resolveAgentBackgroundActivity,
} from "./agentBackgroundActivity";

const pollCall: AgentTurnEvent = {
  kind: "toolCall",
  toolId: "toolu_01SvfpGmZKYToWiKzG5TaQUN",
  name: "Bash",
  inputSummary: "for i in $(seq 1 110); do S=$(glab api pipelines/404539 ...); done",
  description: "Poll the CRM MR pipeline until it finishes and list failed jobs",
};
const pollStarted: AgentTurnEvent = {
  kind: "backgroundTask",
  taskId: "baa0ysq6h",
  status: "starting",
  taskType: "shell",
  description: "Poll the CRM MR pipeline until it finishes and list failed jobs",
};
const pollLaunched: AgentTurnEvent = {
  kind: "toolResult",
  toolId: "toolu_01SvfpGmZKYToWiKzG5TaQUN",
  outputSummary: "Command running in background with ID: baa0ysq6h.",
  isError: false,
};
const watchingAnswer: AgentTurnEvent = {
  kind: "assistantText",
  text: "Pipeline na CRM MR este bezi, sledujem ju na pozadi a ozvem sa s vysledkom.",
};
const pollCompleted: AgentTurnEvent = {
  kind: "backgroundTask",
  taskId: "baa0ysq6h",
  status: "completed",
  taskType: "other",
};
const firstResult: AgentTurnEvent = {
  kind: "result",
  text: "Pipeline na CRM MR este bezi.",
  isError: false,
  usage: null,
};

const whileWatching: ReadonlyArray<AgentTurnEvent> = [
  pollCall,
  pollStarted,
  pollLaunched,
  watchingAnswer,
];
const afterNotification: ReadonlyArray<AgentTurnEvent> = [
  ...whileWatching,
  { kind: "contextUsage", model: "claude-fable-5-1", inputTokens: 377576, contextWindow: null },
  firstResult,
  pollCompleted,
  pollCompleted,
];

const settled = (events: ReadonlyArray<AgentTurnEvent>, processAlive: boolean) =>
  resolveAgentBackgroundActivity(projectAgentBackgroundState(events, processAlive), "settled");

describe("background activity for the recorded Telekom phone pipeline watch", () => {
  it("reports one monitoring task while the owning process still runs the poll loop", () => {
    expect(settled(whileWatching, true)).toEqual({
      phase: "monitoring",
      foregroundSettled: true,
      tasks: [
        {
          taskId: "baa0ysq6h",
          taskType: "shell",
          description: "Poll the CRM MR pipeline until it finishes and list failed jobs",
        },
      ],
      truncated: false,
    });
  });

  it("clears the task on the duplicated completion bookends the CLI emitted", () => {
    expect(settled(afterNotification, true)).toMatchObject({ phase: "inactive", tasks: [] });
  });

  it("never reports the recorded task as live without its owning process", () => {
    expect(settled(whileWatching, false)).toMatchObject({ phase: "inactive", tasks: [] });
  });
});
