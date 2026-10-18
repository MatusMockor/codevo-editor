// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { SpeechDictationPorts } from "../../application/speechDictationPorts";
import { TauriRemoteRunnerGateway } from "../../infrastructure/tauriRemoteRunnerGateway";
import { RemoteRunnerProvider } from "./RemoteRunnerProvider";
import { useRemoteRunnerContext, type RemoteRunnerContextValue } from "./remoteRunnerContext";

function Selection() {
  const remote = useRemoteRunnerContext();
  if (!remote) return <p>Local only</p>;
  return (
    <>
      <p>{remote.selectedServerId ?? "This computer"}</p>
      <button onClick={() => remote.selectServer("linux")}>Select server</button>
      <button onClick={() => remote.selectServer(null)}>Select local</button>
    </>
  );
}

const LINUX = {
  id: "linux",
  name: "Linux",
  host: "linux",
  username: "codex",
  port: 22,
  connected: true,
};

function selectionLabels(host: HTMLElement): readonly (string | null)[] {
  return Array.from(host.querySelectorAll("p"), (item) => item.textContent);
}

describe("RemoteRunnerProvider", () => {
  it("preserves local consumers without a provider", () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const host = document.createElement("div");
    const root = createRoot(host);
    try {
      act(() => root.render(<Selection />));
      expect(host.textContent).toBe("Local only");
    } finally {
      act(() => root.unmount());
    }
  });

  it("starts local and shares an explicit selection across consumers", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const host = document.createElement("div");
    const root = createRoot(host);
    const invoke = vi.fn().mockResolvedValue([LINUX]);
    const gateway = new TauriRemoteRunnerGateway(invoke);
    try {
      await act(async () =>
        root.render(
          <RemoteRunnerProvider gateway={gateway}>
            <Selection />
            <Selection />
          </RemoteRunnerProvider>,
        ),
      );
      expect(Array.from(host.querySelectorAll("p"), (item) => item.textContent)).toEqual([
        "This computer",
        "This computer",
      ]);
      await act(async () => host.querySelector<HTMLButtonElement>("button")?.click());
      expect(Array.from(host.querySelectorAll("p"), (item) => item.textContent)).toEqual([
        "linux",
        "linux",
      ]);
      await act(async () => host.querySelectorAll("button")[1]?.click());
      expect(Array.from(host.querySelectorAll("p"), (item) => item.textContent)).toEqual([
        "This computer",
        "This computer",
      ]);
      expect(invoke).toHaveBeenCalledTimes(1);
    } finally {
      act(() => root.unmount());
    }
  });

  it("hands the composed dictation ports to consumers and defaults to none", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const host = document.createElement("div");
    const root = createRoot(host);
    const gateway = new TauriRemoteRunnerGateway(vi.fn().mockResolvedValue([]));
    const ports: SpeechDictationPorts = {
      capture: {
        isSupported: () => false,
        start: () => ({
          started: Promise.resolve({ kind: "failed", reason: "unsupported" }),
          stop: () => undefined,
        }),
      },
      transcriber: { transcribe: async () => ({ kind: "transcribed", text: "" }) },
    };
    const seen: (SpeechDictationPorts | null | undefined)[] = [];
    function Probe() {
      seen.push(useRemoteRunnerContext()?.speechDictation);
      return null;
    }
    try {
      await act(async () =>
        root.render(
          <RemoteRunnerProvider gateway={gateway}>
            <Probe />
          </RemoteRunnerProvider>,
        ),
      );
      expect(seen[seen.length - 1]).toBeNull();
      await act(async () =>
        root.render(
          <RemoteRunnerProvider gateway={gateway} speechDictation={ports}>
            <Probe />
          </RemoteRunnerProvider>,
        ),
      );
      expect(seen[seen.length - 1]).toBe(ports);
    } finally {
      act(() => root.unmount());
    }
  });

  it("drops the server selection once the known server list no longer contains it", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const host = document.createElement("div");
    const root = createRoot(host);
    let listed: unknown[] = [LINUX];
    let releaseList: (() => void) | null = null;
    const invoke = vi.fn(async (command: string) => {
      if (command !== "remote_runner_list_servers") return null;
      if (releaseList === null) return listed;
      await new Promise<void>((resolve) => {
        const release = releaseList;
        releaseList = () => {
          release?.();
          resolve();
        };
      });
      return listed;
    });
    const gateway = new TauriRemoteRunnerGateway(invoke);
    let refresh: () => Promise<void> = async () => undefined;
    function Refresh() {
      const remote = useRemoteRunnerContext();
      refresh = remote?.refresh ?? refresh;
      return null;
    }
    try {
      await act(async () =>
        root.render(
          <RemoteRunnerProvider gateway={gateway}>
            <Selection />
            <Refresh />
          </RemoteRunnerProvider>,
        ),
      );
      await act(async () => host.querySelector<HTMLButtonElement>("button")?.click());
      expect(selectionLabels(host)).toEqual(["linux"]);

      listed = [];
      releaseList = () => undefined;
      let pending: Promise<void> = Promise.resolve();
      await act(async () => {
        pending = refresh();
      });
      expect(selectionLabels(host)).toEqual(["linux"]);

      await act(async () => {
        releaseList?.();
        await pending;
      });
      expect(selectionLabels(host)).toEqual(["This computer"]);

      listed = [LINUX];
      releaseList = null;
      await act(async () => refresh());
      expect(selectionLabels(host)).toEqual(["This computer"]);
    } finally {
      act(() => root.unmount());
    }
  });

  it("keeps the server selection when a connect follows a failed server listing", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const host = document.createElement("div");
    const root = createRoot(host);
    const staging = { ...LINUX, id: "staging", name: "Staging", host: "staging" };
    const invoke = vi.fn(async (command: string) => {
      if (command === "remote_runner_list_servers")
        throw new Error("Saved servers are unavailable.");
      if (command === "remote_runner_connect_server") return staging;
      return null;
    });
    const gateway = new TauriRemoteRunnerGateway(invoke);
    let connect: RemoteRunnerContextValue["connect"] = async () => null;
    function Connect() {
      const remote = useRemoteRunnerContext();
      connect = remote?.connect ?? connect;
      return null;
    }
    try {
      await act(async () =>
        root.render(
          <RemoteRunnerProvider gateway={gateway}>
            <Selection />
            <Connect />
          </RemoteRunnerProvider>,
        ),
      );
      await act(async () => host.querySelector<HTMLButtonElement>("button")?.click());
      expect(selectionLabels(host)).toEqual(["linux"]);

      await act(async () => {
        const { id, name, host: address, username, port } = staging;
        await connect({ id, name, host: address, username, port });
      });

      expect(selectionLabels(host)).toEqual(["linux"]);
    } finally {
      act(() => root.unmount());
    }
  });
});
