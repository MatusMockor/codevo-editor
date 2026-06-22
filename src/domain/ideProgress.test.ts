import { describe, expect, it } from "vitest";
import {
  ideProgressIndicator,
  type IdeProgressInput,
} from "./ideProgress";
import {
  emptyLanguageServerCapabilities,
  type LanguageServerRuntimeStatus,
} from "./languageServerRuntime";
import {
  initialIndexProgress,
  type IndexProgressState,
} from "./indexProgress";

const WORKSPACE = "/workspace";

function startingPhp(rootPath = WORKSPACE): LanguageServerRuntimeStatus {
  return { kind: "starting", rootPath, sessionId: 1 };
}

function runningPhp(rootPath = WORKSPACE): LanguageServerRuntimeStatus {
  return {
    capabilities: emptyLanguageServerCapabilities(),
    kind: "running",
    rootPath,
    sessionId: 1,
  };
}

function crashedPhp(
  message = "boom",
  rootPath = WORKSPACE,
): LanguageServerRuntimeStatus {
  return { kind: "crashed", message, rootPath };
}

function scanningIndex(indexedFiles = 0): IndexProgressState {
  return {
    ...initialIndexProgress(),
    rootPath: WORKSPACE,
    status: "scanning",
    indexedFiles,
  };
}

function completedIndex(indexedFiles = 100): IndexProgressState {
  return {
    ...initialIndexProgress(),
    rootPath: WORKSPACE,
    status: "completed",
    indexedFiles,
  };
}

function failedIndex(): IndexProgressState {
  return {
    ...initialIndexProgress(),
    rootPath: WORKSPACE,
    status: "failed",
  };
}

function input(overrides: Partial<IdeProgressInput> = {}): IdeProgressInput {
  return {
    workspaceRoot: WORKSPACE,
    phpRuntimeStatus: null,
    javaScriptTypeScriptRuntimeStatus: null,
    indexProgress: initialIndexProgress(),
    ...overrides,
  };
}

describe("ideProgressIndicator", () => {
  it("returns an idle, non-busy indicator without any activity", () => {
    expect(ideProgressIndicator(input())).toEqual({
      state: "idle",
      text: null,
      busy: false,
    });
  });

  it("returns idle without a workspace even if statuses are present", () => {
    const result = ideProgressIndicator(
      input({ workspaceRoot: null, phpRuntimeStatus: startingPhp() }),
    );

    expect(result.state).toBe("idle");
    expect(result.busy).toBe(false);
    expect(result.text).toBeNull();
  });

  it("reports indexing while the workspace index is scanning", () => {
    const result = ideProgressIndicator(
      input({ indexProgress: scanningIndex() }),
    );

    expect(result.state).toBe("scanning");
    expect(result.busy).toBe(true);
    expect(result.text).toBe("Indexing workspace…");
  });

  it("includes the indexed file count once files have been scanned", () => {
    const result = ideProgressIndicator(
      input({ indexProgress: scanningIndex(245) }),
    );

    expect(result.text).toBe("Indexing workspace… 245 files");
  });

  it("reports the PHP engine starting while the language server boots", () => {
    const result = ideProgressIndicator(
      input({ phpRuntimeStatus: startingPhp() }),
    );

    expect(result.state).toBe("scanning");
    expect(result.busy).toBe(true);
    expect(result.text).toBe("Starting PHP engine…");
  });

  it("prefers the indexing label when both indexing and starting happen", () => {
    const result = ideProgressIndicator(
      input({
        phpRuntimeStatus: startingPhp(),
        indexProgress: scanningIndex(12),
      }),
    );

    expect(result.text).toBe("Indexing workspace… 12 files");
    expect(result.state).toBe("scanning");
  });

  it("reports a crashed PHP engine as a problem", () => {
    const result = ideProgressIndicator(
      input({ phpRuntimeStatus: crashedPhp() }),
    );

    expect(result.state).toBe("problem");
    expect(result.busy).toBe(false);
    expect(result.text).toBe("PHP engine crashed");
  });

  it("reports a failed index as a problem", () => {
    const result = ideProgressIndicator(
      input({ indexProgress: failedIndex() }),
    );

    expect(result.state).toBe("problem");
    expect(result.busy).toBe(false);
    expect(result.text).toBe("Indexing failed");
  });

  it("treats index errors as a problem", () => {
    const result = ideProgressIndicator(
      input({
        indexProgress: { ...completedIndex(), erroredEntries: 3 },
      }),
    );

    expect(result.state).toBe("problem");
    expect(result.text).toBe("Indexing finished with errors");
  });

  it("shows no busy indicator once the engine is running and index is done", () => {
    const result = ideProgressIndicator(
      input({
        phpRuntimeStatus: runningPhp(),
        indexProgress: completedIndex(),
      }),
    );

    expect(result.state).toBe("active");
    expect(result.busy).toBe(false);
    expect(result.text).toBeNull();
  });

  it("reports the managed PHP engine installing while the install runs", () => {
    const result = ideProgressIndicator(
      input({ installingManagedPhpactor: true }),
    );

    expect(result.state).toBe("scanning");
    expect(result.busy).toBe(true);
    expect(result.text).toBe("Installing PHP engine…");
  });

  it("prefers the installing label over a starting PHP engine", () => {
    const result = ideProgressIndicator(
      input({
        installingManagedPhpactor: true,
        phpRuntimeStatus: startingPhp(),
      }),
    );

    expect(result.text).toBe("Installing PHP engine…");
    expect(result.busy).toBe(true);
  });

  it("prefers the installing label over a scanning index", () => {
    const result = ideProgressIndicator(
      input({
        installingManagedPhpactor: true,
        indexProgress: scanningIndex(50),
      }),
    );

    expect(result.text).toBe("Installing PHP engine…");
  });

  it("keeps a crashed engine as a problem even while installing", () => {
    const result = ideProgressIndicator(
      input({
        installingManagedPhpactor: true,
        phpRuntimeStatus: crashedPhp(),
      }),
    );

    expect(result.state).toBe("problem");
    expect(result.text).toBe("PHP engine crashed");
  });

  it("ignores activity that belongs to a different workspace root", () => {
    const result = ideProgressIndicator(
      input({
        phpRuntimeStatus: startingPhp("/other"),
        indexProgress: {
          ...scanningIndex(),
          rootPath: "/other",
        },
      }),
    );

    expect(result.state).toBe("idle");
    expect(result.busy).toBe(false);
    expect(result.text).toBeNull();
  });
});
