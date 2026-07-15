import { describe, expect, it } from "vitest";
import { isBenignLanguageServerRequestError } from "./languageServerErrorClassification";

describe("isBenignLanguageServerRequestError", () => {
  it.each([
    "Language server request `textDocument/codeAction` was cancelled.",
    "Language server request was stopped.",
    new Error("Request cancelled"),
    { code: -32800, message: "server-specific cancellation" },
    { code: -32801, message: "server-specific stale response" },
    { code: -32802, message: "server cancelled obsolete work" },
  ])("classifies cancelled or stale requests as benign", (error) => {
    expect(isBenignLanguageServerRequestError(error)).toBe(true);
  });

  it.each([
    "Language server exited unexpectedly.",
    "Language server request `textDocument/codeAction` timed out.",
    "Language server returned a malformed code action response.",
    { code: -32603, message: "Internal error" },
    { code: -32803, message: "Unknown future protocol error" },
  ])("keeps process and request failures actionable", (error) => {
    expect(isBenignLanguageServerRequestError(error)).toBe(false);
  });
});
