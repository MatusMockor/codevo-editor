// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

const appBootMocks = vi.hoisted(() => ({
  createAppHighlighter: vi.fn<() => Promise<unknown>>(),
}));

vi.mock("./infrastructure/shikiHighlighter", () => ({
  createAppHighlighter: appBootMocks.createAppHighlighter,
}));

import { ideActivityState, preloadSyntaxHighlighter } from "./App";
import {
  emptyLanguageServerCapabilities,
  type LanguageServerRuntimeStatus,
} from "./domain/languageServerRuntime";
import { initialIndexProgress } from "./domain/indexProgress";

describe("preloadSyntaxHighlighter", () => {
  afterEach(() => {
    appBootMocks.createAppHighlighter.mockReset();
  });

  it("warms the Shiki highlighter so the first opened file has colors immediately", () => {
    appBootMocks.createAppHighlighter.mockResolvedValue({});

    preloadSyntaxHighlighter();

    expect(appBootMocks.createAppHighlighter).toHaveBeenCalledTimes(1);
  });

  it("does not throw when the preload rejects so a failure cannot crash boot", async () => {
    const rejection = Promise.reject(new Error("highlighter unavailable"));
    appBootMocks.createAppHighlighter.mockReturnValue(rejection);

    expect(() => preloadSyntaxHighlighter()).not.toThrow();

    // Let the swallowed rejection settle without surfacing an unhandled rejection.
    await rejection.catch(() => {});
  });
});

describe("ideActivityState", () => {
  it("ignores runtime statuses that do not belong to the active workspace", () => {
    const rootlessRunningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 1,
    };
    const rootedRunningStatus: LanguageServerRuntimeStatus = {
      ...rootlessRunningStatus,
      rootPath: "/workspace",
      sessionId: 2,
    };
    const otherWorkspaceStartingStatus: LanguageServerRuntimeStatus = {
      kind: "starting",
      rootPath: "/other",
      sessionId: 3,
    };

    expect(
      ideActivityState(
        "/workspace",
        rootlessRunningStatus,
        otherWorkspaceStartingStatus,
        initialIndexProgress(),
      ),
    ).toBe("idle");
    expect(
      ideActivityState(
        "/workspace",
        rootedRunningStatus,
        otherWorkspaceStartingStatus,
        initialIndexProgress(),
      ),
    ).toBe("active");
  });
});
