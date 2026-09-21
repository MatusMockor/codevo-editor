// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { projectFixture } from "../components/agentMode/agentThreadsSurfaceTestFixtures";
import { useProjectRepositoryIdentities } from "./useProjectRepositoryIdentities";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const disposers: (() => void)[] = [];
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
});
function renderHook<T, P = undefined>(callback: (props: P) => T, options?: { initialProps: P }) {
  const root = createRoot(document.createElement("div"));
  const result = { current: undefined as T };
  function Harness({ value }: { value: P }) {
    result.current = callback(value);
    return null;
  }
  const rerender = (value: P) => {
    act(() => {
      root.render(<Harness value={value} />);
    });
  };
  let mounted = true;
  const unmount = () => {
    if (mounted) {
      mounted = false;
      act(() => root.unmount());
    }
  };
  disposers.push(unmount);
  rerender(options?.initialProps as P);
  return { result, rerender, unmount };
}
async function waitFor(assertion: () => void) {
  await act(async () => {
    await Promise.resolve();
  });
  assertion();
}

const localProject = projectFixture();
const remoteProject = projectFixture({
  rootKey: "remote:linux:runner:project",
  rootPath: "remote:linux:runner:project",
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("repository identity discovery", () => {
  it("discovers local and exact remote members, without reloading on unrelated activity", async () => {
    const local = { discover: vi.fn().mockResolvedValue("github.com/acme/editor") };
    const remote = { discover: vi.fn().mockResolvedValue("github.com/acme/editor") };
    const { result, rerender } = renderHook(
      ({ projects }) => useProjectRepositoryIdentities(projects, local, remote),
      {
        initialProps: { projects: [localProject, remoteProject] },
      },
    );
    await waitFor(() => expect(result.current.size).toBe(2));
    expect(remote.discover).toHaveBeenCalledWith({
      serverId: "linux",
      runnerId: "runner",
      projectId: "project",
    });
    rerender({ projects: [{ ...localProject, label: "Renamed" }, { ...remoteProject }] });
    expect(local.discover).toHaveBeenCalledTimes(1);
    expect(remote.discover).toHaveBeenCalledTimes(1);
  });
  it("rejects A to B to A results from earlier ownership generations", async () => {
    const first = deferred<string | null>();
    const second = deferred<string | null>();
    const third = deferred<string | null>();
    const local = {
      discover: vi
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise)
        .mockReturnValueOnce(third.promise),
    };
    const { result, rerender } = renderHook(
      ({ project }) => useProjectRepositoryIdentities([project], local, null),
      {
        initialProps: { project: localProject },
      },
    );
    rerender({ project: { ...localProject, rootKey: "/other", rootPath: "/other" } });
    rerender({ project: { ...localProject, generation: localProject.generation + 1 } });
    await act(async () => {
      first.resolve("old");
      second.resolve("foreign");
    });
    expect(result.current.size).toBe(0);
    await act(async () => {
      third.resolve("current");
    });
    expect(result.current.get(localProject.rootKey)).toBe("current");
  });
  it("drops settled metadata synchronously when project authority changes", async () => {
    const pending = deferred<string | null>();
    const local = {
      discover: vi.fn().mockResolvedValueOnce("old").mockReturnValueOnce(pending.promise),
    };
    const { result, rerender } = renderHook(
      ({ project }) => useProjectRepositoryIdentities([project], local, null),
      { initialProps: { project: localProject } },
    );
    await waitFor(() => expect(result.current.size).toBe(1));
    rerender({ project: { ...localProject, ownerId: "replacement" } });
    expect(result.current.size).toBe(0);
    await act(async () => {
      pending.resolve(null);
    });
  });
  it("tolerates offline or unsupported servers and malformed remote identities", async () => {
    const remote = { discover: vi.fn().mockRejectedValue(new Error("offline")) };
    const { result } = renderHook(() =>
      useProjectRepositoryIdentities(
        [
          remoteProject,
          { ...remoteProject, rootKey: "remote:%6cinux:runner:project" },
          { ...remoteProject, rootKey: "remote:%ZZ:runner:project" },
        ],
        null,
        remote,
      ),
    );
    await waitFor(() => expect(remote.discover).toHaveBeenCalledTimes(1));
    expect(result.current.size).toBe(0);
  });
  it("shares discovery permits across replacement passes and publishes available members early", async () => {
    const held = Array.from({ length: 2 }, () => deferred<string | null>());
    const local = {
      discover: vi.fn((root: string) =>
        root.startsWith("/old")
          ? held[Number(root.slice(4))]!.promise
          : Promise.resolve("github.com/acme/editor"),
      ),
    };
    const old = held.map((_, i) => ({
      ...localProject,
      rootKey: `/old${i}`,
      rootPath: `/old${i}`,
    }));
    const { result, rerender } = renderHook(
      ({ projects }) => useProjectRepositoryIdentities(projects, local, null),
      { initialProps: { projects: old } },
    );
    rerender({ projects: [localProject] });
    expect(local.discover).toHaveBeenCalledTimes(2);
    await act(async () => {
      held[0]!.resolve("stale");
    });
    expect(local.discover).toHaveBeenCalledTimes(3);
    expect(result.current.get(localProject.rootKey)).toBe("github.com/acme/editor");
    await act(async () => {
      held.slice(1).forEach((item) => item.resolve("stale"));
    });
    expect([...result.current.values()]).toEqual(["github.com/acme/editor"]);
  });
  it("discovers every remote project without exceeding the runner two-request limit", async () => {
    let active = 0;
    let maximum = 0;
    const remote = {
      discover: vi.fn(async () => {
        active++;
        maximum = Math.max(maximum, active);
        await Promise.resolve();
        active--;
        return "github.com/acme/editor";
      }),
    };
    const projects = Array.from({ length: 8 }, (_, i) => ({
      ...remoteProject,
      rootKey: `remote:linux:runner:project${i}`,
    }));
    const { result } = renderHook(() => useProjectRepositoryIdentities(projects, null, remote));
    await waitFor(() => expect(result.current.size).toBe(8));
    expect(maximum).toBeLessThanOrEqual(2);
  });
  it("bounds discovery concurrency and abandons queued work on unmount", async () => {
    const requests = Array.from({ length: 2 }, () => deferred<string | null>());
    const local = { discover: vi.fn((root: string) => requests[Number(root.slice(1))]!.promise) };
    const projects = Array.from({ length: 100 }, (_, i) => ({
      ...localProject,
      rootKey: `/${i}`,
      rootPath: `/${i}`,
    }));
    const { unmount } = renderHook(() => useProjectRepositoryIdentities(projects, local, null));
    expect(local.discover).toHaveBeenCalledTimes(2);
    unmount();
    await act(async () => {
      requests.forEach((request) => request.resolve("identity"));
    });
    expect(local.discover).toHaveBeenCalledTimes(2);
  });
});
