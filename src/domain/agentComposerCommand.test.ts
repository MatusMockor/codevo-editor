import { describe, expect, it } from "vitest";
import {
  agentComposerCommandQuery,
  agentComposerCommands,
  filterAgentComposerCommands,
} from "./agentComposerCommand";

describe("composer command discovery", () => {
  it("limits provider actions to their implemented provider and session scope", () => {
    expect(agentComposerCommands("codex", true).map(({ id }) => id)).toEqual([
      "model",
      "permissions",
      "new",
      "settings",
    ]);
    expect(agentComposerCommands("claudeCode", false).map(({ id }) => id)).not.toContain("compact");
    expect(agentComposerCommands("claudeCode", true).map(({ id }) => id)).toContain("compact");
  });

  it.each([
    ["/", ""],
    ["/mod", "mod"],
    ["/MODEL", "model"],
    ["/plan ", "plan"],
  ])("recognizes a command query %s", (prompt, expected) => {
    expect(agentComposerCommandQuery(prompt)).toBe(expected);
  });

  it.each([
    "hello /model",
    " /model",
    "/model opus",
    "/tmp/project",
    "/model\n",
    "/model\nother text",
    "//model",
    "```/model```",
    `/${"a".repeat(33)}`,
  ])("leaves ordinary text unchanged: %s", (prompt) => {
    expect(agentComposerCommandQuery(prompt)).toBeNull();
  });

  it("filters a bounded local catalogue without inventing unsupported commands", () => {
    const commands = agentComposerCommands("claudeCode", true);
    expect(filterAgentComposerCommands(commands, "MOD").map(({ id }) => id)).toEqual([
      "model",
      "plan",
    ]);
    expect(filterAgentComposerCommands(commands, "btw")).toEqual([]);
    expect(filterAgentComposerCommands(commands, "a".repeat(33))).toEqual([]);
    expect(filterAgentComposerCommands(commands, "")).toEqual(commands);
  });
});
