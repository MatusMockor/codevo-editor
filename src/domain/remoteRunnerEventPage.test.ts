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
