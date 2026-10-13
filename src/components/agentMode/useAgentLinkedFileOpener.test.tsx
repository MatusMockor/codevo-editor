// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LinkedFileDirectoryReader } from "../../application/agentLinkedFileProbe";
import type {
  AgentOutsideTextFile,
  AgentOutsideTextFilePort,
} from "../../application/agentOutsideLinkedFile";
import type { OpenProblemNoticeOptions } from "../../application/useWorkbenchNavigation";
import type { AgentLocalFileOpenOutcome } from "../../domain/agentMarkdown/agentLocalFileLinkFailure";
import type { WorkbenchNotice } from "../../domain/workbenchNotice";
import { resolveInReactAct } from "../../test/reactTestLifecycle";
import {
  useAgentLinkedFileOpener,
  type AgentLinkedFileOpenerDependencies,
  type AgentLinkedFileOpenerWorkspace,
} from "./useAgentLinkedFileOpener";
import type { AgentFileLocationOpener } from "./useAgentLocalFileLinks";

const ROOT = "/Users/me/Developer/ebox-crm";
const OTHER = "/Users/me/Developer/billing";
const HANDOFF = "/Users/me/handoffs/oktober/02-cms-slideshow.md";
const WORKSPACE: AgentLinkedFileOpenerWorkspace = {
  root: ROOT,
  tabs: [ROOT, OTHER],
  workspaceId: "ws-1",
  admissionToken: 1,
};
const TEXT: AgentOutsideTextFile = { kind: "file", canonicalPath: HANDOFF, content: "# Handoff\n" };

type OpenRequest = Parameters<AgentFileLocationOpener>[0];

interface EditorOpen {
  readonly notice: WorkbenchNotice;
  readonly snapshot: string | null | undefined;
  readonly committed: boolean;
}

describe("useAgentLinkedFileOpener", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
  });

  function harness(file: AgentOutsideTextFile, editorOpens = true) {
    const opens: EditorOpen[] = [];
    const openProblemNotice = vi.fn(
      async (notice: WorkbenchNotice, options?: OpenProblemNoticeOptions) => {
        const snapshot = await options?.readOnlySnapshot?.();
        const committed = editorOpens && snapshot !== null && options?.shouldCommit?.() !== false;
        opens.push({ notice, snapshot, committed });
        return committed;
      },
    );
    const revealEditorSurface = vi.fn();
    const readOutsideTextFile = vi.fn<AgentOutsideTextFilePort["readOutsideTextFile"]>(
      async () => file,
    );
    const readDirectoryBounded = vi.fn<
      NonNullable<LinkedFileDirectoryReader["readDirectoryBounded"]>
    >(async () => ({ entries: [], truncated: false }));
    const dependencies: AgentLinkedFileOpenerDependencies = {
      files: { readDirectoryBounded },
      outsideFiles: { readOutsideTextFile },
      workspace: WORKSPACE,
      openProblemNotice,
      revealEditorSurface,
    };
    const captured: { opener: AgentFileLocationOpener | null } = { opener: null };
    function Probe(props: { readonly workspace: AgentLinkedFileOpenerWorkspace }) {
      captured.opener = useAgentLinkedFileOpener({ ...dependencies, workspace: props.workspace });
      return null;
    }
    const render = (workspace: AgentLinkedFileOpenerWorkspace) =>
      act(() => root.render(<Probe workspace={workspace} />));
    render(WORKSPACE);
    const start = (request: OpenRequest): Promise<AgentLocalFileOpenOutcome> =>
      captured.opener!(request);
    const open = (request: OpenRequest): Promise<AgentLocalFileOpenOutcome> =>
      resolveInReactAct(() => start(request));
    return {
      open,
      start,
      render,
      opens,
      openProblemNotice,
      revealEditorSurface,
      readOutsideTextFile,
      readDirectoryBounded,
    };
  }

  function stalledRead(view: ReturnType<typeof harness>) {
    let finish: (file: AgentOutsideTextFile) => void = () => undefined;
    view.readOutsideTextFile.mockImplementationOnce(
      () => new Promise<AgentOutsideTextFile>((resolve) => (finish = resolve)),
    );
    return (file: AgentOutsideTextFile) => finish(file);
  }

  it("opens an outside file as a read-only snapshot at the linked position and reveals the editor", async () => {
    const view = harness(TEXT);

    const outcome = await view.open({
      location: { path: HANDOFF, line: 12, column: 5 },
      root: null,
    });

    expect(outcome).toBe("opened");
    expect(view.readOutsideTextFile).toHaveBeenCalledExactlyOnceWith(HANDOFF);
    const position = { column: 5, lineNumber: 12 };
    expect(view.opens).toEqual([
      {
        notice: {
          id: `agent-link:${HANDOFF}:12:5`,
          message: HANDOFF,
          navigationTarget: { path: HANDOFF, range: { end: position, start: position } },
          severity: "info",
          source: "Agent",
        },
        snapshot: "# Handoff\n",
        committed: true,
      },
    ]);
    expect(view.revealEditorSurface).toHaveBeenCalledOnce();
    expect(view.readDirectoryBounded).not.toHaveBeenCalled();
  });

  it.each<AgentOutsideTextFile["kind"]>(["doesNotExist", "folder", "tooLarge", "notText"])(
    "reports %s for an outside path without committing or revealing the editor",
    async (kind) => {
      const view = harness({ kind } as AgentOutsideTextFile);

      const outcome = await view.open({
        location: { path: HANDOFF, line: null, column: null },
        root: null,
      });

      expect(outcome).toBe(kind);
      expect(view.opens.map((open) => open.committed)).toEqual([false]);
      expect(view.revealEditorSurface).not.toHaveBeenCalled();
    },
  );

  it("drops an outside open silently when the workspace changed during the read", async () => {
    const view = harness(TEXT);
    const finish = stalledRead(view);

    const pending = view.start({
      location: { path: HANDOFF, line: null, column: null },
      root: null,
    });
    view.render({ ...WORKSPACE, root: OTHER, workspaceId: "ws-2" });
    finish(TEXT);
    const outcome = await resolveInReactAct(() => pending);

    expect(outcome).toBe("superseded");
    expect(view.opens.map((open) => open.committed)).toEqual([false]);
    expect(view.revealEditorSurface).not.toHaveBeenCalled();
  });

  it.each<AgentOutsideTextFile["kind"]>(["doesNotExist", "unreadable"])(
    "supersedes a %s refusal that arrives after the workspace changed",
    async (kind) => {
      const view = harness(TEXT);
      const finish = stalledRead(view);

      const pending = view.start({
        location: { path: HANDOFF, line: null, column: null },
        root: null,
      });
      view.render({ ...WORKSPACE, root: OTHER, workspaceId: "ws-2" });
      finish({ kind } as AgentOutsideTextFile);

      await expect(resolveInReactAct(() => pending)).resolves.toBe("superseded");
      expect(view.revealEditorSurface).not.toHaveBeenCalled();
    },
  );

  it("treats A to B to A during the read as a different generation of the workspace", async () => {
    const view = harness(TEXT);
    const finish = stalledRead(view);

    const pending = view.start({
      location: { path: HANDOFF, line: null, column: null },
      root: null,
    });
    view.render({ ...WORKSPACE, root: OTHER, workspaceId: "ws-2" });
    view.render(WORKSPACE);
    finish(TEXT);
    const outcome = await resolveInReactAct(() => pending);

    expect(outcome).toBe("superseded");
    expect(view.revealEditorSurface).not.toHaveBeenCalled();
  });

  it("treats a readmission of the same root as a different owner", async () => {
    const view = harness(TEXT);
    const finish = stalledRead(view);

    const pending = view.start({
      location: { path: HANDOFF, line: null, column: null },
      root: null,
    });
    view.render({ ...WORKSPACE, admissionToken: 2 });
    finish(TEXT);

    await expect(resolveInReactAct(() => pending)).resolves.toBe("superseded");
  });

  it("drops an outside open that settles after the screen unmounted", async () => {
    const view = harness(TEXT);
    const finish = stalledRead(view);

    const pending = view.start({
      location: { path: HANDOFF, line: null, column: null },
      root: null,
    });
    act(() => root.render(null));
    finish(TEXT);

    await expect(resolveInReactAct(() => pending)).resolves.toBe("superseded");
    expect(view.revealEditorSurface).not.toHaveBeenCalled();
  });

  it("keeps an unrelated rerender from invalidating a pending outside open", async () => {
    const view = harness(TEXT);
    const finish = stalledRead(view);

    const pending = view.start({
      location: { path: HANDOFF, line: null, column: null },
      root: null,
    });
    view.render({ ...WORKSPACE, tabs: [ROOT] });
    finish(TEXT);

    await expect(resolveInReactAct(() => pending)).resolves.toBe("opened");
  });

  it("opens a workspace file outside the thread root through the normal editable open", async () => {
    const view = harness(TEXT);
    const path = `${ROOT}/packages/web/App.tsx`;

    const outcome = await view.open({ location: { path, line: 3, column: null }, root: null });

    expect(outcome).toBe("opened");
    expect(view.opens.map((open) => open.snapshot)).toEqual([undefined]);
    expect(view.readOutsideTextFile).not.toHaveBeenCalled();
  });

  it("opens a file inside the thread root exactly as before, without options or a backend read", async () => {
    const view = harness({ kind: "doesNotExist" });
    const path = `${ROOT}/src/app.ts`;

    const outcome = await view.open({ location: { path, line: 3, column: null }, root: ROOT });

    expect(outcome).toBe("opened");
    const position = { column: 1, lineNumber: 3 };
    expect(view.openProblemNotice).toHaveBeenCalledExactlyOnceWith({
      id: `agent-link:${path}:3:1`,
      message: path,
      navigationTarget: { path, range: { end: position, start: position } },
      severity: "info",
      source: "Agent",
    });
    expect(view.readOutsideTextFile).not.toHaveBeenCalled();
    expect(view.revealEditorSurface).toHaveBeenCalledOnce();
  });

  it("still classifies a missing file inside the thread root from its folder listing", async () => {
    const view = harness(TEXT, false);
    const path = `${ROOT}/src/gone.ts`;

    const outcome = await view.open({ location: { path, line: null, column: null }, root: ROOT });

    expect(outcome).toBe("notFound");
    expect(view.readDirectoryBounded).toHaveBeenCalledWith(`${ROOT}/src`, expect.any(Number));
    expect(view.readOutsideTextFile).not.toHaveBeenCalled();
    expect(view.revealEditorSurface).not.toHaveBeenCalled();
  });
});
