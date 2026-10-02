import { describe, expect, it } from "vitest";
import { remoteRunnerErrorMessage } from "./remoteRunnerErrors";

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
