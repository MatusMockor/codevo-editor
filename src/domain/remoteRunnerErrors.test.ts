import { describe, expect, it } from "vitest";
import {
  REMOTE_RUNNER_OPERATIONS_BUSY_MESSAGE,
  isTransientRunnerBusyError,
  remoteRunnerErrorMessage,
} from "./remoteRunnerErrors";

const FALLBACK = "The server operation failed.";

describe("remoteRunnerErrorMessage", () => {
  it("keeps the text of a plain string rejection from the Tauri bridge", () => {
    expect(remoteRunnerErrorMessage("Runner request failed (HTTP 503).", FALLBACK)).toBe(
      "Runner request failed (HTTP 503).",
    );
  });

  it("keeps the message of an Error", () => {
    expect(
      remoteRunnerErrorMessage(
        new Error("Too many server requests are still in progress; retry shortly"),
        FALLBACK,
      ),
    ).toBe("Too many server requests are still in progress; retry shortly");
  });

  it("falls back for empty, oversized, or non-textual rejections", () => {
    expect(remoteRunnerErrorMessage("", FALLBACK)).toBe(FALLBACK);
    expect(remoteRunnerErrorMessage("x".repeat(1001), FALLBACK)).toBe(FALLBACK);
    expect(remoteRunnerErrorMessage({ code: 503 }, FALLBACK)).toBe(FALLBACK);
    expect(remoteRunnerErrorMessage(undefined, FALLBACK)).toBe(FALLBACK);
  });
});

describe("REMOTE_RUNNER_OPERATIONS_BUSY_MESSAGE", () => {
  it("is the exact refusal of the editor's own request queue and does not blame the runner", () => {
    expect(REMOTE_RUNNER_OPERATIONS_BUSY_MESSAGE).toBe(
      "Too many server requests are still in progress; retry shortly",
    );
    expect(REMOTE_RUNNER_OPERATIONS_BUSY_MESSAGE).not.toMatch(/runner|busy/i);
  });
});

describe("isTransientRunnerBusyError", () => {
  it.each([
    "Too many server requests are still in progress; retry shortly",
    "Runner request failed (HTTP 503).",
    "  Too many server requests are still in progress; retry shortly ",
    new Error("Too many server requests are still in progress; retry shortly"),
    new Error("Runner request failed (HTTP 503)."),
  ])("recognises %j", (error) => {
    expect(isTransientRunnerBusyError(error)).toBe(true);
  });

  it.each([
    "Runner request failed (HTTP 500).",
    "Runner request failed (HTTP 5030).",
    "Too many server requests are still in progress; retry shortly /private/secret",
    `Too many server requests are still in progress; retry shortly${" ".repeat(2_000)}x`,
    "",
    null,
    undefined,
    { message: "Too many server requests are still in progress; retry shortly" },
  ])("does not recognise %j", (error) => {
    expect(isTransientRunnerBusyError(error)).toBe(false);
  });
});
