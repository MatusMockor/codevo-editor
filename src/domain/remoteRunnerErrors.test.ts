import { describe, expect, it } from "vitest";
import { isTransientRunnerBusyError, remoteRunnerErrorMessage } from "./remoteRunnerErrors";

const FALLBACK = "The server operation failed.";

describe("remoteRunnerErrorMessage", () => {
  it("keeps the text of a plain string rejection from the Tauri bridge", () => {
    expect(remoteRunnerErrorMessage("Runner request failed (HTTP 503).", FALLBACK)).toBe(
      "Runner request failed (HTTP 503).",
    );
  });

  it("keeps the message of an Error", () => {
    expect(remoteRunnerErrorMessage(new Error("Runner is busy; retry shortly"), FALLBACK)).toBe(
      "Runner is busy; retry shortly",
    );
  });

  it("falls back for empty, oversized, or non-textual rejections", () => {
    expect(remoteRunnerErrorMessage("", FALLBACK)).toBe(FALLBACK);
    expect(remoteRunnerErrorMessage("x".repeat(1001), FALLBACK)).toBe(FALLBACK);
    expect(remoteRunnerErrorMessage({ code: 503 }, FALLBACK)).toBe(FALLBACK);
    expect(remoteRunnerErrorMessage(undefined, FALLBACK)).toBe(FALLBACK);
  });
});

describe("isTransientRunnerBusyError", () => {
  it.each([
    "Runner is busy; retry shortly",
    "Runner request failed (HTTP 503).",
    "  Runner is busy; retry shortly ",
    new Error("Runner is busy; retry shortly"),
    new Error("Runner request failed (HTTP 503)."),
  ])("recognises %j", (error) => {
    expect(isTransientRunnerBusyError(error)).toBe(true);
  });

  it.each([
    "Runner request failed (HTTP 500).",
    "Runner request failed (HTTP 5030).",
    "Runner is busy; retry shortly /private/secret",
    `Runner is busy; retry shortly${" ".repeat(2_000)}x`,
    "",
    null,
    undefined,
    { message: "Runner is busy; retry shortly" },
  ])("does not recognise %j", (error) => {
    expect(isTransientRunnerBusyError(error)).toBe(false);
  });
});
