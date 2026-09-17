// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RemoteRunnerSurfacesGateway } from "../../domain/remoteRunnerSurfaces";
import { RemoteTerminalPanel } from "./RemoteTerminalPanel";
const mocks = vi.hoisted(() => ({
  sessions: [] as Array<{
    dispose: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
  }>,
  create: vi.fn(),
}));
vi.mock("../../application/remoteTerminalSession", () => ({
  createRemoteTerminalSession: (options: { onState(state: { kind: string }): void }) => {
    mocks.create(options);
    const session = { dispose: vi.fn(), close: vi.fn(), write: vi.fn(), resize: vi.fn() };
    mocks.sessions.push(session);
    options.onState({ kind: "connected" });
    return session;
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
  },
}));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    options = {};
    cols = 80;
    rows = 24;
    loadAddon() {}
    open() {}
    dispose() {}
    focus() {}
    write(_data: string, done: () => void) {
      done();
    }
    onData() {
      return { dispose() {} };
    }
    onResize() {
      return { dispose() {} };
    }
  },
}));
const scope = { serverId: "a", runnerId: "r", projectId: "p", taskId: "t" };
const gateway = {} as RemoteRunnerSurfacesGateway;
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  mocks.sessions.length = 0;
});
function mount() {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<RemoteTerminalPanel gateway={gateway} scope={scope} isActive />));
  return {
    container,
    root,
    destroy() {
      act(() => root.unmount());
      container.remove();
    },
  };
}
describe("RemoteTerminalPanel", () => {
  it("attaches exact server owner and closes only via explicit toolbar action", () => {
    const view = mount();
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ scope }));
    expect(view.container.textContent).toContain("Server terminal");
    act(() => view.container.querySelector("button")!.click());
    expect(mocks.sessions[0].close).toHaveBeenCalledTimes(1);
    view.destroy();
    expect(mocks.sessions[0].dispose).toHaveBeenCalledTimes(1);
    expect(mocks.sessions[0].close).toHaveBeenCalledTimes(1);
  });
  it("detaches and reattaches on A to B to A without closing server shells", () => {
    const view = mount();
    act(() =>
      view.root.render(
        <RemoteTerminalPanel gateway={gateway} scope={{ ...scope, serverId: "b" }} isActive />,
      ),
    );
    act(() => view.root.render(<RemoteTerminalPanel gateway={gateway} scope={scope} isActive />));
    expect(mocks.sessions).toHaveLength(3);
    expect(mocks.sessions[0].dispose).toHaveBeenCalledTimes(1);
    expect(mocks.sessions[1].dispose).toHaveBeenCalledTimes(1);
    expect(mocks.sessions.every((session) => session.close.mock.calls.length === 0)).toBe(true);
    view.destroy();
  });
});
