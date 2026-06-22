// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { ideActivityState } from "./App";
import {
  emptyLanguageServerCapabilities,
  type LanguageServerRuntimeStatus,
} from "./domain/languageServerRuntime";
import { initialIndexProgress } from "./domain/indexProgress";

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
