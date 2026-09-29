// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { threadsSurfaceFixture } from "../components/agentMode/agentThreadsSurfaceTestFixtures";
import type { AgentThreadsSurface } from "./agentThreadPorts";
import { useRemoteAgentStableSurface } from "./useRemoteAgentStableSurface";

const REMOTE_THREAD_ID = "remote-thread:server-1:runner-1:conv-1";

const cleanups: Array<() => void> = [];

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
});

function stable(surface: AgentThreadsSurface): AgentThreadsSurface {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let latest: AgentThreadsSurface | null = null;
  function Harness() {
    latest = useRemoteAgentStableSurface(surface);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Harness)));
  cleanups.push(() => act(() => root.unmount()));
  expect(latest).not.toBeNull();
  return latest as unknown as AgentThreadsSurface;
}

describe("useRemoteAgentStableSurface session control", () => {
  it("forwards the end result and background inspection for local threads", async () => {
    const endSession = vi.fn(async () => "ended" as const);
    const inspectSessionBackground = vi.fn(async () => "live" as const);
    const surface = stable(threadsSurfaceFixture({ endSession, inspectSessionBackground }));

    await expect(surface.endSession?.("agt-1-0a1c")).resolves.toBe("ended");
    await expect(surface.inspectSessionBackground?.("agt-1-0a1c")).resolves.toBe("live");
    expect(endSession).toHaveBeenCalledWith("agt-1-0a1c");
    expect(inspectSessionBackground).toHaveBeenCalledWith("agt-1-0a1c");
  });

  it("answers none for remote threads and surfaces without session control", async () => {
    const endSession = vi.fn(async () => "ended" as const);
    const inspectSessionBackground = vi.fn(async () => "live" as const);
    const local = stable(threadsSurfaceFixture({ endSession, inspectSessionBackground }));
    const bare = stable(threadsSurfaceFixture());

    await expect(local.endSession?.(REMOTE_THREAD_ID)).resolves.toBe("none");
    await expect(local.inspectSessionBackground?.(REMOTE_THREAD_ID)).resolves.toBe("none");
    await expect(bare.endSession?.("agt-1-0a1c")).resolves.toBe("none");
    await expect(bare.inspectSessionBackground?.("agt-1-0a1c")).resolves.toBe("none");
    expect(endSession).not.toHaveBeenCalled();
    expect(inspectSessionBackground).not.toHaveBeenCalled();
  });
});
