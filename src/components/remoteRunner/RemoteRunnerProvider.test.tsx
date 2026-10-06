// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { SpeechDictationPorts } from "../../application/speechDictationPorts";
import { TauriRemoteRunnerGateway } from "../../infrastructure/tauriRemoteRunnerGateway";
import { RemoteRunnerProvider } from "./RemoteRunnerProvider";
import { useRemoteRunnerContext } from "./remoteRunnerContext";

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
    const invoke = vi.fn().mockResolvedValue([]);
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
});
