// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import type { RemoteRunnerServer } from "../../domain/remoteRunner";
import { TauriRemoteRunnerGateway } from "../../infrastructure/tauriRemoteRunnerGateway";
import { RemoteRunnerContext } from "../remoteRunner/remoteRunnerContext";
import { AgentRemoteDraftProjectChooser } from "./AgentRemoteDraftProjectChooser";
import { projectFixture } from "./agentThreadsSurfaceTestFixtures";
const LINUX: RemoteRunnerServer = {
  id: "srv-7f3a",
  name: "Linux box",
  host: "linux.internal",
  username: "dev",
  port: 22,
  connected: true,
};
const ADD_LABEL = "Add project or clone repository";
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));
function serverProject(name: string, label = name): AgentProjectDescriptor {
  const rootKey = `remote:linux:runner:${name}`;
  return projectFixture({ rootKey, rootPath: rootKey, label });
}
function serverProjects(count: number): AgentProjectDescriptor[] {
  return Array.from({ length: count }, (_, index) => serverProject(`project-${index}`));
}
function withSelectedServer(selectedServerId: string, node: ReactNode): ReactNode {
  return (
    <RemoteRunnerContext.Provider
      value={{
        gateway: new TauriRemoteRunnerGateway(vi.fn()),
        servers: [LINUX],
        status: "ready",
        error: null,
        selectedServerId,
        selectServer: vi.fn(),
        refresh: vi.fn(),
        connect: vi.fn(),
        disconnect: vi.fn(),
        remove: vi.fn(),
      }}
    >
      {node}
    </RemoteRunnerContext.Provider>
  );
}
function rows(): HTMLButtonElement[] {
  return [...host.querySelectorAll<HTMLButtonElement>('ul[aria-label="Server projects"] button')];
}
function rowLabels(): (string | null)[] {
  return rows().map((row) => row.querySelector("strong")?.textContent ?? null);
}
function filterField(): HTMLInputElement | null {
  return host.querySelector<HTMLInputElement>('input[aria-label="Filter server projects"]');
}
function addButton(): HTMLButtonElement | undefined {
  return [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent === ADD_LABEL,
  );
}
function typeFilter(value: string): void {
  const field = filterField();
  expect(field).not.toBeNull();
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(field, value);
    field?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("offers no untrusted or closed tab project and keeps the add action in the empty state", () => {
  const add = vi.fn();
  const select = vi.fn();
  act(() =>
    root.render(
      <AgentRemoteDraftProjectChooser
        projects={[
          projectFixture({ trust: "untrusted" }),
          projectFixture({ origin: "closed-tab-live-tasks" }),
        ]}
        onSelect={select}
        onAddProject={add}
      />,
    ),
  );
  expect(host.querySelector('section[aria-label="Choose server project"]')).not.toBeNull();
  expect(rows()).toEqual([]);
  expect(filterField()).toBeNull();
  expect(host.textContent).toContain("No projects on this server yet.");
  expect(host.textContent).not.toContain("Manage server projects");
  expect([...host.querySelectorAll("button")].map((button) => button.textContent)).toEqual([
    ADD_LABEL,
  ]);
  act(() => addButton()?.click());
  expect(add).toHaveBeenCalledOnce();
  expect(select).not.toHaveBeenCalled();
});
it("returns exactly the clicked descriptor once", () => {
  const projects = [serverProject("codevo-editor"), serverProject("codevo-runner")];
  const select = vi.fn();
  act(() => root.render(<AgentRemoteDraftProjectChooser projects={projects} onSelect={select} />));
  expect(host.querySelector("select")).toBeNull();
  expect(rowLabels()).toEqual(["codevo-editor", "codevo-runner"]);
  expect(rows().map((row) => [row.type, row.disabled, row.tabIndex])).toEqual([
    ["button", false, 0],
    ["button", false, 0],
  ]);
  act(() => rows()[1]?.click());
  expect(select).toHaveBeenCalledExactlyOnceWith(projects[1]);
});
it("shows the root path only on rows that share a label", () => {
  const first = serverProject("docs", "Handbook");
  const second = serverProject("docs-copy", "Handbook");
  const unique = serverProject("codevo-editor", "Flagship");
  const select = vi.fn();
  act(() =>
    root.render(
      <AgentRemoteDraftProjectChooser projects={[first, unique, second]} onSelect={select} />,
    ),
  );
  expect(rows().map((row) => row.querySelector("small")?.textContent ?? null)).toEqual([
    first.rootPath,
    null,
    second.rootPath,
  ]);
  expect(host.textContent).not.toContain(unique.rootPath);
  act(() => rows()[2]?.click());
  expect(select).toHaveBeenCalledExactlyOnceWith(second);
});
it("keeps the filter away until more than six projects are offered", () => {
  act(() =>
    root.render(<AgentRemoteDraftProjectChooser projects={serverProjects(6)} onSelect={vi.fn()} />),
  );
  expect(rows()).toHaveLength(6);
  expect(filterField()).toBeNull();
});
it("narrows the rows by label and says when nothing matches", () => {
  const projects = [...serverProjects(6), serverProject("efabrica-api", "Efabrica API")];
  const select = vi.fn();
  act(() => root.render(<AgentRemoteDraftProjectChooser projects={projects} onSelect={select} />));
  expect(rows()).toHaveLength(7);
  typeFilter("  FABRICA ");
  expect(rowLabels()).toEqual(["Efabrica API"]);
  act(() => rows()[0]?.click());
  expect(select).toHaveBeenCalledExactlyOnceWith(projects[6]);
  typeFilter("x".repeat(200));
  expect(filterField()?.value).toHaveLength(120);
  expect(rows()).toEqual([]);
  expect(host.textContent).toContain("No matching project on this server.");
  expect(host.textContent).not.toContain("No projects on this server yet.");
});
it("drops a filter that can no longer be edited", () => {
  act(() =>
    root.render(<AgentRemoteDraftProjectChooser projects={serverProjects(7)} onSelect={vi.fn()} />),
  );
  typeFilter("nothing");
  expect(rows()).toEqual([]);
  act(() =>
    root.render(<AgentRemoteDraftProjectChooser projects={serverProjects(3)} onSelect={vi.fn()} />),
  );
  expect(filterField()).toBeNull();
  expect(rows()).toHaveLength(3);
  act(() =>
    root.render(<AgentRemoteDraftProjectChooser projects={serverProjects(7)} onSelect={vi.fn()} />),
  );
  expect(filterField()?.value).toBe("");
  expect(rows()).toHaveLength(7);
});
it("reaches a same-named project beyond the row cap through its root path", () => {
  const projects = Array.from({ length: 66 }, (_, index) =>
    serverProject(`docs-${index}`, "Handbook"),
  );
  const select = vi.fn();
  act(() => root.render(<AgentRemoteDraftProjectChooser projects={projects} onSelect={select} />));
  expect(rows()).toHaveLength(64);
  expect(host.textContent).toContain("2 more not shown, refine the filter");
  expect(host.querySelector(`button[data-project-root-key="${projects[65]?.rootKey}"]`)).toBeNull();
  typeFilter("docs-65");
  expect(rows().map((row) => row.dataset.projectRootKey)).toEqual([projects[65]?.rootKey]);
  act(() => rows()[0]?.click());
  expect(select).toHaveBeenCalledExactlyOnceWith(projects[65]);
});
it("does not match a hidden root path of a uniquely named project", () => {
  const projects = [...serverProjects(6), serverProject("efabrica-api", "Efabrica API")];
  act(() => root.render(<AgentRemoteDraftProjectChooser projects={projects} onSelect={vi.fn()} />));
  typeFilter("remote:linux");
  expect(rows()).toEqual([]);
});
it("caps the rendered rows and says how many are hidden", () => {
  act(() =>
    root.render(
      <AgentRemoteDraftProjectChooser projects={serverProjects(70)} onSelect={vi.fn()} />,
    ),
  );
  expect(rows()).toHaveLength(64);
  expect(host.textContent).toContain("6 more not shown, refine the filter");
  typeFilter("project-6");
  expect(rows()).toHaveLength(11);
  expect(host.textContent).not.toContain("more not shown");
});
it("reports the clone only while it runs", () => {
  act(() =>
    root.render(
      <AgentRemoteDraftProjectChooser projects={[]} onSelect={vi.fn()} onAddProject={vi.fn()} />,
    ),
  );
  expect(host.querySelector('[role="status"]')).toBeNull();
  act(() =>
    root.render(
      <AgentRemoteDraftProjectChooser
        projects={[]}
        onSelect={vi.fn()}
        onAddProject={vi.fn()}
        cloneRunning
      />,
    ),
  );
  expect(host.querySelector('[role="status"]')?.textContent).toBe(
    "Clone running. Thread unlocks when ready.",
  );
  expect(addButton()).not.toBeUndefined();
});
it("omits the add row when adding is not possible", () => {
  act(() =>
    root.render(
      <AgentRemoteDraftProjectChooser projects={[serverProject("app")]} onSelect={vi.fn()} />,
    ),
  );
  expect(addButton()).toBeUndefined();
  expect(host.textContent).not.toContain(ADD_LABEL);
  expect(rows()).toHaveLength(1);
});
it("names the selected server only when it is known", () => {
  const chooser = <AgentRemoteDraftProjectChooser projects={[]} onSelect={vi.fn()} />;
  act(() => root.render(withSelectedServer(LINUX.id, chooser)));
  expect(host.querySelector(".agent-remote-project-choice__server")?.textContent).toBe(LINUX.name);
  act(() => root.render(withSelectedServer("srv-unknown", chooser)));
  expect(host.querySelector(".agent-remote-project-choice__server")).toBeNull();
  expect(host.textContent).not.toContain(LINUX.name);
  act(() => root.render(chooser));
  expect(host.querySelector(".agent-remote-project-choice__server")).toBeNull();
});
