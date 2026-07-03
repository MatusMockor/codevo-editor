// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

const appBootMocks = vi.hoisted(() => ({
  createAppHighlighter: vi.fn<() => Promise<unknown>>(),
}));

vi.mock("./infrastructure/shikiHighlighter", () => ({
  createAppHighlighter: appBootMocks.createAppHighlighter,
}));

import {
  ideActivityDetail,
  ideActivityState,
  ideActivityStatus,
  phpLanguageServerActivityLabel,
  preloadSyntaxHighlighter,
} from "./App";
import {
  emptyLanguageServerCapabilities,
  languageServerStatusLabel,
  type LanguageServerRuntimeCapabilities,
  type LanguageServerRuntimeStatus,
} from "./domain/languageServerRuntime";
import {
  applyIndexProgress,
  initialIndexProgress,
  startIndexProgress,
} from "./domain/indexProgress";

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

describe("ideActivityDetail", () => {
  it("summarizes PHPactor, TS server, and index state on separate lines", () => {
    const runningPhp: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId: 1,
    };
    const startingTs: LanguageServerRuntimeStatus = {
      kind: "starting",
      rootPath: "/workspace",
      sessionId: 2,
    };
    const progress = applyIndexProgress(
      startIndexProgress({
        databasePath: "/config/index.sqlite3",
        rootPath: "/workspace",
        status: "started",
      }),
      {
        phase: "parsing",
        processedFiles: 500,
        rootPath: "/workspace",
        totalFiles: 1000,
      },
    );

    const detail = ideActivityDetail(
      "/workspace",
      runningPhp,
      startingTs,
      progress,
    );

    expect(detail).toBe(
      [
        "PHPactor: running",
        "TS Server: starting",
        "Index: 500 of 1000 (50%)",
      ].join("\n"),
    );
  });

  it("reports a stopped runtime and idle index when nothing is active", () => {
    const detail = ideActivityDetail("/workspace", null, null, initialIndexProgress());

    expect(detail).toBe(
      ["PHPactor: stopped", "TS Server: stopped", "Index: idle"].join("\n"),
    );
  });

  it("reports a crashed runtime distinctly from stopped", () => {
    const crashedPhp: LanguageServerRuntimeStatus = {
      kind: "crashed",
      message: "phpactor exited with code 1",
      rootPath: "/workspace",
    };

    const detail = ideActivityDetail(
      "/workspace",
      crashedPhp,
      null,
      initialIndexProgress(),
    );

    expect(detail).toBe(
      ["PHPactor: crashed", "TS Server: stopped", "Index: idle"].join("\n"),
    );
  });

  it("ignores runtime statuses that belong to a different workspace", () => {
    const otherWorkspacePhp: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/other",
      sessionId: 1,
    };

    const detail = ideActivityDetail(
      "/workspace",
      otherWorkspacePhp,
      null,
      initialIndexProgress(),
    );

    expect(detail).toBe(
      ["PHPactor: stopped", "TS Server: stopped", "Index: idle"].join("\n"),
    );
  });
});

describe("phpLanguageServerActivityLabel", () => {
  it("is a compact runtime label, never the enabled-capability list", () => {
    const runningWithEveryCapability: LanguageServerRuntimeStatus = {
      capabilities: fullLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId: 1,
    };

    const label = phpLanguageServerActivityLabel(
      "fullSmart",
      runningWithEveryCapability,
      "/workspace",
      null,
    );

    expect(label).toBe("PHPactor: running");
    expect(label).not.toContain("smart selection");
    expect(label).not.toContain("document highlights");
    expect(label).not.toContain(",");
  });

  it("returns null when the workspace is not running in fullSmart mode", () => {
    expect(
      phpLanguageServerActivityLabel("basic", null, "/workspace", null),
    ).toBeNull();
    expect(
      phpLanguageServerActivityLabel("lightSmart", null, "/workspace", null),
    ).toBeNull();
  });
});

describe("ideActivityStatus composed with the PHPactor and TS Server labels", () => {
  it("keeps the chip label compact - runtime state and index count, no capability noise", () => {
    const runningPhp: LanguageServerRuntimeStatus = {
      capabilities: fullLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId: 1,
    };
    const runningTs: LanguageServerRuntimeStatus = {
      capabilities: fullLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId: 2,
    };
    const progress = {
      ...initialIndexProgress(),
      indexedFiles: 608,
      rootPath: "/workspace",
      status: "completed" as const,
    };

    const phpLabel = phpLanguageServerActivityLabel(
      "fullSmart",
      runningPhp,
      "/workspace",
      null,
    );
    const tsLabel = languageServerStatusLabel(runningTs, "TS Server", {
      workspaceRoot: "/workspace",
    });
    const combinedLabel = [phpLabel, tsLabel].filter(Boolean).join(" · ");

    const activity = ideActivityStatus(
      "/workspace",
      runningPhp,
      runningTs,
      progress,
      combinedLabel,
      "generic",
    );

    expect(activity.label).toBe(
      "IDE: PHPactor running · TS Server running for this project · Index 608 files",
    );
    expect(activity.label).not.toContain("smart selection");
    expect(activity.label).not.toContain("document highlights");
    expect(activity.label).not.toContain("hover, completion");
    expect(activity.state).toBe("active");
  });
});

describe("ideActivityStatus index progress", () => {
  it("shows an incremental 'X of N (P%)' label while indexing with a known total", () => {
    const progress = applyIndexProgress(
      startIndexProgress({
        databasePath: "/config/index.sqlite3",
        rootPath: "/workspace",
        status: "started",
      }),
      {
        phase: "parsing",
        processedFiles: 500,
        rootPath: "/workspace",
        totalFiles: 1000,
      },
    );

    const activity = ideActivityStatus(
      "/workspace",
      null,
      null,
      progress,
      null,
      "generic",
    );

    expect(activity.state).toBe("scanning");
    expect(activity.label).toBe("IDE: Indexing 500 of 1000 (50%)");
  });

  it("falls back to an indeterminate count when the total is unknown", () => {
    const progress = applyIndexProgress(
      startIndexProgress({
        databasePath: "/config/index.sqlite3",
        rootPath: "/workspace",
        status: "started",
      }),
      {
        phase: "parsing",
        processedFiles: 320,
        rootPath: "/workspace",
        totalFiles: null,
      },
    );

    const activity = ideActivityStatus(
      "/workspace",
      null,
      null,
      progress,
      null,
      "generic",
    );

    expect(activity.label).toBe("IDE: Indexing 320 files");
  });
});

describe("ideActivityStatus framework profile segment", () => {
  const runningPhp: LanguageServerRuntimeStatus = {
    capabilities: fullLanguageServerCapabilities(),
    kind: "running",
    rootPath: "/workspace",
    sessionId: 1,
  };
  const completedIndex = {
    ...initialIndexProgress(),
    indexedFiles: 610,
    rootPath: "/workspace",
    status: "completed" as const,
  };

  function phpChipLabel(): string | null {
    return phpLanguageServerActivityLabel(
      "fullSmart",
      runningPhp,
      "/workspace",
      null,
    );
  }

  it("adds a compact Laravel/Nette segment after the runtime label", () => {
    expect(
      ideActivityStatus(
        "/workspace",
        runningPhp,
        null,
        completedIndex,
        phpChipLabel(),
        "laravel",
      ).label,
    ).toBe("IDE: PHPactor running · Laravel · Index 610 files");
    expect(
      ideActivityStatus(
        "/workspace",
        runningPhp,
        null,
        completedIndex,
        phpChipLabel(),
        "nette",
      ).label,
    ).toBe("IDE: PHPactor running · Nette · Index 610 files");
  });

  it("omits the profile segment for generic projects", () => {
    const label = ideActivityStatus(
      "/workspace",
      runningPhp,
      null,
      completedIndex,
      phpChipLabel(),
      "generic",
    ).label;

    expect(label).toBe("IDE: PHPactor running · Index 610 files");
    expect(label).not.toContain("Laravel");
    expect(label).not.toContain("Nette");
  });

  it("does not show a lonely profile segment without an active runtime label", () => {
    const idleIndex = {
      ...initialIndexProgress(),
      rootPath: "/workspace",
      status: "idle" as const,
    };

    expect(
      ideActivityStatus("/workspace", null, null, idleIndex, null, "nette")
        .label,
    ).toBeNull();
  });
});

// Every capability flag enabled, mirroring a fully-initialized runtime -
// the worst case for the status-bar chip, since this is the input that used
// to explode into the full "hover, completion, definition, ..." capability
// list once concatenated onto the runtime label.
function fullLanguageServerCapabilities(): LanguageServerRuntimeCapabilities {
  return {
    callHierarchy: true,
    codeAction: true,
    codeActionResolve: true,
    codeLens: true,
    completion: true,
    declaration: true,
    definition: true,
    documentHighlight: true,
    documentLink: true,
    documentSymbol: true,
    didCreateFiles: true,
    didDeleteFiles: true,
    didRenameFiles: true,
    foldingRange: true,
    formatting: true,
    hover: true,
    implementation: true,
    inlayHint: true,
    linkedEditingRange: true,
    onTypeFormatting: true,
    prepareRename: true,
    rangeFormatting: true,
    references: true,
    rename: true,
    selectionRange: true,
    semanticTokens: true,
    signatureHelp: true,
    sourceDefinition: true,
    typeDefinition: true,
    typeHierarchy: true,
    willCreateFiles: true,
    willDeleteFiles: true,
    willRenameFiles: true,
    workspaceSymbol: true,
  };
}
