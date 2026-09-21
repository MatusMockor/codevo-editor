// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentExistingServerProjectDialog,
  AgentProjectSourceDialog,
} from "./AgentProjectSourceDialog";

const servers = [
  { id: "server-a", name: "Linux", host: "one.test", username: "dev", port: 22, connected: true },
  { id: "server-b", name: "Linux", host: "two.test", username: "dev", port: 22, connected: true },
];

describe("AgentProjectSourceDialog", () => {
  let host: HTMLDivElement;
  let root: Root;
  const onChoose = vi.fn();
  const onClose = vi.fn();
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.clearAllMocks();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  function render(
    options: {
      selectedServerId?: string | null;
      cloneBlocked?: boolean;
      localCloneAvailable?: boolean;
    } = {},
  ) {
    act(() =>
      root.render(
        <AgentProjectSourceDialog
          servers={servers}
          selectedServerId={null}
          localCloneAvailable
          onChoose={onChoose}
          onClose={onClose}
          {...options}
        />,
      ),
    );
  }
  function button(name: string) {
    return Array.from(host.querySelectorAll("button")).find((entry) => entry.textContent === name)!;
  }
  it.each(["existing", "clone"] as const)("routes local %s to this computer", (action) => {
    render();
    act(() => button(action === "existing" ? "Open existing folder" : "Clone repository").click());
    expect(onChoose).toHaveBeenCalledExactlyOnceWith(null, action);
  });
  it("routes a changed server by exact identity even when labels match", () => {
    render({ selectedServerId: "server-a" });
    const select = host.querySelector("select")!;
    act(() => {
      select.value = "server-b";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    act(() => button("Clone repository").click());
    expect(onChoose).toHaveBeenCalledExactlyOnceWith("server-b", "clone");
  });
  it("blocks another clone while allowing existing server projects", () => {
    render({ selectedServerId: "server-a", cloneBlocked: true });
    expect(button("Clone repository").disabled).toBe(true);
    act(() => button("Clone repository").click());
    expect(onChoose).not.toHaveBeenCalled();
    act(() => button("Open server project").click());
    expect(onChoose).toHaveBeenCalledExactlyOnceWith("server-a", "existing");
  });
  it("disables unavailable local cloning without disabling remote cloning", () => {
    render({ localCloneAvailable: false });
    expect(button("Clone repository").disabled).toBe(true);
    expect(button("Open existing folder").disabled).toBe(false);
    const select = host.querySelector("select")!;
    act(() => {
      select.value = "server-a";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(button("Clone repository").disabled).toBe(false);
  });
  it("consumes Escape and closes without selecting a project", () => {
    render();
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => host.querySelector("select")!.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
    expect(onChoose).not.toHaveBeenCalled();
  });
  it("selects the physical server project key rather than its display label", () => {
    const onSelect = vi.fn();
    act(() =>
      root.render(
        <AgentExistingServerProjectDialog
          projects={[
            { key: "physical-a", label: "Project" },
            { key: "physical-b", label: "Project" },
          ]}
          onSelect={onSelect}
          onClose={onClose}
        />,
      ),
    );
    act(() =>
      host
        .querySelectorAll(".quick-open-result")[1]!
        .dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("physical-b");
    expect(onClose).not.toHaveBeenCalled();
  });
  it("shows an empty server with an explicit close action", () => {
    const onSelect = vi.fn();
    act(() =>
      root.render(
        <AgentExistingServerProjectDialog projects={[]} onSelect={onSelect} onClose={onClose} />,
      ),
    );
    expect(host.textContent).toContain("No projects available on this server");
    expect(host.querySelectorAll(".quick-open-result")).toHaveLength(0);
    act(() => button("Close").click());
    expect(onClose).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
