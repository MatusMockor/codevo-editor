// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RemoteRepositoryIdentityGateway } from "../../domain/remoteRepositoryIdentity";
import type { RemoteRunnerDescriptor } from "../../domain/remoteRunner";
import { RemoteRepositoryIdentityCoordinator } from "../../application/remoteRepositoryIdentityCoordinator";
import { REPOSITORY_IDENTITY_RETRY_DELAYS_MS } from "../../application/repositoryIdentityRetry";
import { manualIdentityTimers } from "../../test/repositoryIdentityTestSupport";
import {
  readRemoteProjectLinks,
  saveRemoteProjectLink,
} from "../../application/remoteProjectLinks";
import { projectFixture } from "../agentMode/agentThreadsSurfaceTestFixtures";
import { RemoteProjectLinksSettings } from "./RemoteProjectLinksSettings";

let host: HTMLDivElement;
let root: Root;
const descriptor: RemoteRunnerDescriptor = {
  protocolVersion: 1,
  runnerId: "runner",
  name: "Runner",
  capabilities: { taskExecution: true, eventReplay: true },
};
const local = {
  ...projectFixture(),
  rootKey: "/local",
  rootPath: "/local",
  trust: "trusted" as const,
};
const gateway = () => ({
  getRunner: vi.fn(async () => descriptor),
  listProjects: vi.fn(async () => ({ items: [{ id: "project", name: "Server app" }] })),
});
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));
async function expand() {
  await act(async () => {
    const details = host.querySelector("details")!;
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
  });
}
it("loads only expanded settings and allows choosing and clearing a stale local project", async () => {
  const api = gateway();
  const render = (projects = [local]) =>
    act(() =>
      root.render(
        <RemoteProjectLinksSettings
          gateway={api}
          serverId="server"
          connected
          projects={projects}
          identity={null}
        />,
      ),
    );
  render();
  expect(api.getRunner).not.toHaveBeenCalled();
  expect(host.querySelector("select")).toBeNull();
  await expand();
  expect(api.getRunner).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("Server app");
  act(() => {
    const select = host.querySelector("select")!;
    select.value = "/local";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(readRemoteProjectLinks().get("remote:server:runner:project")).toBe("/local");
  render([]);
  expect(host.textContent).toContain("reopen local project");
  act(() => {
    const select = host.querySelector("select")!;
    select.value = "";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(readRemoteProjectLinks().get("remote:server:runner:project")).toBeUndefined();
});
it("ignores late inventory from the previous server and never exposes its mapping", async () => {
  let resolve!: (value: RemoteRunnerDescriptor) => void;
  const api = gateway();
  api.getRunner.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  saveRemoteProjectLink("remote:first:runner:project", "/local");
  const render = (serverId: string) =>
    act(() =>
      root.render(
        <RemoteProjectLinksSettings
          gateway={api}
          serverId={serverId}
          connected
          projects={[local]}
          identity={null}
        />,
      ),
    );
  render("first");
  await expand();
  expect(host.textContent).toContain("Loading");
  await act(async () => render("second"));
  expect(host.querySelector("select")?.value).toBe("");
  await act(async () => resolve({ ...descriptor, runnerId: "old-runner" }));
  expect(host.querySelector("select")?.value).toBe("");
  expect(host.textContent).not.toContain("old-runner");
});
it("does not load a disconnected server", async () => {
  const api = gateway();
  act(() =>
    root.render(
      <RemoteProjectLinksSettings
        gateway={api}
        serverId="server"
        connected={false}
        projects={[local]}
        identity={null}
      />,
    ),
  );
  await expand();
  expect(api.getRunner).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Connect this server");
  expect(host.querySelector("select")).toBeNull();
});

it("keeps A → B → A inventory generations separate", async () => {
  const pending: Array<(value: RemoteRunnerDescriptor) => void> = [];
  const api = gateway();
  api.getRunner.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
  const render = (serverId: string) =>
    act(() =>
      root.render(
        <RemoteProjectLinksSettings
          gateway={api}
          serverId={serverId}
          connected
          projects={[local]}
          identity={null}
        />,
      ),
    );
  render("a");
  await expand();
  render("b");
  render("a");
  await act(async () => pending[0]!({ ...descriptor, runnerId: "old-a" }));
  expect(host.querySelector("select")).toBeNull();
  await act(async () => pending[1]!({ ...descriptor, runnerId: "old-b" }));
  expect(host.querySelector("select")).toBeNull();
  await act(async () => pending[2]!({ ...descriptor, runnerId: "new-a" }));
  act(() => {
    const select = host.querySelector("select")!;
    select.value = "/local";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(readRemoteProjectLinks().get("remote:a:new-a:project")).toBe("/local");
  expect(readRemoteProjectLinks().get("remote:a:old-a:project")).toBeUndefined();
});

const RETRYING_HINT = "Could not read this project's repository yet. Retrying…";
const FAILED_HINT =
  "Could not read this project's repository. Close and reopen this section to retry.";
async function settle() {
  await act(async () => {
    for (let round = 0; round < 20; round += 1) await Promise.resolve();
  });
}
function renderWithIdentity(
  identity: RemoteRepositoryIdentityGateway,
  retries = manualIdentityTimers(),
) {
  const api = gateway();
  act(() =>
    root.render(
      <RemoteProjectLinksSettings
        gateway={api}
        serverId="server"
        connected
        projects={[local]}
        identity={identity}
        identityTimers={retries.timers}
      />,
    ),
  );
  return { api, retries };
}
const hints = () => Array.from(host.querySelectorAll("[role=status]"), (node) => node.textContent);

it("says a server project's repository could not be read yet and clears the hint on retry", async () => {
  const identity = {
    discover: vi
      .fn()
      .mockRejectedValueOnce(new Error("HTTP 503 busy at http://10.0.0.5:7777/v1/projects"))
      .mockResolvedValue("github.com/acme/app"),
  };
  const { retries } = renderWithIdentity(identity);
  expect(identity.discover).not.toHaveBeenCalled();
  await expand();
  await settle();
  expect(identity.discover).toHaveBeenCalledWith({
    serverId: "server",
    runnerId: "runner",
    projectId: "project",
  });
  expect(hints()).toEqual([RETRYING_HINT]);
  expect(host.textContent).not.toContain("503");
  expect(host.textContent).not.toContain("10.0.0.5");
  expect(retries.pendingDelays()).toEqual([REPOSITORY_IDENTITY_RETRY_DELAYS_MS[0]]);
  act(() => retries.advance(REPOSITORY_IDENTITY_RETRY_DELAYS_MS[0]!));
  await settle();
  expect(hints()).toEqual([]);
  expect(identity.discover).toHaveBeenCalledTimes(2);
});

it("stops retrying after the bounded budget and offers a manual retry by reopening", async () => {
  const identity = { discover: vi.fn().mockRejectedValue(new Error("offline")) };
  const retries = manualIdentityTimers();
  renderWithIdentity(new RemoteRepositoryIdentityCoordinator(identity, retries.timers), retries);
  await expand();
  await settle();
  for (let round = 0; round < REPOSITORY_IDENTITY_RETRY_DELAYS_MS.length + 2; round += 1) {
    act(() => retries.advance(60_000));
    await settle();
  }
  expect(hints()).toEqual([FAILED_HINT]);
  expect(identity.discover).toHaveBeenCalledTimes(REPOSITORY_IDENTITY_RETRY_DELAYS_MS.length + 1);
  expect(retries.pendingCount()).toBe(0);
  identity.discover.mockResolvedValue("github.com/acme/app");
  await act(async () => {
    const details = host.querySelector("details")!;
    details.open = false;
    details.dispatchEvent(new Event("toggle"));
  });
  await expand();
  await settle();
  expect(hints()).toEqual([]);
  expect(identity.discover).toHaveBeenCalledTimes(REPOSITORY_IDENTITY_RETRY_DELAYS_MS.length + 2);
});

it("shows no hint for a repository without an origin", async () => {
  const withoutOrigin = { discover: vi.fn().mockResolvedValue(null) };
  renderWithIdentity(withoutOrigin);
  await expand();
  await settle();
  expect(withoutOrigin.discover).toHaveBeenCalledTimes(1);
  expect(hints()).toEqual([]);
});

it("reads no repository for an explicitly connected project and drops its hint once connected", async () => {
  const api = gateway();
  api.listProjects.mockResolvedValue({
    items: [
      { id: "linked", name: "Linked app" },
      { id: "separate", name: "Separate app" },
    ],
  });
  saveRemoteProjectLink("remote:server:runner:linked", "/local");
  const identity = { discover: vi.fn().mockRejectedValue(new Error("offline")) };
  const retries = manualIdentityTimers();
  act(() =>
    root.render(
      <RemoteProjectLinksSettings
        gateway={api}
        serverId="server"
        connected
        projects={[local]}
        identity={identity}
        identityTimers={retries.timers}
      />,
    ),
  );
  await expand();
  await settle();
  expect(identity.discover.mock.calls).toEqual([
    [{ serverId: "server", runnerId: "runner", projectId: "separate" }],
  ]);
  expect(hints()).toEqual([RETRYING_HINT]);
  expect(retries.pendingDelays()).toEqual([REPOSITORY_IDENTITY_RETRY_DELAYS_MS[0]]);
  act(() => {
    const select = host.querySelectorAll("select")[1]!;
    select.value = "/local";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(hints()).toEqual([]);
  expect(retries.pendingCount()).toBe(0);
  act(() => retries.advance(60_000));
  await settle();
  expect(identity.discover).toHaveBeenCalledTimes(1);
});

it("cancels the pending identity retry when the section unmounts", async () => {
  const identity = { discover: vi.fn().mockRejectedValue(new Error("offline")) };
  const { retries } = renderWithIdentity(identity);
  await expand();
  await settle();
  expect(retries.pendingCount()).toBe(1);
  act(() => root.unmount());
  root = createRoot(host);
  expect(retries.pendingCount()).toBe(0);
});
