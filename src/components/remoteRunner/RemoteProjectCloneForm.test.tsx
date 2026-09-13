// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RemoteRunnerGateway } from "../../domain/remoteRunner";
import { RemoteProjectCloneForm } from "./RemoteProjectCloneForm";
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
function button(text: string) {
  return Array.from(host.querySelectorAll("button")).find((entry) => entry.textContent === text)!;
}
function field(label: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("shows update guidance without calling unsupported clone APIs", () => {
  const cloneProject = vi.fn();
  act(() =>
    root.render(
      <RemoteProjectCloneForm
        gateway={{ cloneProject } as unknown as RemoteRunnerGateway}
        serverId="server"
        workspaceOwner="workspace"
        available={false}
        disabled={false}
        onCloned={vi.fn()}
      />,
    ),
  );
  act(() => button("Clone repository").click());
  expect(host.textContent).toContain("Update the runner");
  expect(host.querySelector("input")).toBeNull();
  expect(cloneProject).not.toHaveBeenCalled();
});
it("submits the chosen repository and selects a successful project once", async () => {
  const project = { id: "project", name: "project" };
  const cloneProject = vi
    .fn()
    .mockResolvedValue({ id: "clone", status: "succeeded", project, error: null });
  const onCloned = vi.fn().mockResolvedValue(undefined);
  act(() =>
    root.render(
      <RemoteProjectCloneForm
        gateway={{ cloneProject } as unknown as RemoteRunnerGateway}
        serverId="server"
        workspaceOwner="workspace"
        available
        disabled={false}
        onCloned={onCloned}
      />,
    ),
  );
  act(() => button("Clone repository").click());
  field("Repository URL", "git@github.com:owner/project.git");
  field("Repository folder name", "project");
  field("Repository branch", "main");
  expect(host.textContent).toContain("~/Developer/project");
  await act(async () => {
    button("Clone on server").click();
  });
  expect(cloneProject).toHaveBeenCalledWith(
    expect.objectContaining({ serverId: "server", name: "project", branch: "main" }),
  );
  expect(onCloned).toHaveBeenCalledExactlyOnceWith(project);
  expect(host.textContent).toContain("Project is ready on the server");
});
