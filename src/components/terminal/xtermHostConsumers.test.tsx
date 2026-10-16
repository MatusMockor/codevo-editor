// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classicTerminalTheme } from "../../domain/appColorThemes";
import type { RemoteRunnerSurfacesGateway } from "../../domain/remoteRunnerSurfaces";
import type { TerminalGateway } from "../../domain/terminal";
import { RemoteTerminalPanel } from "../remoteRunner/RemoteTerminalPanel";
import { TerminalPanel } from "../TerminalPanel";
import * as host from "./useXtermHost";

const mocks = vi.hoisted(() => ({ useXtermHost: vi.fn() }));

vi.mock("./useXtermHost", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./useXtermHost")>();
  mocks.useXtermHost.mockImplementation(actual.useXtermHost);
  return { ...actual, useXtermHost: mocks.useXtermHost };
});

vi.mock("../terminalSession", () => ({
  createTerminalSession: vi.fn(() => ({ dispose: vi.fn(), fit: vi.fn() })),
}));

vi.mock("../../application/remoteTerminalSession", () => ({
  createRemoteTerminalSession: vi.fn(() => ({
    close: vi.fn(),
    dispose: vi.fn(),
    resize: vi.fn(),
    write: vi.fn(),
  })),
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
    write() {}
    onData() {
      return { dispose() {} };
    }
    onResize() {
      return { dispose() {} };
    }
  },
}));

describe("xterm host consumers", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    mocks.useXtermHost.mockClear();
  });

  afterEach(() => vi.unstubAllGlobals());

  it("mounts the local and the remote terminal through the shared xterm host", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const theme = classicTerminalTheme("classicDark");
    act(() =>
      root.render(
        <>
          <TerminalPanel
            isActive
            profileId={null}
            rootPath="/workspace"
            shellIntegrationEnabled={false}
            terminalGateway={{} as TerminalGateway}
            terminalTheme={theme}
          />
          <RemoteTerminalPanel
            gateway={{} as RemoteRunnerSurfacesGateway}
            isActive={false}
            scope={{ serverId: "s", runnerId: "r", projectId: "p" }}
            terminalTheme={theme}
          />
        </>,
      ),
    );

    const inputs = mocks.useXtermHost.mock.calls.map(
      ([options]) => (options as host.XtermHostOptions).initialInput,
    );
    expect(inputs).toEqual(["enabled", "disabled"]);
    act(() => root.unmount());
    container.remove();
  });
});
