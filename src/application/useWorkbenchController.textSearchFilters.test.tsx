// @vitest-environment jsdom

import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { defaultAppSettings } from "../domain/settings";
import { flushTextSearchDebounce, waitForReact } from "../test/reactTestLifecycle";
import {
  flushAsyncTurns,
  setupWorkbenchControllerTestHarness,
} from "../test/workbenchControllerTestHarness";

describe("useWorkbenchController text search filters", () => {
  const { renderController } = setupWorkbenchControllerTestHarness();

  it("forwards the active filters to the text search gateway", async () => {
    const searchText = vi.fn(async () => []);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace"],
      },
      searchText,
    });
    await flushAsyncTurns();
    await waitForReact(() => {
      expect(getWorkbench().workspaceRoot).toBe("/workspace");
    });

    act(() => {
      getWorkbench().setTextSearchOpen(true);
      getWorkbench().setTextSearchOptions({
        caseSensitive: true,
        wholeWord: true,
        isRegex: true,
        preserveCase: false,
        fileMask: "*.php,!vendor",
      });
      getWorkbench().setTextSearchQuery("needle");
    });

    await flushTextSearchDebounce();
    expect(searchText).toHaveBeenCalledWith("/workspace", "needle", 101, {
      caseSensitive: true,
      wholeWord: true,
      isRegex: true,
      preserveCase: false,
      fileMask: "*.php,!vendor",
    });
  });
});
