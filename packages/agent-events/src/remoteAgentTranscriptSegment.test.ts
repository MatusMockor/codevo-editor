import { describe, expect, it } from "vitest";
import type { AgentTurnEvent } from "./agentTurnEvent.js";
import { utf8ByteLength } from "./agentOutput/utf8Text.js";
import {
  boundedRemoteAgentTranscriptLead,
  remoteAgentTranscriptSegment,
  remoteRunnerEventsCarryOutput,
  remoteRunnerEventsEndLine,
  remoteRunnerEventsEndTask,
  type RemoteAgentTranscriptOutputStart,
  type RemoteAgentTranscriptSegmentInput,
} from "./remoteAgentTranscriptSegment.js";
import type { RemoteRunnerEvent } from "./remoteRunnerEvent.js";

const CREATED_AT = "2026-09-13T00:00:00Z";
const LIMITS = {
  maxEvents: 4_000,
  maxBytes: 2_097_152,
  maxLines: 4_000,
  maxPageBytes: 1_048_576,
  maxLeadLines: 4_000,
  maxLeadBytes: 1_048_576,
};
const AT_START: RemoteAgentTranscriptOutputStart = {
  stdoutAtLineBoundary: true,
  stderrAtLineBoundary: true,
};

function parse(
  input: Pick<RemoteAgentTranscriptSegmentInput, "lead" | "outputStart" | "events"> &
    Partial<RemoteAgentTranscriptSegmentInput>,
) {
  return remoteAgentTranscriptSegment({
    provider: "claude",
    finish: false,
    limits: LIMITS,
    ...input,
  });
}

function output(
  sequence: number,
  text: string,
  channel: "stdout" | "stderr" = "stdout",
): RemoteRunnerEvent {
  return { taskId: "task", sequence, type: "task.output", text, channel, createdAt: CREATED_AT };
}

function says(text: string): string {
  return `${JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text }] } })}\n`;
}

function said(text: string): AgentTurnEvent {
  return { kind: "assistantText", text };
}

function chunks(stream: string, cuts: ReadonlyArray<number>, firstSequence: number) {
  const bounds = [0, ...cuts, stream.length];
  return bounds
    .slice(1)
    .map((end, index) => output(firstSequence + index * 3, stream.slice(bounds[index], end)));
}

function leadFor(
  pages: ReadonlyArray<ReadonlyArray<RemoteRunnerEvent>>,
  index: number,
): {
  readonly lead: RemoteRunnerEvent[];
  readonly outputStart: RemoteAgentTranscriptOutputStart | null;
} {
  const lead: RemoteRunnerEvent[] = [];
  for (let older = index - 1; older >= 0; older -= 1) {
    lead.unshift(...(pages[older] ?? []));
    if (older === 0) return { lead, outputStart: AT_START };
    if (remoteRunnerEventsEndLine(pages[older] ?? [], "stdout")) return { lead, outputStart: null };
  }
  return { lead, outputStart: AT_START };
}

function segments(pages: ReadonlyArray<ReadonlyArray<RemoteRunnerEvent>>): AgentTurnEvent[] {
  return pages.flatMap((events, index) => {
    const segment = parse({ ...leadFor(pages, index), events });
    expect(segment.clipped).toBe(false);
    return [...segment.events];
  });
}

describe("remote transcript segment seams", () => {
  it("parses a JSON line cut by the page boundary exactly once, in the later page", () => {
    const stream = says("one") + says("two") + says("three");
    const cut = says("one").length + 12;
    const older = [output(4, stream.slice(0, cut))];
    const newer = [output(9, stream.slice(cut))];

    expect(parse({ lead: [], outputStart: AT_START, events: older })).toEqual({
      events: [said("one")],
      clipped: false,
    });
    expect(parse({ lead: older, outputStart: AT_START, events: newer })).toEqual({
      events: [said("two"), said("three")],
      clipped: false,
    });
  });

  it("discards only the unknown head of a lead that starts inside a line", () => {
    const stream = says("one") + says("two") + says("three");
    const lead = [output(4, stream.slice(9, says("one").length + 12))];
    const events = [output(9, stream.slice(says("one").length + 12))];

    expect(parse({ lead, outputStart: null, events })).toEqual({
      events: [said("two"), said("three")],
      clipped: false,
    });
  });

  it("drops the cut first line silently when the output start is known to be mid-line", () => {
    const stream = says("one") + says("two");
    const events = [output(9, stream.slice(7))];
    const midLine = { stdoutAtLineBoundary: false, stderrAtLineBoundary: false };

    expect(parse({ lead: [], outputStart: midLine, events })).toEqual({
      events: [said("two")],
      clipped: false,
    });
  });

  it("completes a line that spans several raw pages from every page it crosses", () => {
    const long = says("long ".repeat(40));
    const stream = says("one") + long + says("three");
    const start = says("one").length;
    const pages = [
      [output(1, stream.slice(0, start + 20))],
      [output(5, stream.slice(start + 20, start + 90))],
      [output(8, stream.slice(start + 90, start + 150))],
      [output(12, stream.slice(start + 150))],
    ];

    expect(remoteRunnerEventsEndLine(pages[1] ?? [], "stdout")).toBe(false);
    expect(remoteRunnerEventsEndLine(pages[2] ?? [], "stdout")).toBe(false);
    expect(segments([pages[0] ?? [], pages[1] ?? []])).toEqual([said("one")]);
    expect(segments(pages)).toEqual(
      parse({ lead: [], outputStart: AT_START, events: [output(1, stream)] }).events,
    );
    expect(segments(pages)).toEqual([said("one"), said("long ".repeat(40)), said("three")]);
  });

  it("drops a line whose start lies before the lead and says the segment was clipped", () => {
    const long = says("long ".repeat(40));
    const stream = says("one") + long + says("three");
    const start = says("one").length;
    const middle = [output(5, stream.slice(start + 20, start + 90))];
    const last = [output(8, stream.slice(start + 90))];

    expect(parse({ lead: middle, outputStart: null, events: last })).toEqual({
      events: [said("three")],
      clipped: true,
    });
    expect(parse({ lead: middle, outputStart: null, events: middle })).toEqual({
      events: [],
      clipped: false,
    });
  });

  it("matches one forward parse for every pair of cut positions", () => {
    const stream = says("a") + says("bb") + says("ccc");
    const expected = [said("a"), said("bb"), said("ccc")];
    let checked = 0;
    for (let first = 1; first < stream.length - 1; first += 1) {
      for (let second = first + 1; second < stream.length; second += 1) {
        const [head, middle, tail] = chunks(stream, [first, second], 10);
        expect(segments([[head!], [middle!], [tail!]])).toEqual(expected);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(1_000);
  });

  it("matches one forward parse when every page holds several small chunks", () => {
    const stream = says("alpha") + says("beta") + says("gamma") + says("delta");
    const expected = [said("alpha"), said("beta"), said("gamma"), said("delta")];
    for (let size = 1; size <= 40; size += 1) {
      const cuts = Array.from(
        { length: Math.ceil(stream.length / size) - 1 },
        (_, index) => (index + 1) * size,
      );
      const all = chunks(stream, cuts, 1);
      const pages = [0, 1, 2, 3, 4].map((page) =>
        all.filter((_, index) => Math.floor((index * 5) / all.length) === page),
      );
      expect(segments(pages)).toEqual(expected);
    }
  });

  it("reports whether raw events carry or end a line of one stream", () => {
    const warning = [output(1, "x\n", "stderr")];
    expect(remoteRunnerEventsEndLine(warning, "stdout")).toBe(false);
    expect(remoteRunnerEventsEndLine(warning, "stderr")).toBe(true);
    expect(remoteRunnerEventsCarryOutput(warning, "stdout")).toBe(false);
    expect(remoteRunnerEventsCarryOutput(warning, "stderr")).toBe(true);
    expect(remoteRunnerEventsCarryOutput([output(1, "x")], "stdout")).toBe(true);
    expect(remoteRunnerEventsEndLine([output(1, "x")], "stdout")).toBe(false);
    expect(remoteRunnerEventsEndLine([output(1, "x"), output(2, "y\n")], "stdout")).toBe(true);
  });
});

describe("remote transcript segment stderr framing", () => {
  const first = [output(1, says("zero")), output(2, "prefix ", "stderr")];
  const second = [output(4, says("one")), output(5, "middle ", "stderr")];
  const third = [output(7, "tail\n", "stderr"), output(8, says("two"))];

  it("keeps stderr out of stdout line framing on both sides of the seam", () => {
    const stream = says("one") + says("two");
    const cut = says("one").length + 10;
    const lead = [
      output(1, stream.slice(4, cut)),
      output(2, "lead warning\n", "stderr"),
      output(3, "half ", "stderr"),
    ];
    const events = [
      output(6, "warning\n", "stderr"),
      output(7, stream.slice(cut)),
      output(8, "tail warning\n", "stderr"),
    ];

    expect(parse({ lead, outputStart: null, events })).toEqual({
      events: [
        { kind: "unknownLine", stream: "stderr", raw: "half warning", clipped: false },
        said("two"),
        { kind: "unknownLine", stream: "stderr", raw: "tail warning", clipped: false },
      ],
      clipped: false,
    });
  });

  it("never emits the tail of a stderr line whose start lies before the lead", () => {
    expect(parse({ lead: second, outputStart: null, events: third })).toEqual({
      events: [said("two")],
      clipped: true,
    });
  });

  it("emits the whole stderr line once the lead reaches its start", () => {
    expect(parse({ lead: [...first, ...second], outputStart: AT_START, events: third })).toEqual({
      events: [
        { kind: "unknownLine", stream: "stderr", raw: "prefix middle tail", clipped: false },
        said("two"),
      ],
      clipped: false,
    });
  });

  it("applies the same rule to the unterminated stderr line flushed when the task ended", () => {
    const ending = [output(7, "tail", "stderr")];

    expect(parse({ lead: second, outputStart: null, events: ending, finish: true })).toEqual({
      events: [],
      clipped: true,
    });
    expect(
      parse({ lead: [...first, ...second], outputStart: AT_START, events: ending, finish: true }),
    ).toEqual({
      events: [
        { kind: "unknownLine", stream: "stderr", raw: "prefix middle tail", clipped: false },
      ],
      clipped: false,
    });
  });

  it("treats stderr that was silent through the whole lead as starting a line", () => {
    const lead = [output(4, says("one"))];

    expect(parse({ lead, outputStart: null, events: third })).toEqual({
      events: [{ kind: "unknownLine", stream: "stderr", raw: "tail", clipped: false }, said("two")],
      clipped: false,
    });
  });

  it("flags stdout that was silent through the whole lead instead of trusting its first line", () => {
    const lead = [output(4, "warning\n", "stderr")];

    expect(parse({ lead, outputStart: null, events: [output(8, says("two"))] })).toEqual({
      events: [said("two")],
      clipped: true,
    });
  });
});

describe("remote transcript segment limits", () => {
  const dense = Array.from({ length: 50 }, (_, index) => output(index + 1, "x\n".repeat(4_096)));

  it("stops parsing a dense page at its line cap and reports the clip", () => {
    const limits = { ...LIMITS, maxLines: 4_100 };
    const segment = parse({ lead: [], outputStart: AT_START, events: dense, limits });

    expect(segment.events).toHaveLength(4_000);
    expect(segment.clipped).toBe(true);
    expect(parse({ lead: [], outputStart: AT_START, events: dense, limits })).toEqual(segment);
    expect(
      parse({ lead: [], outputStart: AT_START, events: dense, limits: { ...LIMITS, maxLines: 7 } })
        .events,
    ).toHaveLength(7);
  });

  it("stops at its event and byte caps and keeps the earliest events", () => {
    const events = [output(1, says("a") + says("b")), output(2, says("c") + says("d"))];
    const byCount = parse({
      lead: [],
      outputStart: AT_START,
      events,
      limits: { ...LIMITS, maxEvents: 3 },
    });
    const byBytes = parse({
      lead: [],
      outputStart: AT_START,
      events,
      limits: { ...LIMITS, maxBytes: 1 },
    });

    expect(byCount).toEqual({ events: [said("a"), said("b"), said("c")], clipped: true });
    expect(byBytes).toEqual({ events: [said("a")], clipped: true });
    expect(parse({ lead: [], outputStart: AT_START, events })).toEqual({
      events: [said("a"), said("b"), said("c"), said("d")],
      clipped: false,
    });
  });

  it("warms up from a bounded tail of a dense lead and still frames the seam", () => {
    const line = says("seam");
    const lead = [...dense, output(60, line.slice(0, 9))];
    const events = [output(61, line.slice(9))];
    const limits = { ...LIMITS, maxLeadLines: 10 };

    expect(parse({ lead, outputStart: AT_START, events, limits })).toEqual({
      events: [said("seam")],
      clipped: false,
    });
  });

  it("budgets each stream on its own so a dense stdout lead cannot hide a stderr line start", () => {
    const lead = [
      output(1, "prefix ", "stderr"),
      ...dense.map((event) => ({ ...event, sequence: event.sequence + 1 })),
    ];
    const events = [output(60, "tail\n", "stderr")];
    const limits = { ...LIMITS, maxLeadLines: 10, maxLeadBytes: 64 };

    expect(parse({ lead, outputStart: AT_START, events, limits })).toEqual({
      events: [{ kind: "unknownLine", stream: "stderr", raw: "prefix tail", clipped: false }],
      clipped: false,
    });
  });
});

describe("remote transcript segment look-behind byte budget", () => {
  function saysMany(text: string, blocks: number): string {
    const content = Array.from({ length: blocks }, (_, index) => ({
      type: "text",
      text: `${text}${index} `,
    }));
    return `${JSON.stringify({ type: "assistant", message: { content } })}\n`;
  }

  function streamText(events: ReadonlyArray<RemoteRunnerEvent>, channel: "stdout" | "stderr") {
    return events
      .filter((event) => (event.channel ?? "stdout") === channel)
      .map((event) => event.text ?? "")
      .join("");
  }

  const seam = says("seam");
  const denseLines = Array.from({ length: 40 }, (_, index) => saysMany(`block${index}-`, 200));
  const denseStream = denseLines.join("") + seam.slice(0, 9);
  const denseLead = chunks(
    denseStream,
    Array.from({ length: Math.floor(denseStream.length / 700) }, (_, index) => (index + 1) * 700),
    1,
  );
  const limits = { ...LIMITS, maxLeadBytes: 20_000 };

  it("feeds only the most recent bytes of a many-events-per-line lead", () => {
    const bounded = boundedRemoteAgentTranscriptLead(denseLead, limits);
    const kept = streamText(bounded.events, "stdout");
    const framed = kept.slice(kept.indexOf("\n") + 1);

    expect(utf8ByteLength(denseStream)).toBeGreaterThan(10 * limits.maxLeadBytes);
    expect(bounded.stdout).toBe("cut");
    expect(bounded.stderr).toBe("whole");
    expect(utf8ByteLength(kept)).toBeLessThanOrEqual(limits.maxLeadBytes);
    expect(utf8ByteLength(kept)).toBeGreaterThan(limits.maxLeadBytes - 700);
    expect(denseStream.endsWith(kept)).toBe(true);
    expect(framed.length).toBeGreaterThan(0);
    expect(denseStream.charAt(denseStream.length - framed.length - 1)).toBe("\n");
    expect(
      boundedRemoteAgentTranscriptLead(denseLead, LIMITS).events.map((event) => event.text),
    ).toEqual(denseLead.map((event) => event.text));
  });

  it("cuts inside the boundary chunk right after a newline when it holds one", () => {
    const oneChunk = [output(1, denseStream)];
    const bounded = boundedRemoteAgentTranscriptLead(oneChunk, limits);
    const kept = streamText(bounded.events, "stdout");

    expect(bounded.stdout).toBe("resumed");
    expect(utf8ByteLength(kept)).toBeLessThanOrEqual(limits.maxLeadBytes);
    expect(kept.length).toBeGreaterThan(0);
    expect(denseStream.endsWith(kept)).toBe(true);
    expect(denseStream.charAt(denseStream.length - kept.length - 1)).toBe("\n");
    expect(
      parse({
        lead: oneChunk,
        outputStart: AT_START,
        events: [output(2, seam.slice(9))],
        limits,
      }),
    ).toEqual({ events: [said("seam")], clipped: false });
  });

  it("still frames the seam after the byte cut and does not call it clipped", () => {
    const events = [output(9_000, seam.slice(9) + says("after"))];

    expect(parse({ lead: denseLead, outputStart: AT_START, events, limits })).toEqual({
      events: [said("seam"), said("after")],
      clipped: false,
    });
    expect(parse({ lead: denseLead, outputStart: AT_START, events, limits })).toEqual(
      parse({ lead: denseLead, outputStart: AT_START, events }),
    );
  });

  it("counts multi-byte text by its bytes", () => {
    const stream = `${"é".repeat(300)}\n${"é".repeat(300)}\n${"é".repeat(300)}\n`;
    const bounded = boundedRemoteAgentTranscriptLead(chunks(stream, [450], 1), {
      maxLeadLines: 4_000,
      maxLeadBytes: 1_300,
    });

    expect(streamText(bounded.events, "stdout")).toBe(`${"é".repeat(300)}\n${"é".repeat(300)}\n`);
    expect(bounded.stdout).toBe("resumed");
  });

  it("drops a line whose start the byte cut removed and reports the clip", () => {
    const long = says("y".repeat(6_000));
    const stream = says("zero") + long.slice(0, 5_000);
    const lead = chunks(stream, [1_000, 2_000, 3_000, 4_000], 1);
    const events = [output(50, long.slice(5_000) + says("after"))];
    const tight = { ...LIMITS, maxLeadBytes: 2_000 };

    expect(boundedRemoteAgentTranscriptLead(lead, tight).stdout).toBe("cut");
    expect(parse({ lead, outputStart: AT_START, events, limits: tight })).toEqual({
      events: [said("after")],
      clipped: true,
    });
    expect(parse({ lead, outputStart: AT_START, events })).toEqual({
      events: [said("y".repeat(6_000)), said("after")],
      clipped: false,
    });
  });

  it("drops a stderr tail whose start the byte cut removed and reports the clip", () => {
    const lead = [
      output(1, "prefix ", "stderr"),
      output(2, says("one")),
      output(3, "m".repeat(1_500), "stderr"),
      output(4, "m".repeat(1_500), "stderr"),
    ];
    const events = [output(9, " tail\n", "stderr"), output(10, says("two"))];
    const tight = { ...LIMITS, maxLeadBytes: 2_000 };

    expect(boundedRemoteAgentTranscriptLead(lead, tight).stderr).toBe("cut");
    expect(parse({ lead, outputStart: AT_START, events, limits: tight })).toEqual({
      events: [said("two")],
      clipped: true,
    });
    expect(parse({ lead, outputStart: AT_START, events }).clipped).toBe(false);
  });

  it("treats a cut run longer than the line cap as the oversize line it is", () => {
    const lead = chunks("z".repeat(600_000), [200_000, 400_000], 1);
    const events = [output(9, `${"z".repeat(10)}\n${says("after")}`)];
    const tight = { ...LIMITS, maxLeadBytes: 500_000 };

    expect(boundedRemoteAgentTranscriptLead(lead, tight).stdout).toBe("cut");
    expect(parse({ lead, outputStart: null, events, limits: tight })).toEqual({
      events: [said("after")],
      clipped: false,
    });
  });
});

describe("remote transcript segment page caps", () => {
  function saysMany(text: string, blocks: number): string {
    const content = Array.from({ length: blocks }, (_, index) => ({
      type: "text",
      text: `${text}${index} `,
    }));
    return `${JSON.stringify({ type: "assistant", message: { content } })}\n`;
  }

  const firstChunk = Array.from({ length: 10 }, (_, line) => saysMany(`l${line}-`, 200)).join("");
  const events = [output(1, firstChunk), output(2, says("later")), output(3, says("last"))];
  const whole = parse({ lead: [], outputStart: AT_START, events });

  it("stops inside the first chunk once it alone exceeds the event cap", () => {
    const capped = parse({
      lead: [],
      outputStart: AT_START,
      events,
      limits: { ...LIMITS, maxEvents: 250 },
    });

    expect(whole.clipped).toBe(false);
    expect(whole.events.length).toBeGreaterThan(250);
    expect(capped.clipped).toBe(true);
    expect(capped.events).toEqual(whole.events.slice(0, 250));
    expect(
      parse({ lead: [], outputStart: AT_START, events, limits: { ...LIMITS, maxEvents: 250 } }),
    ).toEqual(capped);
  });

  it("stops at a line end inside a chunk once the retained byte cap is reached", () => {
    const capped = parse({
      lead: [],
      outputStart: AT_START,
      events,
      limits: { ...LIMITS, maxBytes: 3_000 },
    });

    expect(capped.clipped).toBe(true);
    expect(capped.events.length).toBeGreaterThan(0);
    expect(capped.events).toEqual(whole.events.slice(0, capped.events.length));
  });

  it("stops feeding at the page byte budget, at a line end, and reports the clip", () => {
    const line = saysMany("l0-", 200);
    const capped = parse({
      lead: [],
      outputStart: AT_START,
      events,
      limits: { ...LIMITS, maxPageBytes: utf8ByteLength(line) * 2 + 10 },
    });

    expect(capped.clipped).toBe(true);
    expect(capped.events).toEqual(whole.events.slice(0, 400));
    expect(
      parse({
        lead: [],
        outputStart: AT_START,
        events: [output(1, says("one")), output(2, says("two"))],
        limits: { ...LIMITS, maxPageBytes: utf8ByteLength(says("one")) * 2 },
      }),
    ).toEqual({ events: [said("one"), said("two")], clipped: false });
  });
});

describe("remote transcript segment records", () => {
  it("flushes an unterminated last line only when the task ended", () => {
    const events = [output(1, says("one") + "trailing")];

    expect(parse({ lead: [], outputStart: AT_START, events }).events).toEqual([said("one")]);
    expect(parse({ lead: [], outputStart: AT_START, events, finish: true }).events).toEqual([
      said("one"),
      { kind: "unknownLine", stream: "stdout", raw: "trailing", clipped: false },
    ]);
  });

  it("emits accepted inputs and errors of the segment but not of its lead", () => {
    const accepted = (sequence: number, text: string): RemoteRunnerEvent => ({
      taskId: "task",
      sequence,
      type: "task.input",
      createdAt: CREATED_AT,
      messageId: `message-${sequence}`,
      parts: [
        { type: "text", text },
        { type: "attachment", attachmentId: "image" },
      ],
    });
    const failed: RemoteRunnerEvent = {
      taskId: "task",
      sequence: 9,
      type: "task.failed",
      createdAt: CREATED_AT,
      error: "boom",
    };

    expect(
      parse({
        lead: [accepted(1, "earlier"), { ...failed, sequence: 2 }],
        outputStart: AT_START,
        events: [output(5, says("one")), accepted(6, "steer"), failed],
        finish: true,
      }).events,
    ).toEqual([
      said("one"),
      { kind: "userMessage", remoteMessageId: "message-6", text: "steer" },
      { kind: "error", message: "boom" },
    ]);
    expect(remoteRunnerEventsEndTask([failed])).toBe(true);
    expect(remoteRunnerEventsEndTask([output(1, "x\n")])).toBe(false);
  });

  it("restores parser state from the lead so a tool started there is not announced twice", () => {
    const item = { id: "item_1", type: "command_execution", command: "ls" };
    const started = `${JSON.stringify({ type: "item.started", item })}\n`;
    const completed = `${JSON.stringify({
      type: "item.completed",
      item: { ...item, aggregated_output: "file", exit_code: 0, status: "completed" },
    })}\n`;
    const withLead = parse({
      provider: "codex",
      lead: [output(1, started)],
      outputStart: AT_START,
      events: [output(2, completed)],
    });
    const withoutLead = parse({
      provider: "codex",
      lead: [],
      outputStart: AT_START,
      events: [output(2, completed)],
    });

    expect(withLead.events.map((event) => event.kind)).toEqual(["toolResult"]);
    expect(withoutLead.events.map((event) => event.kind)).toEqual(["toolCall", "toolResult"]);
  });
});
