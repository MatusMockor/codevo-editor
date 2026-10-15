// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LinkedFileDirectoryReader } from "../../application/agentLinkedFileProbe";
import type {
  AgentOutsideTextFile,
  AgentOutsideTextFilePort,
} from "../../application/agentOutsideLinkedFile";
import type { AgentLocalFileOpenOutcome } from "../../domain/agentMarkdown/agentLocalFileLinkFailure";
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

  function harness(options: { readonly accepted?: boolean; readonly external?: boolean } = {}) {
    const reveals: Array<{ path: string; line: number | null }> = [];
    const externals: Array<{ path: string; contents: string; line: number | null }> = [];
    const revealFileInViewer = vi.fn(async (path: string, line: number | null) => {
      reveals.push({ path, line });
      return options.accepted ?? true;
    });
    const showExternalFileInViewer = vi.fn(
      async (path: string, contents: string, line: number | null) => {
        externals.push({ path, contents, line });
        return true;
      },
    );
    const readOutsideTextFile = vi.fn<AgentOutsideTextFilePort["readOutsideTextFile"]>(
      async () => TEXT,
    );
    const readDirectoryBounded = vi.fn<
      NonNullable<LinkedFileDirectoryReader["readDirectoryBounded"]>
    >(async () => ({ entries: [], truncated: false }));
    const dependencies: AgentLinkedFileOpenerDependencies = {
      files: { readDirectoryBounded },
      outsideFiles: { readOutsideTextFile },
      workspace: WORKSPACE,
      revealFileInViewer,
      ...(options.external === false ? {} : { showExternalFileInViewer }),
    };
    const captured: { opener: AgentFileLocationOpener | null } = { opener: null };
    function Probe(props: { readonly workspace: AgentLinkedFileOpenerWorkspace }) {
      captured.opener = useAgentLinkedFileOpener({ ...dependencies, workspace: props.workspace });
      return null;
    }
    const render = (workspace: AgentLinkedFileOpenerWorkspace) =>
      act(() => root.render(<Probe workspace={workspace} />));
    render(WORKSPACE);
    const open = (request: OpenRequest): Promise<AgentLocalFileOpenOutcome> =>
      resolveInReactAct(() => captured.opener!(request));
    return { open, render, reveals, externals, readOutsideTextFile, readDirectoryBounded };
  }

  it("reveals a file inside the thread root in the Files viewer at the linked line", async () => {
    const view = harness();
    const path = `${ROOT}/src/app.ts`;

    const outcome = await view.open({ location: { path, line: 3, column: 7 }, root: ROOT });

    expect(outcome).toBe("opened");
    expect(view.reveals).toEqual([{ path, line: 3 }]);
    expect(view.readOutsideTextFile).not.toHaveBeenCalled();
    expect(view.readDirectoryBounded).not.toHaveBeenCalled();
  });

  it("reveals a workspace file outside the thread root in the Files viewer", async () => {
    const view = harness();
    const path = `${ROOT}/packages/web/App.tsx`;

    const outcome = await view.open({ location: { path, line: null, column: null }, root: null });

    expect(outcome).toBe("opened");
    expect(view.reveals).toEqual([{ path, line: null }]);
    expect(view.readOutsideTextFile).not.toHaveBeenCalled();
  });

  it("refuses a file owned by another open project without revealing anything", async () => {
    const view = harness();

    const outcome = await view.open({
      location: { path: `${OTHER}/src/billing.ts`, line: null, column: null },
      root: null,
    });

    expect(outcome).toBe("otherProject");
    expect(view.reveals).toEqual([]);
  });

  it("reports a file the viewer did not accept as missing instead of opened", async () => {
    const view = harness({ accepted: false });
    const path = `${ROOT}/src/gone.ts`;

    const outcome = await view.open({ location: { path, line: null, column: null }, root: ROOT });

    expect(view.reveals).toEqual([{ path, line: null }]);
    expect(outcome).toBe("notFound");
    expect(view.readDirectoryBounded).toHaveBeenCalled();
  });

  it("shows a file outside every project as a read-only snapshot in the viewer", async () => {
    const view = harness();

    const outcome = await view.open({
      location: { path: HANDOFF, line: 12, column: 5 },
      root: null,
    });

    expect(outcome).toBe("opened");
    expect(view.readOutsideTextFile).toHaveBeenCalledWith(HANDOFF);
    expect(view.externals).toEqual([{ path: HANDOFF, contents: "# Handoff\n", line: 12 }]);
    expect(view.reveals).toEqual([]);
  });

  it("does not open a file outside every project without an external viewer", async () => {
    const view = harness({ external: false });

    const outcome = await view.open({
      location: { path: HANDOFF, line: 12, column: 5 },
      root: null,
    });

    expect(outcome).toBe("failed");
    expect(view.reveals).toEqual([]);
    expect(view.readOutsideTextFile).not.toHaveBeenCalled();
  });
});
