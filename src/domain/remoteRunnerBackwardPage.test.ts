import { describe, expect, it } from "vitest";
import type { RemoteRunnerEvent, RemoteRunnerEventPage } from "./remoteRunner";
import {
  MAX_REMOTE_RUNNER_EVENT_PAGE_ITEMS,
  assertRemoteRunnerBackwardPage,
  remoteRunnerBackwardPageRejection,
} from "./remoteRunnerBackwardPage";
import { validateRemoteRunnerValue } from "./remoteRunnerValidation";

const TASK = "12345678-1234-4234-8234-123456789abc";
const OTHER = "87654321-4321-4234-8234-cba987654321";

function event(sequence: number, taskId = TASK): RemoteRunnerEvent {
  return {
    sequence,
    taskId,
    type: "task.output",
    createdAt: "2026-09-13T00:00:00.000Z",
    channel: "stdout",
    text: `chunk ${sequence}`,
  };
}

function page(sequences: ReadonlyArray<number>, nextCursor: number | null): RemoteRunnerEventPage {
  return { items: sequences.map((sequence) => event(sequence)), nextCursor };
}

const request = { taskId: TASK, before: 40 };

describe("remote runner backward event page", () => {
  it("accepts an ascending page below the cursor with a consistent next cursor", () => {
    expect(remoteRunnerBackwardPageRejection(page([7, 12, 39], 7), request)).toBeNull();
    expect(remoteRunnerBackwardPageRejection(page([7, 12, 39], null), request)).toBeNull();
    expect(remoteRunnerBackwardPageRejection(page([], null), request)).toBeNull();
    expect(() => assertRemoteRunnerBackwardPage(page([7, 12, 39], 7), request)).not.toThrow();
  });

  it.each([
    ["unordered", page([12, 7, 39], null)],
    ["unordered", page([7, 7, 39], null)],
    ["notBefore", page([7, 12, 40], null)],
    ["notBefore", page([7, 12, 41], 7)],
    ["inconsistentCursor", page([7, 12, 39], 12)],
    ["inconsistentCursor", page([7, 12, 39], 39)],
    ["inconsistentCursor", page([], 3)],
    ["foreignTask", { items: [event(7), event(12, OTHER)], nextCursor: null }],
    [
      "oversized",
      page(
        Array.from({ length: MAX_REMOTE_RUNNER_EVENT_PAGE_ITEMS + 1 }, (_, index) => index + 1),
        null,
      ),
    ],
  ] satisfies ReadonlyArray<[string, RemoteRunnerEventPage]>)(
    "rejects a page that is %s",
    (reason, value) => {
      expect(remoteRunnerBackwardPageRejection(value, { taskId: TASK, before: 60 })).toBe(
        reason === "notBefore" ? null : reason,
      );
      expect(remoteRunnerBackwardPageRejection(value, request)).toBe(reason);
      expect(() => assertRemoteRunnerBackwardPage(value, request)).toThrow(
        `Invalid remote runner backward event page: ${reason}.`,
      );
    },
  );
});

describe("remote runner backward paging wire validation", () => {
  const descriptor = {
    protocolVersion: 1,
    runnerId: "test",
    name: "Test",
    capabilities: { taskExecution: true, eventReplay: true },
  };

  it("accepts a bounded before cursor and nothing else in the request", () => {
    const valid = { serverId: "linux", taskId: TASK, before: 1 };
    expect(() => validateRemoteRunnerValue("listEventsBefore", "request", valid)).not.toThrow();
    expect(() =>
      validateRemoteRunnerValue("listEventsBefore", "request", {
        ...valid,
        before: Number.MAX_SAFE_INTEGER,
      }),
    ).not.toThrow();
    for (const before of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "7", null, undefined])
      expect(() =>
        validateRemoteRunnerValue("listEventsBefore", "request", { ...valid, before }),
      ).toThrow("Invalid remote runner listEventsBefore request.");
    for (const extra of [{ after: 0 }, { limit: 10 }])
      expect(() =>
        validateRemoteRunnerValue("listEventsBefore", "request", { ...valid, ...extra }),
      ).toThrow("Invalid remote runner listEventsBefore request.");
    expect(() =>
      validateRemoteRunnerValue("listEventsBefore", "request", { ...valid, taskId: "task" }),
    ).toThrow();
    expect(() =>
      validateRemoteRunnerValue("listEvents", "request", { ...valid, after: 0 }),
    ).toThrow();
  });

  it("validates the response with the strict event page envelope", () => {
    expect(() =>
      validateRemoteRunnerValue("listEventsBefore", "response", page([3, 9], 3)),
    ).not.toThrow();
    expect(() =>
      validateRemoteRunnerValue("listEventsBefore", "response", {
        ...page([3, 9], null),
        outputTruncatedBeforeSequence: 2,
        outputStartsAtLineBoundary: false,
      }),
    ).not.toThrow();
    for (const invalid of [
      { ...page([3], null), direction: "before" },
      { ...page([3], null), outputTruncatedBeforeSequence: 2 },
      { items: [{ ...event(3), sequence: 0 }], nextCursor: null },
      { items: [{ ...event(3), unknown: true }], nextCursor: null },
      page(
        Array.from({ length: 51 }, (_, index) => index + 1),
        null,
      ),
    ])
      expect(() => validateRemoteRunnerValue("listEventsBefore", "response", invalid)).toThrow(
        "Invalid remote runner listEventsBefore response.",
      );
  });

  it("accepts the optional backward paging capability as a strict boolean", () => {
    expect(() => validateRemoteRunnerValue("getRunner", "response", descriptor)).not.toThrow();
    for (const eventBackwardPaging of [true, false])
      expect(() =>
        validateRemoteRunnerValue("getRunner", "response", {
          ...descriptor,
          capabilities: { ...descriptor.capabilities, eventBackwardPaging },
        }),
      ).not.toThrow();
    for (const eventBackwardPaging of [null, "true", 1, {}, []])
      expect(() =>
        validateRemoteRunnerValue("getRunner", "response", {
          ...descriptor,
          capabilities: { ...descriptor.capabilities, eventBackwardPaging },
        }),
      ).toThrow("Invalid remote runner getRunner response.");
  });
});
