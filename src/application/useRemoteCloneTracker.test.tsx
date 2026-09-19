// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  REMOTE_CLONE_TRACKER_LIMIT,
  useRemoteCloneTracker,
  type RemoteCloneTracker,
} from "./useRemoteCloneTracker";

const workspace = (serverId: string | null, workspaceOwner: string | null = "workspace-1") => ({
  workspaceOwner,
  serverId,
});

let dispose: () => void = () => undefined;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});

afterEach(() => {
  dispose();
});

function setup() {
  const root = createRoot(document.createElement("div"));
  let result!: RemoteCloneTracker;
  const seen: RemoteCloneTracker[] = [];
  function Harness() {
    result = useRemoteCloneTracker();
    seen.push(result);
    return null;
  }
  const render = () => act(() => root.render(<Harness />));
  render();
  dispose = () => {
    dispose = () => undefined;
    act(() => root.unmount());
  };
  return {
    render,
    seen,
    get result() {
      return result;
    },
  };
}

it("keeps one entry per server and survives re-renders", () => {
  const view = setup();
  view.result.remember(workspace("server-a"), { cloneId: "clone-1", name: "storefront" });
  view.render();
  expect(view.result.find(workspace("server-a"))).toEqual({
    cloneId: "clone-1",
    name: "storefront",
  });
  expect(view.seen[0]).toBe(view.seen[1]);
  view.result.remember(workspace("server-a"), { cloneId: "clone-2", name: "billing" });
  expect(view.result.find(workspace("server-a"))).toEqual({ cloneId: "clone-2", name: "billing" });
  expect(view.result.size()).toBe(1);
});

it("returns nothing for an untracked or unknown server", () => {
  const view = setup();
  expect(view.result.find(workspace(null))).toBeNull();
  expect(view.result.find(workspace("server-x"))).toBeNull();
});

it("forgets a dismissed server", () => {
  const view = setup();
  view.result.remember(workspace("server-a"), { cloneId: "clone-1", name: "storefront" });
  view.result.forget(workspace("server-a"));
  view.result.forget(workspace("server-a"));
  expect(view.result.find(workspace("server-a"))).toBeNull();
  expect(view.result.size()).toBe(0);
});

it("evicts the oldest server beyond the bound", () => {
  const view = setup();
  for (let index = 0; index < REMOTE_CLONE_TRACKER_LIMIT + 2; index += 1) {
    view.result.remember(workspace(`server-${index}`), {
      cloneId: `clone-${index}`,
      name: `name-${index}`,
    });
  }
  expect(view.result.size()).toBe(REMOTE_CLONE_TRACKER_LIMIT);
  expect(view.result.find(workspace("server-0"))).toBeNull();
  expect(view.result.find(workspace("server-1"))).toBeNull();
  expect(view.result.find(workspace("server-2"))).toEqual({ cloneId: "clone-2", name: "name-2" });
});

it("refreshes recency so an updated server is not evicted first", () => {
  const view = setup();
  for (let index = 0; index < REMOTE_CLONE_TRACKER_LIMIT; index += 1) {
    view.result.remember(workspace(`server-${index}`), {
      cloneId: `clone-${index}`,
      name: `name-${index}`,
    });
  }
  view.result.remember(workspace("server-0"), { cloneId: "clone-0b", name: "name-0b" });
  view.result.remember(workspace("server-new"), { cloneId: "clone-new", name: "name-new" });
  expect(view.result.find(workspace("server-0"))).toEqual({ cloneId: "clone-0b", name: "name-0b" });
  expect(view.result.find(workspace("server-1"))).toBeNull();
});

it("isolates the same server across two workspace tabs", () => {
  const view = setup();
  view.result.remember(workspace("server-a", "workspace-1"), {
    cloneId: "clone-1",
    name: "storefront",
  });
  expect(view.result.find(workspace("server-a", "workspace-2"))).toBeNull();
  expect(view.result.find(workspace("server-a", "workspace-1"))).toEqual({
    cloneId: "clone-1",
    name: "storefront",
  });
  view.result.forget(workspace("server-a", "workspace-2"));
  expect(view.result.find(workspace("server-a", "workspace-1"))).not.toBeNull();
});
