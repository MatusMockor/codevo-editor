// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RemoteRunnerDescriptor } from "../../domain/remoteRunner";
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
