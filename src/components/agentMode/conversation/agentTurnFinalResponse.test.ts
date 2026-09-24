import { describe, expect, it } from "vitest";
import type { AgentTurnItem } from "../agentTurnProjection";
import { agentFinalResponseItems, agentItemsBeforeFinalResponse } from "./agentTurnFinalResponse";

const tool: AgentTurnItem = {
  kind: "tool",
  key: "w1",
  toolId: "t1",
  name: "Bash",
  inputSummary: "ls",
  outcome: null,
  rowKind: "command",
  status: "ok",
  label: "Ran ls",
  argument: null,
  command: "ls",
  output: null,
};
const update: AgentTurnItem = {
  kind: "assistantText",
  key: "w2",
  text: "Next",
  paragraphs: ["Next"],
};
const answer: AgentTurnItem = {
  kind: "assistantText",
  key: "w3",
  text: "Done",
  paragraphs: ["Done"],
};

describe("final response split", () => {
  it("splits at the last assistant text", () => {
    expect(agentFinalResponseItems([tool, update, tool, answer])).toEqual([answer]);
    expect(agentItemsBeforeFinalResponse([tool, update, tool, answer])).toEqual([
      tool,
      update,
      tool,
    ]);
  });

  it("keeps everything as work when there is no final response", () => {
    expect(agentFinalResponseItems([tool])).toEqual([]);
    expect(agentItemsBeforeFinalResponse([tool])).toEqual([tool]);
  });
});
