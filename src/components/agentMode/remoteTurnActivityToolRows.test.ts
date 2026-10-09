import { describe, expect, it } from "vitest";
import { RemoteAgentTurnActivityReader } from "../../application/remoteAgentTurnActivityReader";
import { FakeRunnerEvents } from "../../application/remoteAgentTurnActivityTestSupport";
import {
  agentTurnActivityPageRejection,
  agentTurnActivityWindowEvents,
  openAgentTurnActivityWindow,
  prependAgentTurnActivityPage,
  type AgentTurnActivityWindow,
} from "../../domain/agentTurnActivityWindow";
import { AGENT_TURN_LOG_LIMITS, type AgentTurnLogAnchor } from "../../domain/agentTurnLog";
import { MAX_REVEALED_EVENTS_PER_TURN, agentTurnProjection } from "./agentTurnProjection";

const TASK = "task";
const COMMAND = { id: "item_x", type: "command_execution", command: "ls" };

function codexLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

function note(runner: FakeRunnerEvents, index: number): void {
  runner.output(
    TASK,
    codexLine({
      type: "item.completed",
      item: { id: `item_note_${index}`, type: "agent_message", text: `note ${index}` },
    }),
  );
}

async function pagedWindow(runner: FakeRunnerEvents): Promise<AgentTurnActivityWindow | null> {
  const reader = new RemoteAgentTurnActivityReader({
    port: runner,
    target: { serverId: "server", taskId: TASK },
    provider: "codex",
    authorize: () => true,
  });
  let window: AgentTurnActivityWindow | null = null;
  let anchor: AgentTurnLogAnchor = { at: "tail" };
  for (let step = 0; step < 20; step += 1) {
    const page = await reader.readPage({
      anchor,
      maxEvents: 4,
      maxBytes: AGENT_TURN_LOG_LIMITS.pageBytes,
    });
    expect(agentTurnActivityPageRejection(page, anchor)).toBeNull();
    window =
      window === null
        ? openAgentTurnActivityWindow(page)
        : prependAgentTurnActivityPage(window, page);
    if (!page.hasEarlier) return window;
    anchor = { at: "before", seq: page.firstSeq };
  }
  return window;
}

describe("remote turn activity tool rows", () => {
  it("shows one settled row for a tool that started outside the look-behind of its result", async () => {
    const runner = new FakeRunnerEvents(5);
    runner.output(TASK, codexLine({ type: "item.started", item: COMMAND }));
    for (let index = 1; index <= 9; index += 1) note(runner, index);
    runner.output(
      TASK,
      codexLine({
        type: "item.completed",
        item: { ...COMMAND, aggregated_output: "file", exit_code: 0, status: "completed" },
      }),
    );
    for (let index = 10; index <= 13; index += 1) note(runner, index);
    runner.lifecycle(TASK, "task.succeeded");

    const window = await pagedWindow(runner);
    const announced = window?.entries.filter(
      (entry) => entry.event.kind === "toolCall" && entry.event.toolId === COMMAND.id,
    );
    const view = agentTurnActivityWindowEvents(window!);
    const projection = agentTurnProjection(
      view.events,
      null,
      null,
      "settled",
      0,
      MAX_REVEALED_EVENTS_PER_TURN,
      (offset) => `w${view.seqs[offset] ?? 0}`,
    );
    const rows = projection.items.filter(
      (item) => item.kind === "tool" && item.toolId === COMMAND.id,
    );

    expect(window?.gap).toBe(false);
    expect(window?.hasEarlier).toBe(false);
    expect(announced).toHaveLength(2);
    expect(
      agentTurnProjection(window?.entries.map((entry) => entry.event) ?? []).items.filter(
        (item) => item.kind === "tool" && item.toolId === COMMAND.id,
      ),
    ).toHaveLength(2);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "tool", toolId: COMMAND.id });
    expect(rows[0]?.kind === "tool" ? rows[0].outcome : null).not.toBeNull();
    expect(new Set(projection.items.map((item) => item.key)).size).toBe(projection.items.length);
  });
});
