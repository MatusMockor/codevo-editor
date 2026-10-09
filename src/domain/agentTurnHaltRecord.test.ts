import { describe, expect, it } from "vitest";
import wire from "../../contracts/agent-turn-halt-request-wire.json";
import {
  AGENT_TURN_HALT_ESCALATION_SOURCES,
  AGENT_TURN_HALT_MODES,
  AGENT_TURN_HALT_SOURCES,
  attachAgentTurnHaltRequests,
  parseAgentTurnHaltRecord,
  recordAgentTurnHalt,
  serializeAgentTurnHaltRequests,
  type AgentTurnHaltRecord,
  type AgentTurnHaltSubject,
} from "./agentTurnHaltRecord";

const INTERRUPT: AgentTurnHaltRecord = {
  source: "composerEscape",
  mode: "softInterrupt",
  requestedAtEpochMs: 1_000,
};

const ESCALATED: AgentTurnHaltRecord = {
  ...INTERRUPT,
  escalation: { source: "interruptRefused", requestedAtEpochMs: 1_500 },
};

describe("agent turn halt record contract", () => {
  it("pins the closed variants shared with the Rust history store", () => {
    expect(AGENT_TURN_HALT_SOURCES).toEqual(wire.sources);
    expect(AGENT_TURN_HALT_ESCALATION_SOURCES).toEqual(wire.escalationSources);
    expect(AGENT_TURN_HALT_MODES).toEqual(wire.modes);
  });

  it("reads and writes every valid request of the shared fixture unchanged", () => {
    for (const request of wire.valid) {
      const turn: AgentTurnHaltSubject = { turnId: request.turnId };
      const attached = attachAgentTurnHaltRequests([turn], [request]);

      expect(attached[0]?.haltRequest).toBeDefined();
      expect(serializeAgentTurnHaltRequests(attached)).toEqual([request]);
    }
  });

  it("reads every invalid request of the shared fixture as no record", () => {
    for (const request of wire.invalid) {
      const turn = { turnId: request.turnId };

      expect(attachAgentTurnHaltRequests([turn], [request])).toEqual([turn]);
    }
  });

  it("keeps only the original request of an incoherent shared-fixture escalation", () => {
    for (const request of wire.invalidEscalation) {
      const { escalation, ...original } = request;
      const attached = attachAgentTurnHaltRequests([{ turnId: request.turnId }], [request]);

      expect(escalation).toBeDefined();
      expect(serializeAgentTurnHaltRequests(attached)).toEqual([original]);
    }
  });

  it("round-trips every source and mode", () => {
    for (const source of AGENT_TURN_HALT_SOURCES) {
      for (const mode of AGENT_TURN_HALT_MODES) {
        const record = { source, mode, requestedAtEpochMs: 7 };
        expect(parseAgentTurnHaltRecord(record)).toEqual(record);
      }
    }
    expect(parseAgentTurnHaltRecord(ESCALATED)).toEqual(ESCALATED);
  });

  it.each([
    null,
    "composerEscape",
    [],
    {},
    { ...INTERRUPT, source: "windowEscape" },
    { ...INTERRUPT, source: "interruptRefused" },
    { ...INTERRUPT, mode: "pause" },
    { ...INTERRUPT, requestedAtEpochMs: -1 },
    { ...INTERRUPT, requestedAtEpochMs: 1.5 },
    { ...INTERRUPT, requestedAtEpochMs: "1000" },
    { ...INTERRUPT, requestedAtEpochMs: Number.MAX_SAFE_INTEGER + 1 },
    { ...INTERRUPT, note: "free text" },
    { source: "composerEscape", mode: "softInterrupt" },
  ])("degrades an unknown or garbled record to no record: %j", (value) => {
    expect(parseAgentTurnHaltRecord(value)).toBeNull();
  });

  it.each([
    { source: "elsewhere", requestedAtEpochMs: 1_500 },
    { source: "sessionDock", requestedAtEpochMs: 999 },
    { source: "sessionDock", requestedAtEpochMs: 1_500, note: "x" },
    { source: "sessionDock" },
    null,
  ])("keeps the original request when its escalation is garbled: %j", (escalation) => {
    expect(parseAgentTurnHaltRecord({ ...INTERRUPT, escalation })).toEqual(INTERRUPT);
  });

  it("drops an escalation stored on a hard stop", () => {
    const hardStop = { ...INTERRUPT, mode: "hardStop" } as const;

    expect(parseAgentTurnHaltRecord({ ...hardStop, escalation: ESCALATED.escalation })).toEqual(
      hardStop,
    );
  });
});

describe("recording a halt request", () => {
  it("lets the first request win", () => {
    const first = recordAgentTurnHalt(undefined, {
      trigger: { kind: "ui", source: "composerEscape" },
      mode: "softInterrupt",
      requestedAtEpochMs: 1_000,
    });

    expect(first).toEqual(INTERRUPT);
    expect(
      recordAgentTurnHalt(first, {
        trigger: { kind: "ui", source: "threadMenu" },
        mode: "softInterrupt",
        requestedAtEpochMs: 2_000,
      }),
    ).toBe(first);
  });

  it("captures one escalation and never moves it before the original request", () => {
    const escalated = recordAgentTurnHalt(INTERRUPT, {
      trigger: { kind: "ui", source: "sessionDock" },
      mode: "hardStop",
      requestedAtEpochMs: 400,
    });

    expect(escalated).toEqual({
      ...INTERRUPT,
      escalation: { source: "sessionDock", requestedAtEpochMs: 1_000 },
    });
    expect(
      recordAgentTurnHalt(escalated, {
        trigger: { kind: "interruptRefused", source: "composerEscape" },
        mode: "hardStop",
        requestedAtEpochMs: 3_000,
      }),
    ).toBe(escalated);
  });

  it("ignores an unusable request time", () => {
    for (const requestedAtEpochMs of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        recordAgentTurnHalt(undefined, {
          trigger: { kind: "ui", source: "composerEscape" },
          mode: "hardStop",
          requestedAtEpochMs,
        }),
      ).toBeUndefined();
    }
  });
});

describe("halt requests on the history wire", () => {
  const turns = [
    { turnId: "agt-turn-0001" },
    { turnId: "agt-turn-0002", haltRequest: ESCALATED },
    { turnId: "agt-turn-0003", haltRequest: INTERRUPT },
  ];

  it("serializes only turns that carry a record", () => {
    expect(serializeAgentTurnHaltRequests(turns)).toEqual([
      { turnId: "agt-turn-0002", ...ESCALATED },
      { turnId: "agt-turn-0003", ...INTERRUPT },
    ]);
    expect(serializeAgentTurnHaltRequests([{ turnId: "agt-turn-0001" }])).toEqual([]);
  });

  it("attaches each record to its exact turn and round-trips the serialized form", () => {
    const bare = turns.map(({ turnId }) => ({ turnId }));

    expect(attachAgentTurnHaltRequests(bare, serializeAgentTurnHaltRequests(turns))).toEqual(turns);
    expect(attachAgentTurnHaltRequests(bare, [])).toBe(bare);
  });

  it("skips foreign, duplicate and garbled entries without failing the page", () => {
    const bare = [{ turnId: "agt-turn-0001" }, { turnId: "agt-turn-0002" }];

    const attached = attachAgentTurnHaltRequests(bare, [
      { turnId: "agt-turn-9999", ...INTERRUPT },
      { turnId: "agt-turn-0002", ...INTERRUPT, source: "triggerFromANewerBuild" },
    ]);
    const firstWins = attachAgentTurnHaltRequests(bare, [
      { turnId: "agt-turn-0001", ...INTERRUPT },
      { turnId: "agt-turn-0001", ...INTERRUPT, source: "threadMenu" },
    ]);

    expect(attached).toEqual(bare);
    expect(firstWins).toEqual([{ turnId: "agt-turn-0001", haltRequest: INTERRUPT }, bare[1]]);
  });

  it("rejects an envelope that is not a bounded list", () => {
    const bare = [{ turnId: "agt-turn-0001" }];

    expect(() => attachAgentTurnHaltRequests(bare, null)).toThrow(TypeError);
    expect(() => attachAgentTurnHaltRequests(bare, { turnId: "agt-turn-0001" })).toThrow(TypeError);
    expect(() =>
      attachAgentTurnHaltRequests(bare, [
        { turnId: "agt-turn-0001", ...INTERRUPT },
        { turnId: "agt-turn-0001", ...INTERRUPT },
      ]),
    ).toThrow(TypeError);
  });
});
