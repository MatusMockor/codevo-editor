// @vitest-environment jsdom
import { act, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentProjectDescriptor } from "../domain/agentProject";
import { groupedEnvironmentProjects } from "../components/agentMode/agentEnvironmentProjects";
import { agentProjectGroups } from "../components/agentMode/agentModePresentation";
import { projectFixture } from "../components/agentMode/agentThreadsSurfaceTestFixtures";
import { LOCAL_REPOSITORY_IDENTITY_LOOKUP_TIMEOUT_MS } from "./projectRepositoryIdentityDiscovery";
import { RemoteRepositoryIdentityCoordinator } from "./remoteRepositoryIdentityCoordinator";
import { REPOSITORY_IDENTITY_RETRY_DELAYS_MS } from "./repositoryIdentityRetry";
import {
  deferred,
  manualIdentityTimers,
  recordingRemoteIdentityGateway,
} from "../test/repositoryIdentityTestSupport";
import type { RepositoryIdentityTimers } from "./repositoryIdentityRetry";
import type { RepositoryIdentityGateway } from "./repositoryIdentityGateway";
import type { RemoteRepositoryIdentityGateway } from "../domain/remoteRepositoryIdentity";
import {
  useProjectRepositoryIdentities,
  useRepositoryIdentityOutcomes,
} from "./useProjectRepositoryIdentities";

function useProjectRepositoryIdentityOutcomes(
  projects: readonly AgentProjectDescriptor[],
  local: RepositoryIdentityGateway | null,
  remote: RemoteRepositoryIdentityGateway | null,
  timers: RepositoryIdentityTimers,
) {
  return useRepositoryIdentityOutcomes(
    projects.map((project) => ({
      key: project.rootKey,
      root: project.rootPath,
      authority: "test",
    })),
    local,
    remote,
    timers,
  );
}

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const disposers: (() => void)[] = [];
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
  vi.useRealTimers();
});
function renderHook<T, P = undefined>(
  callback: (props: P) => T,
  options?: { initialProps: P; strict?: boolean },
) {
  const root = createRoot(document.createElement("div"));
  const result = { current: undefined as T, renders: 0, seen: [] as T[] };
  function Harness({ value }: { value: P }) {
    result.renders += 1;
    result.current = callback(value);
    result.seen.push(result.current);
    return null;
  }
  const wrapped = (node: ReactNode) =>
    options?.strict === true ? <StrictMode>{node}</StrictMode> : node;
  const rerender = (value: P) => {
    act(() => {
      root.render(wrapped(<Harness value={value} />));
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
async function settle() {
  await act(async () => {
    for (let round = 0; round < 20; round += 1) await Promise.resolve();
  });
}

const EDITOR = "github.com/acme/editor";
const localProject = projectFixture();
const remoteProject = projectFixture({
  rootKey: "remote:linux:runner:project",
  rootPath: "remote:linux:runner:project",
});
const localAt = (root: string, overrides: Partial<AgentProjectDescriptor> = {}) =>
  projectFixture({ rootKey: root, rootPath: root, ...overrides });

describe("repository identity discovery", () => {
  it("discovers local and exact remote members, without reloading on unrelated activity", async () => {
    const local = { discover: vi.fn().mockResolvedValue(EDITOR) };
    const remote = { discover: vi.fn().mockResolvedValue(EDITOR) };
    const { result, rerender } = renderHook(
      ({ projects }) => useProjectRepositoryIdentities(projects, local, remote),
      { initialProps: { projects: [localProject, remoteProject] } },
    );
    await settle();
    expect(result.current.size).toBe(2);
    expect(remote.discover).toHaveBeenCalledWith({
      serverId: "linux",
      runnerId: "runner",
      projectId: "project",
    });
    const published = result.current;
    rerender({ projects: [{ ...localProject, label: "Renamed" }, { ...remoteProject }] });
    await settle();
    expect(result.current).toBe(published);
    expect(local.discover).toHaveBeenCalledTimes(1);
    expect(remote.discover).toHaveBeenCalledTimes(1);
  });

  it("retries a failed lookup with backoff until it succeeds", async () => {
    const retries = manualIdentityTimers();
    const local = {
      discover: vi
        .fn()
        .mockRejectedValueOnce(new Error("Project is not registered."))
        .mockRejectedValueOnce(new Error("Repository discovery is busy."))
        .mockResolvedValue(EDITOR),
    };
    const { result } = renderHook(() =>
      useProjectRepositoryIdentityOutcomes([localProject], local, null, retries.timers),
    );
    await settle();
    expect(result.current.get(localProject.rootKey)).toEqual({ kind: "failed", retrying: true });
    expect(retries.pendingDelays()).toEqual([REPOSITORY_IDENTITY_RETRY_DELAYS_MS[0]]);
    act(() => retries.advance(REPOSITORY_IDENTITY_RETRY_DELAYS_MS[0]! - 1));
    await settle();
    expect(local.discover).toHaveBeenCalledTimes(1);
    act(() => retries.advance(1));
    await settle();
    expect(result.current.get(localProject.rootKey)).toEqual({ kind: "failed", retrying: true });
    expect(retries.pendingDelays()).toEqual([REPOSITORY_IDENTITY_RETRY_DELAYS_MS[1]]);
    act(() => retries.advance(REPOSITORY_IDENTITY_RETRY_DELAYS_MS[1]!));
    await settle();
    expect(result.current.get(localProject.rootKey)).toEqual({
      kind: "identity",
      identity: EDITOR,
    });
    expect(local.discover).toHaveBeenCalledTimes(3);
    expect(retries.pendingCount()).toBe(0);
  });

  it("keeps a failed lookup distinguishable from a repository without an origin", async () => {
    const retries = manualIdentityTimers();
    const local = {
      discover: vi.fn((root: string) =>
        root === "/failing" ? Promise.reject(new Error("busy")) : Promise.resolve(null),
      ),
    };
    const projects = [localAt("/failing"), localAt("/no-origin")];
    const outcomes = renderHook(() =>
      useProjectRepositoryIdentityOutcomes(projects, local, null, retries.timers),
    );
    const identities = renderHook(() =>
      useProjectRepositoryIdentities(projects, local, null, retries.timers),
    );
    await settle();
    expect(outcomes.result.current.get("/no-origin")).toEqual({ kind: "none" });
    expect(outcomes.result.current.get("/failing")).toEqual({ kind: "failed", retrying: true });
    expect(identities.result.current.size).toBe(0);
  });

  it("stops after a bounded number of attempts and reports the lookup as failed", async () => {
    const retries = manualIdentityTimers();
    const local = { discover: vi.fn().mockRejectedValue(new Error("busy")) };
    const { result } = renderHook(() =>
      useProjectRepositoryIdentityOutcomes([localProject], local, null, retries.timers),
    );
    await settle();
    for (let round = 0; round < REPOSITORY_IDENTITY_RETRY_DELAYS_MS.length + 3; round += 1) {
      act(() => retries.advance(60_000));
      await settle();
    }
    expect(local.discover).toHaveBeenCalledTimes(REPOSITORY_IDENTITY_RETRY_DELAYS_MS.length + 1);
    expect(retries.pendingCount()).toBe(0);
    expect(result.current.get(localProject.rootKey)).toEqual({ kind: "failed", retrying: false });
  });

  it("does not retry an exhausted lookup because an unrelated project changed", async () => {
    const retries = manualIdentityTimers();
    const local = {
      discover: vi.fn((root: string) =>
        root === "/failing" ? Promise.reject(new Error("busy")) : Promise.resolve(EDITOR),
      ),
    };
    const { result, rerender } = renderHook(
      ({ projects }) => useProjectRepositoryIdentityOutcomes(projects, local, null, retries.timers),
      { initialProps: { projects: [localAt("/failing")] } },
    );
    await settle();
    for (let round = 0; round < REPOSITORY_IDENTITY_RETRY_DELAYS_MS.length; round += 1) {
      act(() => retries.advance(60_000));
      await settle();
    }
    expect(result.current.get("/failing")).toEqual({ kind: "failed", retrying: false });
    const attempts = local.discover.mock.calls.length;
    rerender({ projects: [localAt("/failing"), localAt("/added")] });
    await settle();
    act(() => retries.advance(60_000));
    await settle();
    expect(local.discover).toHaveBeenCalledTimes(attempts + 1);
    expect(result.current.get("/failing")).toEqual({ kind: "failed", retrying: false });
    expect(result.current.get("/added")).toEqual({ kind: "identity", identity: EDITOR });
    expect(retries.pendingCount()).toBe(0);
  });

  it("drops an exhausted failure as soon as its target is removed and returns", async () => {
    const retries = manualIdentityTimers();
    const local = { discover: vi.fn().mockRejectedValue(new Error("busy")) };
    const { result, rerender } = renderHook(
      ({ projects }) => useProjectRepositoryIdentityOutcomes(projects, local, null, retries.timers),
      { initialProps: { projects: [localAt("/x")] } },
    );
    await settle();
    for (let round = 0; round < REPOSITORY_IDENTITY_RETRY_DELAYS_MS.length; round += 1) {
      act(() => retries.advance(60_000));
      await settle();
    }
    expect(result.current.get("/x")).toEqual({ kind: "failed", retrying: false });
    const attempts = local.discover.mock.calls.length;
    const pending = deferred<string | null>();
    local.discover.mockReturnValueOnce(pending.promise);
    rerender({ projects: [] });
    rerender({ projects: [localAt("/x")] });
    expect(result.current.size).toBe(0);
    expect(local.discover).toHaveBeenCalledTimes(attempts + 1);
    await act(async () => {
      pending.resolve(EDITOR);
    });
    await settle();
    expect(result.current.get("/x")).toEqual({ kind: "identity", identity: EDITOR });
  });

  it("does not republish an identity for a target that left while another was pending", async () => {
    const pendingB = deferred<string | null>();
    const pendingA = deferred<string | null>();
    const local = {
      discover: vi
        .fn()
        .mockResolvedValueOnce("github.com/acme/a1")
        .mockReturnValueOnce(pendingB.promise)
        .mockReturnValueOnce(pendingA.promise),
    };
    const { result, rerender } = renderHook(
      ({ project }) => useProjectRepositoryIdentities([project], local, null),
      { initialProps: { project: localAt("/a") } },
    );
    await settle();
    expect(result.current.get("/a")).toBe("github.com/acme/a1");
    rerender({ project: localAt("/b") });
    await settle();
    expect(result.current.size).toBe(0);
    rerender({ project: localAt("/a") });
    expect(result.current.size).toBe(0);
    await settle();
    expect(result.current.size).toBe(0);
    expect(local.discover).toHaveBeenCalledTimes(3);
    await act(async () => {
      pendingA.resolve("github.com/acme/a2");
    });
    await settle();
    expect([...result.current]).toEqual([["/a", "github.com/acme/a2"]]);
  });

  it("keeps the remaining backoff when an unrelated project is added", async () => {
    const retries = manualIdentityTimers();
    const local = {
      discover: vi.fn((root: string) =>
        root === "/failing" ? Promise.reject(new Error("busy")) : Promise.resolve(EDITOR),
      ),
    };
    const failing = () => local.discover.mock.calls.filter(([root]) => root === "/failing").length;
    const { rerender } = renderHook(
      ({ projects }) => useProjectRepositoryIdentityOutcomes(projects, local, null, retries.timers),
      { initialProps: { projects: [localAt("/failing")] } },
    );
    await settle();
    act(() => retries.advance(400));
    for (let round = 0; round < 10; round += 1) {
      rerender({ projects: [localAt("/failing"), localAt(`/other${round}`)] });
      await settle();
    }
    expect(failing()).toBe(1);
    expect(retries.pendingDelays()).toEqual([REPOSITORY_IDENTITY_RETRY_DELAYS_MS[0]! - 400]);
    act(() => retries.advance(REPOSITORY_IDENTITY_RETRY_DELAYS_MS[0]! - 400));
    await settle();
    expect(failing()).toBe(2);
  });

  it("keeps the identity map reference while only failures and pending targets change", async () => {
    const retries = manualIdentityTimers();
    const local = {
      discover: vi.fn((root: string) =>
        root === "/failing" ? Promise.reject(new Error("busy")) : Promise.resolve(EDITOR),
      ),
    };
    const { result, rerender } = renderHook(
      ({ projects }) => useProjectRepositoryIdentities(projects, local, null, retries.timers),
      { initialProps: { projects: [localAt("/kept"), localAt("/failing")] } },
    );
    await settle();
    const identities = result.current;
    const renders = result.renders;
    expect([...identities]).toEqual([["/kept", EDITOR]]);
    for (let round = 0; round < REPOSITORY_IDENTITY_RETRY_DELAYS_MS.length; round += 1) {
      act(() => retries.advance(60_000));
      await settle();
    }
    expect(local.discover).toHaveBeenCalledTimes(REPOSITORY_IDENTITY_RETRY_DELAYS_MS.length + 2);
    expect(result.current).toBe(identities);
    expect(result.renders).toBe(renders);
    rerender({ projects: [localAt("/failing"), localAt("/kept")] });
    await settle();
    expect(result.current).toBe(identities);
  });

  it("runs one lookup per target under StrictMode and still publishes and retries", async () => {
    const retries = manualIdentityTimers();
    const local = {
      discover: vi.fn((root: string) =>
        root === "/failing" ? Promise.reject(new Error("busy")) : Promise.resolve(EDITOR),
      ),
    };
    const projects = [localAt("/ok"), localAt("/failing")];
    const { result, unmount } = renderHook(
      () => useProjectRepositoryIdentityOutcomes(projects, local, null, retries.timers),
      { initialProps: undefined, strict: true },
    );
    await settle();
    expect(local.discover.mock.calls.map(([root]) => root)).toEqual(["/ok", "/failing"]);
    expect(result.current.get("/ok")).toEqual({ kind: "identity", identity: EDITOR });
    expect(result.current.get("/failing")).toEqual({ kind: "failed", retrying: true });
    expect(retries.pendingDelays()).toEqual([REPOSITORY_IDENTITY_RETRY_DELAYS_MS[0]]);
    unmount();
    expect(retries.pendingCount()).toBe(0);
  });

  it("cancels pending retries when the pass is replaced or unmounted", async () => {
    const retries = manualIdentityTimers();
    const local = { discover: vi.fn().mockRejectedValue(new Error("busy")) };
    const { rerender, unmount } = renderHook(
      ({ projects }) => useProjectRepositoryIdentityOutcomes(projects, local, null, retries.timers),
      { initialProps: { projects: [localAt("/first")] } },
    );
    await settle();
    expect(retries.pendingDelays()).toEqual([REPOSITORY_IDENTITY_RETRY_DELAYS_MS[0]]);
    rerender({ projects: [localAt("/second")] });
    expect(retries.pendingDelays()).toEqual([LOCAL_REPOSITORY_IDENTITY_LOOKUP_TIMEOUT_MS]);
    await settle();
    expect(retries.pendingDelays()).toEqual([REPOSITORY_IDENTITY_RETRY_DELAYS_MS[0]]);
    expect(local.discover.mock.calls.map(([root]) => root)).toEqual(["/first", "/second"]);
    unmount();
    expect(retries.pendingCount()).toBe(0);
    await settle();
    expect(local.discover).toHaveBeenCalledTimes(2);
  });

  it("does not schedule a retry for a lookup that fails after its target was replaced", async () => {
    const retries = manualIdentityTimers();
    const stale = deferred<string | null>();
    const local = {
      discover: vi.fn().mockReturnValueOnce(stale.promise).mockResolvedValue(EDITOR),
    };
    const { result, rerender } = renderHook(
      ({ projects }) => useProjectRepositoryIdentityOutcomes(projects, local, null, retries.timers),
      { initialProps: { projects: [localAt("/first")] } },
    );
    rerender({ projects: [localAt("/second")] });
    await act(async () => {
      stale.reject(new Error("busy"));
    });
    await settle();
    expect(retries.pendingCount()).toBe(0);
    expect([...result.current]).toEqual([["/second", { kind: "identity", identity: EDITOR }]]);
  });

  it("leaves no timer behind with the default scheduler", async () => {
    vi.useFakeTimers();
    const local = {
      discover: vi.fn().mockRejectedValueOnce(new Error("busy")).mockResolvedValue(EDITOR),
    };
    const first = renderHook(() => useProjectRepositoryIdentities([localProject], local, null));
    await settle();
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REPOSITORY_IDENTITY_RETRY_DELAYS_MS[0]!);
    });
    expect(first.result.current.get(localProject.rootKey)).toBe(EDITOR);
    expect(vi.getTimerCount()).toBe(0);
    const failing = { discover: vi.fn().mockRejectedValue(new Error("busy")) };
    const second = renderHook(() => useProjectRepositoryIdentities([localProject], failing, null));
    await settle();
    expect(vi.getTimerCount()).toBe(1);
    second.unmount();
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(failing.discover).toHaveBeenCalledTimes(1);
  });

  it("keeps unchanged targets published and unrequested when the signature changes", async () => {
    const local = { discover: vi.fn((root: string) => Promise.resolve(`github.com/acme${root}`)) };
    const kept = localAt("/kept");
    const { result, rerender } = renderHook(
      ({ projects }) => useProjectRepositoryIdentities(projects, local, null),
      { initialProps: { projects: [kept] } },
    );
    await settle();
    expect(result.current.get("/kept")).toBe("github.com/acme/kept");
    rerender({ projects: [kept, localAt("/added")] });
    expect(result.current.get("/kept")).toBe("github.com/acme/kept");
    await settle();
    expect(result.current.get("/added")).toBe("github.com/acme/added");
    expect(local.discover.mock.calls.map(([root]) => root)).toEqual(["/kept", "/added"]);
    rerender({ projects: [kept] });
    expect([...result.current]).toEqual([["/kept", "github.com/acme/kept"]]);
    await settle();
    expect(local.discover).toHaveBeenCalledTimes(2);
  });

  it("invalidates only the target whose authority changed", async () => {
    const pending = deferred<string | null>();
    const local = {
      discover: vi
        .fn()
        .mockResolvedValueOnce("github.com/acme/stable")
        .mockResolvedValueOnce("github.com/acme/before")
        .mockReturnValueOnce(pending.promise),
    };
    const stable = localAt("/stable");
    const changing = localAt("/changing");
    const { result, rerender } = renderHook(
      ({ projects }) => useProjectRepositoryIdentities(projects, local, null),
      { initialProps: { projects: [stable, changing] } },
    );
    await settle();
    expect(result.current.size).toBe(2);
    const rendered = result.seen.length;
    rerender({ projects: [stable, { ...changing, ownerId: "replacement" }] });
    expect(result.seen.slice(rendered).map((identities) => [...identities.keys()])).toContainEqual([
      "/stable",
    ]);
    expect(result.seen.slice(rendered).every((identities) => !identities.has("/changing"))).toBe(
      true,
    );
    expect([...result.current]).toEqual([["/stable", "github.com/acme/stable"]]);
    await settle();
    expect(local.discover).toHaveBeenCalledTimes(3);
    expect(local.discover).toHaveBeenLastCalledWith("/changing");
    await act(async () => {
      pending.resolve("github.com/acme/after");
    });
    expect(result.current.get("/changing")).toBe("github.com/acme/after");
    expect(result.current.get("/stable")).toBe("github.com/acme/stable");
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
      { initialProps: { project: localProject } },
    );
    rerender({ project: { ...localProject, rootKey: "/other", rootPath: "/other" } });
    rerender({ project: { ...localProject, generation: localProject.generation + 1 } });
    await act(async () => {
      first.resolve("old");
      second.resolve("foreign");
    });
    await settle();
    expect(result.current.size).toBe(0);
    expect(local.discover).toHaveBeenCalledTimes(3);
    await act(async () => {
      third.resolve("current");
    });
    expect(result.current.get(localProject.rootKey)).toBe("current");
  });

  it("does not republish a result once its workspace was replaced and restored", async () => {
    const first = deferred<string | null>();
    const local = {
      discover: vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue("github.com/acme/b"),
    };
    const { result, rerender } = renderHook(
      ({ project }) => useProjectRepositoryIdentities([project], local, null),
      { initialProps: { project: localAt("/a") } },
    );
    rerender({ project: localAt("/b") });
    await settle();
    expect([...result.current]).toEqual([["/b", "github.com/acme/b"]]);
    const restored = deferred<string | null>();
    local.discover.mockReturnValueOnce(restored.promise);
    rerender({ project: localAt("/a") });
    await act(async () => {
      first.resolve("github.com/acme/stale-a");
    });
    await settle();
    expect(result.current.size).toBe(0);
    await act(async () => {
      restored.resolve("github.com/acme/a");
    });
    expect([...result.current]).toEqual([["/a", "github.com/acme/a"]]);
  });

  it("drops every result when the gateways are replaced", async () => {
    const before = { discover: vi.fn().mockResolvedValue("github.com/acme/before") };
    const after = { discover: vi.fn().mockResolvedValue("github.com/acme/after") };
    const { result, rerender } = renderHook(
      ({ local }) => useProjectRepositoryIdentities([localProject], local, null),
      { initialProps: { local: before } },
    );
    await settle();
    expect(result.current.get(localProject.rootKey)).toBe("github.com/acme/before");
    const rendered = result.seen.length;
    rerender({ local: after });
    expect(result.seen.slice(rendered).map((identities) => identities.size)).toContain(0);
    expect(result.seen.slice(rendered).every((identities) => identities.size === 0)).toBe(true);
    expect(result.current.size).toBe(0);
    await settle();
    expect(result.current.get(localProject.rootKey)).toBe("github.com/acme/after");
  });

  it("marks unaddressable remote members unavailable without asking the server", async () => {
    const retries = manualIdentityTimers();
    const remote = { discover: vi.fn().mockRejectedValue(new Error("offline")) };
    const { result } = renderHook(() =>
      useProjectRepositoryIdentityOutcomes(
        [
          remoteProject,
          { ...remoteProject, rootKey: "remote:%6cinux:runner:project" },
          { ...remoteProject, rootKey: "remote:%ZZ:runner:project" },
          localProject,
        ],
        null,
        remote,
        retries.timers,
      ),
    );
    await settle();
    expect(remote.discover).toHaveBeenCalledTimes(1);
    expect(result.current.get(remoteProject.rootKey)).toEqual({ kind: "failed", retrying: true });
    expect(result.current.get("remote:%6cinux:runner:project")).toEqual({ kind: "unavailable" });
    expect(result.current.get("remote:%ZZ:runner:project")).toEqual({ kind: "unavailable" });
    expect(result.current.get(localProject.rootKey)).toEqual({ kind: "unavailable" });
    expect(retries.pendingCount()).toBe(1);
  });

  it("frees the permits of dropped projects at once and never publishes their late results", async () => {
    const held = Array.from({ length: 2 }, () => deferred<string | null>());
    const local = {
      discover: vi.fn((root: string) =>
        root.startsWith("/old") ? held[Number(root.slice(4))]!.promise : Promise.resolve(EDITOR),
      ),
    };
    const old = held.map((_, i) => localAt(`/old${i}`));
    const { result, rerender } = renderHook(
      ({ projects }) => useProjectRepositoryIdentities(projects, local, null),
      { initialProps: { projects: old } },
    );
    expect(local.discover).toHaveBeenCalledTimes(2);
    rerender({ projects: [localProject] });
    expect(local.discover).toHaveBeenCalledTimes(3);
    await settle();
    expect(result.current.get(localProject.rootKey)).toBe(EDITOR);
    await act(async () => {
      held.forEach((item) => item.resolve("stale"));
    });
    await settle();
    expect([...result.current.values()]).toEqual([EDITOR]);
    expect(local.discover).toHaveBeenCalledTimes(3);
  });

  it("discovers every remote project without exceeding the runner two-request limit", async () => {
    const recorded = recordingRemoteIdentityGateway(() => Promise.resolve(EDITOR));
    const projects = Array.from({ length: 8 }, (_, i) => ({
      ...remoteProject,
      rootKey: `remote:linux:runner:project${i}`,
    }));
    const { result } = renderHook(() =>
      useProjectRepositoryIdentities(projects, null, recorded.gateway),
    );
    await settle();
    await settle();
    expect(result.current.size).toBe(8);
    expect(recorded.maximumPerServer()).toBeLessThanOrEqual(2);
  });

  it("bounds discovery concurrency and abandons queued work on unmount", async () => {
    const requests = Array.from({ length: 2 }, () => deferred<string | null>());
    const local = { discover: vi.fn((root: string) => requests[Number(root.slice(1))]!.promise) };
    const projects = Array.from({ length: 100 }, (_, i) => localAt(`/${i}`));
    const { unmount } = renderHook(() => useProjectRepositoryIdentities(projects, local, null));
    expect(local.discover).toHaveBeenCalledTimes(2);
    unmount();
    await act(async () => {
      requests.forEach((request) => request.resolve("identity"));
    });
    await settle();
    expect(local.discover).toHaveBeenCalledTimes(2);
  });

  it("merges the local and server checkout after one transient busy response", async () => {
    const retries = manualIdentityTimers();
    const repository = "github.com/acme/codevo-editor";
    const remoteKey = "remote:linux-box:runner-1:codevo-editor";
    const projects = [
      localAt("/Users/x/Developer/editor", { label: "editor" }),
      projectFixture({
        rootKey: remoteKey,
        rootPath: remoteKey,
        ownerId: remoteKey,
        label: "codevo-editor",
        origin: "background-tab",
        repositories: [
          {
            repositoryRoot: remoteKey,
            repositoryRelativePath: "",
            mapping: { rootRelativePath: "" },
          },
        ],
      }),
    ];
    const groups = agentProjectGroups(projects, [], []);
    const local = { discover: vi.fn().mockResolvedValue(repository) };
    const runner = recordingRemoteIdentityGateway((_, call) =>
      call === 1 ? Promise.reject(new Error("HTTP 503 busy")) : Promise.resolve(repository),
    );
    const remote = new RemoteRepositoryIdentityCoordinator(runner.gateway, retries.timers);
    const identities = renderHook(() =>
      useProjectRepositoryIdentities(projects, local, remote, retries.timers),
    );
    const outcomes = renderHook(() =>
      useProjectRepositoryIdentityOutcomes(projects, local, remote, retries.timers),
    );
    await settle();
    const split = groupedEnvironmentProjects(
      groups,
      projects,
      new Map(),
      identities.result.current,
    );
    expect(split.map((group) => group.projectRootKey)).toEqual([
      "/Users/x/Developer/editor",
      remoteKey,
    ]);
    expect(outcomes.result.current.get(remoteKey)).toEqual({ kind: "failed", retrying: true });
    expect(runner.requests).toHaveLength(1);
    act(() => retries.advance(REPOSITORY_IDENTITY_RETRY_DELAYS_MS[0]!));
    await settle();
    const merged = groupedEnvironmentProjects(
      groups,
      projects,
      new Map(),
      identities.result.current,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]!.projectRootKey).toBe("/Users/x/Developer/editor");
    expect(merged[0]!.memberProjectRootKeys).toEqual(["/Users/x/Developer/editor", remoteKey]);
    expect(runner.requests).toHaveLength(2);
    expect(runner.maximumPerServer()).toBeLessThanOrEqual(2);
  });
});
