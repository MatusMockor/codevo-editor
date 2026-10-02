// @vitest-environment jsdom
import { act, useReducer } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { remoteAgentThreadKey } from "../../application/remoteAgentProjection";
import { workbenchAgentPaletteProvider } from "../../application/commandPalette/commandPaletteProvider";
import {
  agentWorkbenchLayoutReducer,
  initialAgentWorkbenchLayout,
} from "../../domain/agentWorkbenchLayout";
import type { RemoteRunnerGateway, RemoteRunnerTask } from "../../domain/remoteRunner";
import {
  RemoteSurfaceNotFoundError,
  type RemoteRunnerSurfacesGateway,
} from "../../domain/remoteRunnerSurfaces";
import { loadAgentMarkdownRenderer } from "../../infrastructure/markdown/agentMarkdownRendererAdapter";
import { unconfiguredAgentProviderManagement } from "../../test/agentProviderManagementFixture";
import { waitForReact } from "../../test/reactTestLifecycle";
import { RemoteRunnerProvider } from "../remoteRunner/RemoteRunnerProvider";
import { AgentModeView } from "./AgentModeView";
import { SURFACE_FIXTURE_ROOT } from "./agentSurfaceTestFixtures";
import { projectFixture, threadsSurfaceFixture } from "./agentThreadsSurfaceTestFixtures";
import { chromeFixture } from "./agentWorkbenchChromeTestFixtures";

const monaco = vi.hoisted(() => ({
  positions: [] as Array<{ readonly path: string; readonly lineNumber: number }>,
}));

vi.mock("../monacoRuntimeLoader", () => ({ initializeMonacoRuntime: async () => undefined }));

vi.mock("@monaco-editor/react", async () => {
  const { useEffect, useRef } = await import("react");
  function Editor({
    path,
    value,
    onMount,
  }: {
    readonly path: string;
    readonly value: string;
    readonly onMount?: (editor: unknown) => void;
  }) {
    const latest = useRef({ path, value, onMount });
    latest.current = { path, value, onMount };
    useEffect(() => {
      const lines = () => latest.current.value.split("\n");
      latest.current.onMount?.({
        getModel: () => ({
          getLineCount: () => lines().length,
          getLineMaxColumn: (line: number) => (lines()[line - 1] ?? "").length + 1,
        }),
        setPosition: ({ lineNumber }: { readonly lineNumber: number }) =>
          monaco.positions.push({ path: latest.current.path, lineNumber }),
        revealPositionInCenter: () => undefined,
      });
    }, []);
    return <textarea aria-label="Server file text" readOnly value={value} />;
  }
  return { default: Editor, DiffEditor: () => null };
});

const remoteThreadId = remoteAgentThreadKey("linux", "runner", "first");
const ANSWER =
  "Handler lives in `src/app.ts:2`; compare [config](/srv/app/config.ts) and `src/gone.ts`. " +
  "The agent also wrote [the absolute handler](/var/lib/codevo/workspaces/first/src/app.ts:2).";

function task(): RemoteRunnerTask {
  return {
    id: "first",
    runnerId: "runner",
    sequence: 1,
    provider: "claude",
    projectId: "project",
    status: "succeeded",
    parts: [{ type: "text", text: "Where is the handler?" }],
    createdAt: "2026-09-13T00:00:00Z",
  };
}

function gatewayFixture() {
  const line =
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: ANSWER }] } }) +
    "\n";
  return {
    collectInstructions: vi.fn().mockResolvedValue({ version: 1, files: [] }),
    listServers: vi.fn().mockResolvedValue([
      {
        id: "linux",
        name: "Linux server",
        host: "linux",
        username: "codex",
        port: 22,
        connected: true,
      },
    ]),
    connectServer: vi.fn(),
    disconnectServer: vi.fn(),
    removeServer: vi.fn(),
    getRunner: vi.fn().mockResolvedValue({
      protocolVersion: 1,
      runnerId: "runner",
      name: "Linux server",
      capabilities: { taskExecution: true, eventReplay: true, taskContinuation: true },
    }),
    listProjects: vi.fn().mockResolvedValue({ items: [{ id: "project", name: "Server app" }] }),
    cloneProject: vi.fn(),
    getProjectClone: vi.fn(),
    cancelProjectClone: vi.fn(),
    listTasks: vi.fn().mockImplementation(async ({ after }: { after: number }) => ({
      items: after >= 1 ? [] : [task()],
      nextCursor: null,
    })),
    createTask: vi.fn(),
    startTask: vi.fn(),
    getTask: vi.fn().mockResolvedValue(task()),
    getTaskResume: vi.fn().mockResolvedValue({ available: true, reason: null }),
    continueTask: vi.fn(),
    cancelTask: vi.fn(),
    listEvents: vi.fn().mockImplementation(async ({ after }: { after: number }) => ({
      items:
        after >= 2
          ? []
          : [
              {
                taskId: "first",
                sequence: 1,
                type: "task.output",
                text: line,
                channel: "stdout",
                createdAt: "2026-09-13T00:00:01Z",
              },
              {
                taskId: "first",
                sequence: 2,
                type: "task.succeeded",
                createdAt: "2026-09-13T00:00:02Z",
              },
            ],
      nextCursor: null,
    })),
    getDiff: vi.fn().mockResolvedValue({ diff: "", truncated: false }),
    uploadAttachment: vi.fn(),
  } satisfies RemoteRunnerGateway;
}

function surfacesFixture() {
  return {
    capabilities: vi.fn().mockResolvedValue({ files: true, history: true, terminal: true }),
    listDirectory: vi.fn<RemoteRunnerSurfacesGateway["listDirectory"]>(async ({ path }) => ({
      entries: [{ name: "app.ts", path: path === "" ? "app.ts" : `${path}/app.ts`, kind: "file" }],
      nextOffset: null,
      truncated: false,
    })),
    readFile: vi.fn<RemoteRunnerSurfacesGateway["readFile"]>(async ({ path }) => {
      if (path === "src/gone.ts")
        throw new RemoteSurfaceNotFoundError("This file isn't on the server.");
      return {
        path,
        text: "import x;\nexport const handler = 1;\n",
        version: "a".repeat(64),
        unavailableReason: null,
      };
    }),
    writeFile: vi.fn(),
    history: vi.fn(),
    commitFiles: vi.fn(),
    commitDiff: vi.fn(),
    openTerminal: vi.fn(),
    pollTerminal: vi.fn(),
    writeTerminal: vi.fn(),
    resizeTerminal: vi.fn(),
    closeTerminal: vi.fn(),
  } satisfies RemoteRunnerSurfacesGateway;
}

describe("file links in server threads", () => {
  let host: HTMLDivElement;
  let root: Root;
  const originalScrollIntoView = Element.prototype.scrollIntoView;

  beforeAll(async () => {
    await loadAgentMarkdownRenderer();
  });

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    Element.prototype.scrollIntoView = () => undefined;
    monaco.positions.length = 0;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  it("opens the linked file from the server checkout at the linked line", async () => {
    const surfaces = surfacesFixture();
    await renderRemoteThread(surfaces);

    await act(async () => (await pathLink("src/app.ts:2")).click());

    await waitForReact(() =>
      expect(surfaces.readFile).toHaveBeenCalledWith({
        serverId: "linux",
        runnerId: "runner",
        projectId: "project",
        taskId: "first",
        path: "src/app.ts",
      }),
    );
    await waitForReact(() =>
      expect(monaco.positions).toContainEqual({
        path: expect.stringContaining("src%2Fapp.ts"),
        lineNumber: 2,
      }),
    );
    const panel = host.querySelector<HTMLElement>('[data-surface-panel="files"]');
    expect(panel?.hidden).toBe(false);
    expect(panel?.querySelector('[aria-label="Server file text"]')).not.toBeNull();
    expect(surfaces.listDirectory).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "first", path: "src", offset: 0 }),
    );
    expect(notice()).toBeNull();
  });

  it("opens an absolute link into the thread's runner worktree relative to that worktree", async () => {
    const surfaces = surfacesFixture();
    await renderRemoteThread(surfaces);

    await act(async () => (await markdownLink("the absolute handler")).click());

    await waitForReact(() =>
      expect(surfaces.readFile).toHaveBeenCalledWith({
        serverId: "linux",
        runnerId: "runner",
        projectId: "project",
        taskId: "first",
        path: "src/app.ts",
      }),
    );
    await waitForReact(() =>
      expect(monaco.positions).toContainEqual({
        path: expect.stringContaining("src%2Fapp.ts"),
        lineNumber: 2,
      }),
    );
    expect(notice()).toBeNull();
  });

  it("refuses absolute server paths without contacting the server", async () => {
    const surfaces = surfacesFixture();
    await renderRemoteThread(surfaces);

    await act(async () => (await markdownLink("config")).click());

    await waitForReact(() =>
      expect(notice()?.textContent).toContain("/srv/app/config.ts wasn't opened."),
    );
    expect(surfaces.readFile).not.toHaveBeenCalled();
  });

  it("explains a missing server file in the thread notice", async () => {
    const surfaces = surfacesFixture();
    await renderRemoteThread(surfaces);

    await act(async () => (await pathLink("src/gone.ts")).click());

    await waitForReact(() => expect(notice()?.textContent).toContain("src/gone.ts isn't in this"));
    expect(host.querySelector('[data-surface-panel="files"] [role="alert"]')?.textContent).toBe(
      "This file isn't on the server.",
    );
  });

  async function renderRemoteThread(surfaces: RemoteRunnerSurfacesGateway) {
    const gateway = gatewayFixture();
    function Harness() {
      const [layout, dispatch] = useReducer(
        agentWorkbenchLayoutReducer,
        initialAgentWorkbenchLayout,
      );
      return (
        <RemoteRunnerProvider gateway={gateway} surfacesGateway={surfaces}>
          <AgentModeView
            agents={{
              ...threadsSurfaceFixture(),
              providerManagement: unconfiguredAgentProviderManagement(),
            }}
            chrome={chromeFixture({
              layout: { layout, effectiveLayout: "agent", persistedBottomPanel: false, dispatch },
            })}
            onOpenEnvironmentSettings={() => undefined}
            onReleaseProject={() => undefined}
            onTrustProject={() => undefined}
            overflowRootPaths={[]}
            projects={[projectFixture()]}
            providerEnabled={{ claudeCode: true, codex: true }}
            workspaceRoot={SURFACE_FIXTURE_ROOT}
          />
        </RemoteRunnerProvider>
      );
    }
    await act(async () => root.render(<Harness />));
    await waitForReact(() => expect(gateway.listProjects).toHaveBeenCalled());
    await waitForReact(() => {
      const palette = workbenchAgentPaletteProvider.current();
      expect(palette?.projects.some((entry) => entry.label === "Server app")).toBe(true);
    });
    act(() => {
      const palette = workbenchAgentPaletteProvider.current();
      const project = palette?.projects.find((entry) => entry.label === "Server app");
      palette?.switchProject(project!.key);
    });
    await waitForReact(() =>
      expect(host.querySelector(`[data-thread-id="${remoteThreadId}"]`)).not.toBeNull(),
    );
    await act(async () =>
      host
        .querySelector(`[data-thread-id="${remoteThreadId}"]`)!
        .dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    await waitForReact(() =>
      expect(surfaces.capabilities).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: "first" }),
      ),
    );
  }

  async function pathLink(text: string): Promise<HTMLAnchorElement> {
    let found: HTMLAnchorElement | undefined;
    await waitForReact(() => {
      found = [...host.querySelectorAll<HTMLAnchorElement>("a.agent-md__path-link")].find(
        (candidate) => candidate.textContent === text,
      );
      expect(found).toBeDefined();
    });
    return found!;
  }

  async function markdownLink(text: string): Promise<HTMLAnchorElement> {
    let found: HTMLAnchorElement | undefined;
    await waitForReact(() => {
      found = [...host.querySelectorAll<HTMLAnchorElement>("a.agent-md__link")].find(
        (candidate) => candidate.textContent === text,
      );
      expect(found).toBeDefined();
    });
    return found!;
  }

  function notice(): HTMLElement | null {
    return host.querySelector<HTMLElement>(".agent-notice");
  }
});
