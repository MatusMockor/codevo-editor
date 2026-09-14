// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RemoteRunnerGateway, RemoteRunnerServer } from "../domain/remoteRunner";
import {
  useRemoteRunnerConnections,
  type RemoteRunnerConnectionsSurface,
} from "./useRemoteRunnerConnections";

const saved: RemoteRunnerServer = {
  id: "linux",
  name: "Linux",
  host: "192.168.1.110",
  username: "codex",
  port: 22,
  connected: false,
};
const connected = { ...saved, connected: true };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function gateway() {
  return {
    listServers: vi.fn<RemoteRunnerGateway["listServers"]>().mockResolvedValue([saved]),
    connectServer: vi.fn<RemoteRunnerGateway["connectServer"]>().mockResolvedValue(connected),
    disconnectServer: vi.fn<RemoteRunnerGateway["disconnectServer"]>().mockResolvedValue(),
    removeServer: vi.fn<RemoteRunnerGateway["removeServer"]>().mockResolvedValue(),
    getRunner: vi.fn(),
    listProjects: vi.fn(),
    cloneProject: vi.fn(),
    getProjectClone: vi.fn(),
    cancelProjectClone: vi.fn(),
    listTasks: vi.fn(),
    createTask: vi.fn(),
    continueTask: vi.fn(),
    getTaskResume: vi.fn(),
    startTask: vi.fn(),
    getTask: vi.fn(),
    cancelTask: vi.fn(),
    listEvents: vi.fn(),
    getDiff: vi.fn(),
    uploadAttachment: vi.fn(),
  } satisfies RemoteRunnerGateway;
}
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose();
});
async function render(initial: RemoteRunnerGateway) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let surface!: RemoteRunnerConnectionsSurface;
  let disposed = false;
  function Harness({ value }: { value: RemoteRunnerGateway }) {
    surface = useRemoteRunnerConnections({ gateway: value });
    return null;
  }
  const unmount = () => {
    if (!disposed) {
      act(() => root.unmount());
      container.remove();
      disposed = true;
    }
  };
  cleanup.push(unmount);
  await act(async () => root.render(<Harness value={initial} />));
  return {
    current: () => surface,
    unmount,
    replace: async (value: RemoteRunnerGateway) => {
      await act(async () => root.render(<Harness value={value} />));
    },
  };
}

describe("useRemoteRunnerConnections", () => {
  it("loads saved servers and uses the canonical persisted connect response", async () => {
    const api = gateway();
    const h = await render(api);
    expect(h.current().servers).toEqual([saved]);
    expect(h.current().status).toBe("ready");
    const canonical = { ...connected, name: "Saved server name" };
    api.connectServer.mockResolvedValue(canonical);
    await act(async () => {
      expect(await h.current().connect(saved)).toEqual(canonical);
    });
    expect(api.connectServer).toHaveBeenCalledWith(saved);
    expect(h.current().servers).toEqual([canonical]);
  });

  it("refreshes persisted state after disconnect and removal", async () => {
    const api = gateway();
    api.listServers
      .mockResolvedValueOnce([connected])
      .mockResolvedValueOnce([saved])
      .mockResolvedValueOnce([]);
    const h = await render(api);
    await act(async () => h.current().disconnect(saved.id));
    expect(api.disconnectServer).toHaveBeenCalledWith({ serverId: saved.id });
    expect(h.current().servers).toEqual([saved]);
    await act(async () => h.current().remove(saved.id));
    expect(api.removeServer).toHaveBeenCalledWith({ serverId: saved.id });
    expect(h.current().servers).toEqual([]);
  });

  it("blocks overlapping mutations and refresh while connecting", async () => {
    const api = gateway();
    const pending = deferred<RemoteRunnerServer>();
    api.connectServer.mockReturnValue(pending.promise);
    const h = await render(api);
    let first!: Promise<RemoteRunnerServer | null>;
    await act(async () => {
      first = h.current().connect(saved);
      expect(await h.current().connect(saved)).toBeNull();
      await h.current().remove(saved.id);
      await h.current().disconnect(saved.id);
      await h.current().refresh();
    });
    expect(h.current().status).toBe("busy");
    expect(api.connectServer).toHaveBeenCalledTimes(1);
    expect(api.removeServer).not.toHaveBeenCalled();
    expect(api.disconnectServer).not.toHaveBeenCalled();
    expect(api.listServers).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve(connected);
      await first;
    });
    expect(h.current().status).toBe("ready");
  });

  it("does not let a stale refresh overwrite a newly connected server", async () => {
    const api = gateway();
    const pending = deferred<readonly RemoteRunnerServer[]>();
    api.listServers.mockReturnValueOnce(pending.promise);
    const h = await render(api);
    expect(h.current().status).toBe("loading");
    await act(async () => {
      await h.current().connect(saved);
    });
    await act(async () => {
      pending.resolve([saved]);
    });
    expect(h.current().servers).toEqual([connected]);
    expect(h.current().status).toBe("ready");
  });

  it.each(["resolve", "reject"] as const)(
    "ignores stale connect %s after a gateway switch and permits new work",
    async (settlement) => {
      const old = gateway();
      const pending = deferred<RemoteRunnerServer>();
      old.connectServer.mockReturnValue(pending.promise);
      const h = await render(old);
      let first!: Promise<RemoteRunnerServer | null>;
      act(() => {
        first = h.current().connect(saved);
      });
      const next = gateway();
      next.listServers.mockResolvedValue([]);
      await h.replace(next);
      await act(async () => {
        if (settlement === "resolve") pending.resolve(connected);
        else pending.reject(new Error("old connection failed"));
        expect(await first).toBeNull();
      });
      expect(h.current().servers).toEqual([]);
      expect(h.current().error).toBeNull();
      await act(async () => {
        await h.current().connect(saved);
      });
      expect(next.connectServer).toHaveBeenCalledTimes(1);
      expect(h.current().servers).toEqual([connected]);
    },
  );

  it.each(["disconnect", "remove"] as const)(
    "does not refresh an obsolete gateway after pending %s",
    async (action) => {
      const old = gateway();
      const pending = deferred<void>();
      if (action === "disconnect") old.disconnectServer.mockReturnValue(pending.promise);
      else old.removeServer.mockReturnValue(pending.promise);
      const h = await render(old);
      let first!: Promise<void>;
      act(() => {
        first = h.current()[action](saved.id);
      });
      const next = gateway();
      next.listServers.mockResolvedValue([]);
      await h.replace(next);
      await act(async () => {
        pending.resolve();
        await first;
      });
      expect(old.listServers).toHaveBeenCalledTimes(1);
      expect(h.current().servers).toEqual([]);
    },
  );

  it("does not refresh after unmount while disconnect is pending", async () => {
    const api = gateway();
    const pending = deferred<void>();
    api.disconnectServer.mockReturnValue(pending.promise);
    const h = await render(api);
    let operation!: Promise<void>;
    act(() => {
      operation = h.current().disconnect(saved.id);
    });
    h.unmount();
    await act(async () => {
      pending.resolve();
      await operation;
    });
    expect(api.listServers).toHaveBeenCalledTimes(1);
  });

  it("keeps callbacks stable on same-owner renders and rejects them after A to B to A", async () => {
    const first = gateway();
    const h = await render(first);
    const connect = h.current().connect;
    const refresh = h.current().refresh;
    await h.replace(first);
    expect(h.current().connect).toBe(connect);
    expect(h.current().refresh).toBe(refresh);
    expect(first.listServers).toHaveBeenCalledTimes(1);
    await h.replace(gateway());
    await h.replace(first);
    await act(async () => {
      expect(await connect(saved)).toBeNull();
      await refresh();
    });
    expect(first.connectServer).not.toHaveBeenCalled();
    expect(first.listServers).toHaveBeenCalledTimes(2);
    await act(async () => {
      expect(await h.current().connect(saved)).toEqual(connected);
    });
    expect(first.connectServer).toHaveBeenCalledTimes(1);
  });

  it("reports a failed mutation and allows retry", async () => {
    const api = gateway();
    api.connectServer.mockRejectedValueOnce(new Error("SSH unavailable"));
    const h = await render(api);
    await act(async () => {
      expect(await h.current().connect(saved)).toBeNull();
    });
    expect(h.current().error).toBe("SSH unavailable");
    expect(h.current().status).toBe("error");
    await act(async () => {
      await h.current().connect(saved);
    });
    expect(h.current().error).toBeNull();
    expect(h.current().servers).toEqual([connected]);
  });
});
