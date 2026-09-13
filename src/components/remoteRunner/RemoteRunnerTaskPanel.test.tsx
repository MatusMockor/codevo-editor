// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteRunnerTasksSurface } from "../../application/useRemoteRunnerTasks";
import type { RemoteRunnerGateway } from "../../domain/remoteRunner";
import { RemoteRunnerTaskPanel } from "./RemoteRunnerTaskPanel";

const mock = vi.hoisted(() => ({ surface: null as RemoteRunnerTasksSurface | null }));
vi.mock("../../application/useRemoteRunnerTasks", () => ({
  useRemoteRunnerTasks: () => mock.surface,
}));

vi.mock("./RemoteProjectCloneForm", () => ({
  RemoteProjectCloneForm: ({
    onCloned,
  }: {
    onCloned: (project: { id: string; name: string }) => Promise<void>;
  }) => (
    <button type="button" onClick={() => void onCloned({ id: "cloned", name: "Cloned" })}>
      Complete test clone
    </button>
  ),
}));

describe("RemoteRunnerTaskPanel", () => {
  let host: HTMLDivElement;
  let root: Root;
  const task = {
    id: "task-1",
    sequence: 1,
    runnerId: "runner",
    provider: "codex" as const,
    status: "running" as const,
    parts: [{ type: "text" as const, text: "Fix the server test" }],
    createdAt: "2026-09-13T00:00:00Z",
  };
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    mock.surface = {
      descriptor: {
        protocolVersion: 1,
        runnerId: "runner",
        name: "Linux",
        capabilities: { taskExecution: true, eventReplay: true },
      },
      projects: [{ id: "project", name: "Server repo" }],
      tasks: [task],
      hasMore: false,
      selectedTask: null,
      resume: null,
      continuationUncertain: false,
      continueTask: vi.fn().mockResolvedValue(task),
      resetSelection: vi.fn(),
      events: [],
      diff: null,
      busy: false,
      error: null,
      loading: false,
      submit: vi.fn().mockResolvedValue(task),
      selectTask: vi.fn(),
      refresh: vi.fn().mockResolvedValue(undefined),
      loadMore: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn().mockResolvedValue(undefined),
      startDraft: vi.fn().mockResolvedValue(task),
    };
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });
  function render(serverId = "server") {
    act(() =>
      root.render(
        <RemoteRunnerTaskPanel
          gateway={{} as RemoteRunnerGateway}
          serverId={serverId}
          serverName="Linux"
          workspaceOwner="workspace"
          environmentPicker={<button>This computer</button>}
        />,
      ),
    );
  }
  function input(value: string) {
    act(() => {
      const textarea = host.querySelector("textarea")!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        textarea,
        value,
      );
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  it("submits to the explicit remote project/provider and preserves local escape", async () => {
    render();
    input("Please fix this");
    await act(async () => {
      host
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(mock.surface!.submit).toHaveBeenCalledWith({
      projectId: "project",
      provider: "codex",
      prompt: "Please fix this",
      attachments: [],
    });
    expect(host.querySelector("textarea")!.value).toBe("");
    expect(host.textContent).toContain("This computer");
  });
  it("clears a draft across server ownership and displays durable history", () => {
    render();
    input("Private first-server prompt");
    render("other-server");
    expect(host.querySelector("textarea")!.value).toBe("");
    expect(host.querySelector('[aria-label="Remote task history"]')!.textContent).toContain(
      "Fix the server test",
    );
  });
  it("cancels active server work and labels remote diff without claiming local synchronization", async () => {
    mock.surface = {
      ...mock.surface!,
      selectedTask: task,
      diff: { patch: "+fixed", truncated: true, untrackedFiles: ["new.ts"] },
    };
    render();
    const cancel = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === " Stop task",
    )!;
    await act(async () => cancel.click());
    expect(mock.surface!.cancel).toHaveBeenCalledOnce();
    expect(host.textContent).toContain("Your local files have not been updated");
    expect(host.textContent).toContain("too large to show in full");
  });
  it("keeps a failed submission available for retry", async () => {
    mock.surface!.submit = vi.fn().mockResolvedValue(null);
    render();
    input("Keep my prompt");
    await act(async () => {
      host
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(host.querySelector("textarea")!.value).toBe("Keep my prompt");
  });
  it.each([false, true])(
    "pastes an image without text (continuation: %s)",
    async (continuation) => {
      const readAsDataURL = FileReader.prototype.readAsDataURL;
      let settleRead: () => void = () => undefined;
      const readFinished = new Promise<void>((resolve) => {
        settleRead = resolve;
      });
      vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (
        this: FileReader,
        blob: Blob,
      ) {
        this.addEventListener("loadend", settleRead, { once: true });
        readAsDataURL.call(this, blob);
      });
      if (continuation)
        mock.surface = {
          ...mock.surface!,
          descriptor: {
            ...mock.surface!.descriptor!,
            capabilities: { taskExecution: true, eventReplay: true, taskContinuation: true },
          },
          selectedTask: { ...task, status: "succeeded", projectId: "project" },
          resume: { available: true, reason: null },
        };
      render();
      if (continuation)
        act(() =>
          Array.from(host.querySelectorAll("button"))
            .find((button) => button.textContent === "Continue conversation")!
            .click(),
        );
      const file = new File(["image"], "screenshot.png", { type: "image/png" });
      const paste = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(paste, "clipboardData", { value: { files: [file] } });
      await act(async () => {
        host.querySelector("textarea")!.dispatchEvent(paste);
        await readFinished;
      });
      expect(host.querySelector("img")?.alt).toBe("screenshot.png");
      await act(async () => {
        host
          .querySelector("form")!
          .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });
      expect(continuation ? mock.surface!.continueTask : mock.surface!.submit).toHaveBeenCalledWith(
        {
          projectId: "project",
          provider: "codex",
          prompt: "",
          attachments: [{ name: "screenshot.png", mediaType: "image/png", base64: "aW1hZ2U=" }],
        },
      );
    },
  );
  it("rejects unsupported dropped files before reading or sending", () => {
    render();
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", {
      value: { files: [new File(["secret"], "notes.txt", { type: "text/plain" })] },
    });
    act(() => {
      host.querySelector("form")!.dispatchEvent(drop);
    });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("PNG or JPEG");
    expect(mock.surface!.submit).not.toHaveBeenCalled();
    expect(host.querySelector("img")).toBeNull();
  });
  it("ignores an image read that settles after switching servers", async () => {
    const readers: FileReader[] = [];
    vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (this: FileReader) {
      readers.push(this);
    });
    render();
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: { files: [new File(["image"], "private.png", { type: "image/png" })] },
    });
    act(() => {
      host.querySelector("textarea")!.dispatchEvent(paste);
    });
    render("other-server");
    await act(async () => {
      Object.defineProperty(readers[0], "result", { value: "data:image/png;base64,aW1hZ2U=" });
      readers[0]!.dispatchEvent(new ProgressEvent("load"));
    });
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector("textarea")!.disabled).toBe(false);
  });
  it("shows an image read error and allows retry", async () => {
    vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (this: FileReader) {
      this.dispatchEvent(new ProgressEvent("error"));
    });
    render();
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: { files: [new File(["image"], "bad.png", { type: "image/png" })] },
    });
    await act(async () => {
      host.querySelector("textarea")!.dispatchEvent(paste);
    });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Could not read");
    expect(host.querySelector("textarea")!.disabled).toBe(false);
  });
  it("requires an explicit continuation and locks the original provider and project", async () => {
    mock.surface = {
      ...mock.surface!,
      descriptor: {
        ...mock.surface!.descriptor!,
        capabilities: { taskExecution: true, eventReplay: true, taskContinuation: true },
      },
      selectedTask: { ...task, status: "succeeded", provider: "claude", projectId: "project" },
      resume: { available: true, reason: null },
    };
    render();
    expect(host.querySelector("textarea")!.disabled).toBe(true);
    const continuation = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "Continue conversation",
    )!;
    act(() => continuation.click());
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Remote provider"]')!.value).toBe(
      "claude",
    );
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Remote provider"]')!.disabled).toBe(
      true,
    );
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Server project"]')!.disabled).toBe(
      true,
    );
    input("Keep working here");
    await act(async () =>
      host
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(mock.surface!.continueTask).toHaveBeenCalledWith({
      projectId: "project",
      provider: "claude",
      prompt: "Keep working here",
      attachments: [],
    });
    expect(mock.surface!.submit).not.toHaveBeenCalled();
  });
  it("does not fall back to a new task when continuation is unavailable", async () => {
    mock.surface = {
      ...mock.surface!,
      descriptor: {
        ...mock.surface!.descriptor!,
        capabilities: { taskExecution: true, eventReplay: true, taskContinuation: true },
      },
      selectedTask: { ...task, status: "succeeded", projectId: "project" },
      resume: { available: false, reason: "newer_turn_exists" },
    };
    render();
    expect(host.textContent).toContain("Select its latest task");
    await act(async () =>
      host
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(mock.surface!.submit).not.toHaveBeenCalled();
    expect(mock.surface!.continueTask).not.toHaveBeenCalled();
    act(() =>
      Array.from(host.querySelectorAll("button"))
        .find((button) => button.textContent === "New conversation")!
        .click(),
    );
    expect(mock.surface!.resetSelection).toHaveBeenCalledOnce();
  });
  it("preserves the exact follow-up while an uncertain continuation is recovered", () => {
    mock.surface = {
      ...mock.surface!,
      descriptor: {
        ...mock.surface!.descriptor!,
        capabilities: { taskExecution: true, eventReplay: true, taskContinuation: true },
      },
      selectedTask: { ...task, status: "succeeded", projectId: "project" },
      resume: { available: true, reason: null },
    };
    render();
    act(() =>
      Array.from(host.querySelectorAll("button"))
        .find((button) => button.textContent === "Continue conversation")!
        .click(),
    );
    input("Preserve this exact follow-up");
    mock.surface = { ...mock.surface!, continuationUncertain: true };
    render();
    expect(host.querySelector("textarea")!.disabled).toBe(true);
    const start = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "New conversation",
    )!;
    expect(start.disabled).toBe(true);
    act(() => start.click());
    expect(mock.surface!.resetSelection).not.toHaveBeenCalled();
    expect(host.querySelector("textarea")!.value).toBe("Preserve this exact follow-up");
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Attach images"]')!.disabled).toBe(
      true,
    );
    expect(host.textContent).toContain("Refresh to recover");
    expect(host.querySelector<HTMLButtonElement>(".remote-task__history-item")!.disabled).toBe(
      true,
    );
    expect(
      host.querySelector<HTMLButtonElement>('[aria-label="Refresh remote tasks"]')!.disabled,
    ).toBe(false);
  });
  it("explains that an older runner needs an update", () => {
    mock.surface = { ...mock.surface!, selectedTask: { ...task, status: "succeeded" } };
    render();
    expect(host.textContent).toContain("Update the server runner");
  });
  it("defers clone refresh during a task mutation and selects only a listed project", async () => {
    mock.surface = { ...mock.surface!, busy: true };
    render();
    await act(async () => {
      Array.from(host.querySelectorAll("button"))
        .find((button) => button.textContent === "Complete test clone")!
        .click();
    });
    expect(mock.surface!.refresh).not.toHaveBeenCalled();
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Server project"]')!.value).toBe(
      "project",
    );
    mock.surface = { ...mock.surface!, busy: false };
    render();
    expect(mock.surface!.refresh).toHaveBeenCalledOnce();
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Server project"]')!.value).toBe(
      "project",
    );
    mock.surface = {
      ...mock.surface!,
      projects: [...mock.surface!.projects, { id: "cloned", name: "Cloned" }],
    };
    render();
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Server project"]')!.value).toBe(
      "cloned",
    );
  });
});
