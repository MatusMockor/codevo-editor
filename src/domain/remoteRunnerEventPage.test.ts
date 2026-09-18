import { describe, expect, it } from "vitest";
import { validateRemoteRunnerValue } from "./remoteRunnerValidation";

describe("remote event page retention metadata", () => {
  const legacy = { items: [], nextCursor: null };
  const page = {
    ...legacy,
    outputTruncatedBeforeSequence: 9,
    outputStartsAtLineBoundary: false,
  };
  it.each([legacy, page, { ...page, outputStartsAtLineBoundary: true }])(
    "accepts legacy pages and atomic retention metadata",
    (value) =>
      expect(() => validateRemoteRunnerValue("listEvents", "response", value)).not.toThrow(),
  );
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, null, "9"])(
    "rejects invalid watermark %s",
    (outputTruncatedBeforeSequence) => {
      expect(() =>
        validateRemoteRunnerValue("listEvents", "response", {
          ...page,
          outputTruncatedBeforeSequence,
        }),
      ).toThrow();
    },
  );
  it.each([null, 0, "true"])("rejects invalid boundary %s", (outputStartsAtLineBoundary) => {
    expect(() =>
      validateRemoteRunnerValue("listEvents", "response", {
        ...page,
        outputStartsAtLineBoundary,
      }),
    ).toThrow();
  });
  it("requires both fields and rejects event metadata on ordinary task pages", () => {
    for (const value of [
      { ...legacy, outputTruncatedBeforeSequence: 9 },
      { ...legacy, outputStartsAtLineBoundary: true },
      { ...page, unexpected: true },
    ])
      expect(() => validateRemoteRunnerValue("listEvents", "response", value)).toThrow();
    expect(() => validateRemoteRunnerValue("listTasks", "response", page)).toThrow();
  });
});

describe("accepted input event", () => {
  const event = {
    sequence: 1,
    taskId: "12345678-1234-4234-8234-123456789abc",
    type: "task.input",
    createdAt: "2026-09-18T00:00:00.000Z",
    messageId: "12345678-1234-4234-8234-123456789abd",
    parts: [{ type: "text", text: "New direction" }],
  };
  it("preserves accepted input for durable conversation reconstruction", () => {
    expect(() =>
      validateRemoteRunnerValue("listEvents", "response", { items: [event], nextCursor: null }),
    ).not.toThrow();
  });
  it.each(["messageId", "parts", "taskId", "createdAt", "unknown"])(
    "rejects malformed %s",
    (field) => {
      expect(() =>
        validateRemoteRunnerValue("listEvents", "response", {
          items: [{ ...event, [field]: "foreign" }],
          nextCursor: null,
        }),
      ).toThrow();
    },
  );
});

it("accepts strict lifecycle snapshots and rejects invalid metadata", () => {
  const subagentLifecycle = {
    entries: [{ id: "tool:t", toolId: "t", name: "Agent", description: "", state: "running" }],
    truncated: false,
  };
  expect(() =>
    validateRemoteRunnerValue("listEvents", "response", {
      items: [],
      nextCursor: null,
      subagentLifecycle,
    }),
  ).not.toThrow();
  for (const invalid of [
    null,
    { ...subagentLifecycle, unknown: true },
    { ...subagentLifecycle, entries: [{ ...subagentLifecycle.entries[0], state: "completed" }] },
  ]) {
    expect(() =>
      validateRemoteRunnerValue("listEvents", "response", {
        items: [],
        nextCursor: null,
        subagentLifecycle: invalid,
      }),
    ).toThrow();
  }
});
