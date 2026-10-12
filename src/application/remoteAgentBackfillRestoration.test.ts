import { expect, it } from "vitest";
import { projectAgentBackgroundState } from "../domain/agentBackgroundActivity";
import { agentContextWindow } from "../domain/agentContextWindow";
import { buildAgentThreadSearchDocument } from "../domain/agentThreadSearch";
import { agentTurnArtifactReferences } from "../domain/agentTurnArtifactReferences";
import { agentTurnContentLost, agentTurnWindowDisplay } from "../domain/agentTurnContentLoss";
import { aggregateAgentUsage } from "../domain/agentUsage";
import type { RemoteAgentInventorySnapshot } from "./remoteAgentInventoryLoad";
import { projectRemoteAgentThreads } from "./remoteAgentProjection";
import {
  fakeRunnerGateway,
  loadUntilSettled,
  remoteTurn,
  TAIL_FIRST_THREAD,
} from "./remoteAgentTailFirstTestSupport";
import { FakeRunnerEvents } from "./remoteAgentTurnActivityTestSupport";

const NOW = Date.parse("2026-09-13T01:00:00Z");

function assistantLine(text: string, inputTokens: number): string {
  return `${JSON.stringify({
    type: "assistant",
    message: {
      model: "claude-main",
      content: [{ type: "text", text }],
      usage: { input_tokens: inputTokens },
    },
  })}\n`;
}

function resultLine(): string {
  return `${JSON.stringify({
    type: "result",
    subtype: "success",
    result: "done",
    usage: { input_tokens: 5_000, output_tokens: 700 },
    total_cost_usd: 0.5,
    modelUsage: { "claude-main": { contextWindow: 200_000 } },
  })}\n`;
}

function emitMeasuredTurn(runner: FakeRunnerEvents): void {
  const stream = [
    assistantLine("zebra-needle see [Report](out/report.html) ", 1_000),
    ...Array.from({ length: 300 }, (_, index) => assistantLine(`step ${index} `, 1_001 + index)),
    resultLine(),
  ].join("");
  runner.lifecycle("turn-1", "task.created");
  for (let offset = 0; offset < stream.length; offset += 97)
    runner.output("turn-1", stream.slice(offset, offset + 97));
  runner.lifecycle("turn-1", "task.succeeded");
}

function consumers(snapshot: RemoteAgentInventorySnapshot) {
  const thread = projectRemoteAgentThreads({ ...snapshot, runnerId: "runner" }).find(
    (view) => view.thread.threadId === TAIL_FIRST_THREAD,
  )!.thread;
  const turn = thread.turns[0]!;
  const search = buildAgentThreadSearchDocument(thread);
  return {
    eventsTruncated: turn.eventsTruncated,
    eventsRetention: turn.eventsRetention,
    streamComplete: turn.streamMetrics?.complete,
    contentLost: agentTurnContentLost(turn.eventsTruncated, null),
    windowDisplay: agentTurnWindowDisplay(turn.eventsTruncated, null),
    contextWindow: agentContextWindow(thread),
    usage: aggregateAgentUsage([thread], "today", NOW),
    artifacts: agentTurnArtifactReferences(turn, null),
    searchTruncated: search.truncated,
    searchFindsStart: search.segments.some((segment) => segment.lower.includes("zebra-needle")),
    backgroundTruncated: projectAgentBackgroundState(turn.events, true, turn.eventsTruncated)
      .truncated,
  };
}

it("restores everything a truncated turn degrades once its backfill completes", async () => {
  const runner = new FakeRunnerEvents();
  emitMeasuredTurn(runner);
  const forward = fakeRunnerGateway(runner, [remoteTurn(1)], {});
  const tailFirst = fakeRunnerGateway(runner, [remoteTurn(1)]);
  const progress: RemoteAgentInventorySnapshot[] = [];

  const expected = consumers(await loadUntilSettled(forward.gateway, runner));
  const settled = await loadUntilSettled(tailFirst.gateway, runner, (snapshot) =>
    progress.push(snapshot),
  );
  const opened = consumers(progress.find((snapshot) => snapshot.replays.has("turn-1"))!);
  const restored = consumers(settled);

  expect(opened).toMatchObject({
    eventsTruncated: true,
    eventsRetention: "clientWindow",
    streamComplete: false,
    contentLost: true,
    windowDisplay: "lost",
    contextWindow: null,
    artifacts: [],
    searchTruncated: true,
    searchFindsStart: false,
    backgroundTruncated: true,
  });
  expect(opened.usage).not.toEqual(expected.usage);
  expect(restored).toEqual(expected);
  expect(restored).toMatchObject({
    eventsTruncated: false,
    eventsRetention: undefined,
    streamComplete: true,
    contentLost: false,
    windowDisplay: "complete",
    contextWindow: { usedTokens: 1_300, contextWindow: 200_000 },
    artifacts: [{ path: "out/report.html", label: "Report" }],
    searchTruncated: false,
    searchFindsStart: true,
    backgroundTruncated: false,
  });
});
