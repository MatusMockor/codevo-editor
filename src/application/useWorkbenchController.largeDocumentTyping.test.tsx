// @vitest-environment jsdom

import {
  act,
  describe,
  expect,
  fileEntry,
  flushAsyncTurns,
  it,
  defaultWorkspaceSettings,
  setupWorkbenchControllerTestHarness,
  vi,
  waitForReact,
  type WorkbenchController,
  type WorkspaceSettings,
} from "./useWorkbenchController.preview/testSupport";

const ROOT = "/workspace";
const LARGE_PATH = `${ROOT}/notes.md`;
const SMALL_PATH = `${ROOT}/small.md`;
const LARGE_BODY = "x".repeat(300 * 1024);
const SMALL_BODY = "small";
const KEYSTROKES = 20;

describe("useWorkbenchController large-document typing", () => {
  const { renderController } = setupWorkbenchControllerTestHarness();

  it("never commits the workbench once per keystroke on a policy-large document", async () => {
    const { getWorkbench, renders } = await openDocument(LARGE_PATH, LARGE_BODY);

    renders.length = 0;
    typeKeystrokes(getWorkbench, LARGE_BODY);

    expect(renders.length).toBeLessThanOrEqual(2);

    await settle();
  });

  it("still commits every keystroke on an eligible small document", async () => {
    const { getWorkbench, renders } = await openDocument(SMALL_PATH, SMALL_BODY);

    renders.length = 0;
    typeKeystrokes(getWorkbench, SMALL_BODY);

    expect(renders.length).toBeGreaterThanOrEqual(KEYSTROKES);

    await settle();
  });

  it("classifies a short 5,001-line file from Monaco metrics without scanning content", async () => {
    const content = `${"x\n".repeat(5_000)}x`;
    const { getWorkbench, renders } = await openDocument(LARGE_PATH, content);
    const contentScan = monitorContentScans(content.length);

    try {
      renders.length = 0;
      typeKeystrokes(getWorkbench, content, 5_001);

      expect(renders.length).toBeLessThanOrEqual(2);
      expect(contentScan.count()).toBe(0);
    } finally {
      contentScan.restore();
    }

    await settle();
  });

  it("uses custom-policy metrics for edits approaching 10 MiB without scanning content", async () => {
    const characterLimit = 10 * 1024 * 1024;
    const content = "x".repeat(characterLimit - KEYSTROKES);
    const workspaceSettings: WorkspaceSettings = {
      ...defaultWorkspaceSettings(),
      largeFileMode: { characterLimit, lineLimit: 5_000 },
    };
    const { getWorkbench, renders } = await openDocument(
      LARGE_PATH,
      content,
      undefined,
      workspaceSettings,
    );
    const contentScan = monitorContentScans(content.length);

    try {
      renders.length = 0;
      typeKeystrokes(getWorkbench, content);

      expect(renders.length).toBeGreaterThanOrEqual(KEYSTROKES);
      expect(contentScan.count()).toBe(0);
    } finally {
      contentScan.restore();
    }

    await settle();
  });

  it("commits immediately without scanning when exact editor metrics are unavailable", async () => {
    const { getWorkbench, renders } = await openDocument(LARGE_PATH, LARGE_BODY);
    const contentScan = monitorContentScans(LARGE_BODY.length);

    try {
      renders.length = 0;
      for (let keystroke = 1; keystroke <= KEYSTROKES; keystroke += 1) {
        act(() => {
          getWorkbench().updateActiveDocument(typedContent(LARGE_BODY, keystroke), LARGE_PATH);
        });
      }

      expect(renders.length).toBeGreaterThanOrEqual(KEYSTROKES);
      expect(contentScan.count()).toBe(0);
    } finally {
      contentScan.restore();
    }
  });

  it("commits the coalesced policy-large content once typing settles", async () => {
    const { getWorkbench } = await openDocument(LARGE_PATH, LARGE_BODY);

    typeKeystrokes(getWorkbench, LARGE_BODY);
    await settle();

    await waitForReact(() => {
      expect(getWorkbench().activeDocument?.content).toBe(typedContent(LARGE_BODY, KEYSTROKES));
    });
  });

  it("saves the current policy-large content before the coalesced commit lands", async () => {
    const writeTextFile = vi.fn(async (_path: string, _content: string) => undefined);
    const { getWorkbench } = await openDocument(LARGE_PATH, LARGE_BODY, { writeTextFile });

    typeKeystrokes(getWorkbench, LARGE_BODY);
    await act(async () => {
      await getWorkbench().saveActiveDocument();
    });

    const calls = writeTextFile.mock.calls as unknown as [string, string][];
    const lastCall = calls[calls.length - 1];
    expect(lastCall?.[0]).toBe(LARGE_PATH);
    expect(lastCall?.[1]).toBe(typedContent(LARGE_BODY, KEYSTROKES));

    await settle();
  });

  it("restores exact A and never saves stale AB before the coalesced commit lands", async () => {
    const writeTextFile = vi.fn(async (_path: string, _content: string) => undefined);
    const contentA = `${LARGE_BODY}a`;
    const { getWorkbench } = await openDocument(LARGE_PATH, contentA, { writeTextFile });

    act(() => {
      getWorkbench().updateActiveDocument(`${contentA}b`, LARGE_PATH, {
        lineCount: 1,
        utf16Length: contentA.length + 1,
      });
      getWorkbench().updateActiveDocument(contentA, LARGE_PATH, {
        lineCount: 1,
        utf16Length: contentA.length,
      });
    });
    await act(async () => {
      await getWorkbench().saveActiveDocument();
    });

    expect(writeTextFile).not.toHaveBeenCalled();

    await settle();
    await waitForReact(() => {
      expect(getWorkbench().activeDocument?.content).toBe(contentA);
    });
  });

  it("rejects a late typing callback after another document becomes active", async () => {
    const { getWorkbench } = await openDocument(LARGE_PATH, LARGE_BODY);
    const staleUpdate = getWorkbench().updateActiveDocument;

    await act(async () => {
      await getWorkbench().openFile(fileEntry(SMALL_PATH, "small.md"), { pin: true });
    });
    await waitForReact(() => {
      expect(getWorkbench().activeDocument?.path).toBe(SMALL_PATH);
    });
    act(() => {
      staleUpdate(`${LARGE_BODY}stale`, LARGE_PATH, {
        lineCount: 1,
        utf16Length: LARGE_BODY.length + "stale".length,
      });
    });

    expect(getWorkbench().activeDocument?.content).toBe(SMALL_BODY);
    await settle();
  });

  function typeKeystrokes(
    getWorkbench: () => WorkbenchController,
    body: string,
    lineCount = 1,
  ): void {
    for (let keystroke = 1; keystroke <= KEYSTROKES; keystroke += 1) {
      const content = typedContent(body, keystroke);
      act(() => {
        getWorkbench().updateActiveDocument(content, getWorkbench().activeDocument?.path, {
          lineCount,
          utf16Length: content.length,
        });
      });
    }
  }

  async function openDocument(
    path: string,
    body: string,
    workspaceFiles?: { writeTextFile: (path: string, content: string) => Promise<void> },
    workspaceSettings?: WorkspaceSettings,
  ) {
    const renders: WorkbenchController[] = [];
    const { getWorkbench } = renderController({
      onWorkbenchRender: (workbench) => {
        renders.push(workbench);
      },
      readDirectory: async (directory: string) =>
        directory === ROOT
          ? [fileEntry(LARGE_PATH, "notes.md"), fileEntry(SMALL_PATH, "small.md")]
          : [],
      readTextFile: async (requestedPath: string) =>
        requestedPath === SMALL_PATH ? SMALL_BODY : body,
      workspaceFiles,
      workspaceSettings,
    });

    await act(async () => {
      await getWorkbench().openWorkspaceRoot(ROOT);
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(path, path.split("/").pop()!), { pin: true });
    });
    await settle();
    await waitForReact(() => {
      expect(getWorkbench().activeDocument?.path).toBe(path);
    });
    await settle();

    return { getWorkbench, renders };
  }
});

function typedContent(body: string, keystrokes: number): string {
  return `${body}${"a".repeat(keystrokes)}`;
}

async function settle(): Promise<void> {
  await flushAsyncTurns(30);
}

function monitorContentScans(minimumLength: number): {
  count(): number;
  restore(): void;
} {
  const original = String.prototype.charCodeAt;
  let count = 0;
  const spy = vi.spyOn(String.prototype, "charCodeAt").mockImplementation(function (
    this: string,
    index: number,
  ) {
    if (this.length >= minimumLength) {
      count += 1;
    }
    return original.call(this, index);
  });
  return {
    count: () => count,
    restore: () => spy.mockRestore(),
  };
}
