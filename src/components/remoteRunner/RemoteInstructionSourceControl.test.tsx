// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { projectFixture } from "../agentMode/agentThreadsSurfaceTestFixtures";
import { readRemoteInstructionRoot } from "../../application/remoteInstructionSources";
import { RemoteInstructionSourceControl } from "./RemoteInstructionSourceControl";
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));
it("offers only trusted open local projects and persists selection for the exact remote owner", () => {
  const local = {
    ...projectFixture(),
    rootPath: "/local",
    rootKey: "/local",
    trust: "trusted" as const,
  };
  const projects = [
    local,
    { ...local, rootKey: "/untrusted", rootPath: "/untrusted", trust: "untrusted" as const },
    { ...local, rootKey: "remote:s:r:p", rootPath: "remote:s:r:p" },
  ];
  const render = (key: string) =>
    act(() =>
      root.render(<RemoteInstructionSourceControl remoteRootKey={key} projects={projects} />),
    );
  render("remote:s:r:p");
  expect(host.textContent).toContain("Only global rules sync");
  expect(host.querySelectorAll("option")).toHaveLength(2);
  const select = host.querySelector("select")!;
  act(() => {
    select.value = "/local";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(readRemoteInstructionRoot("s", "r", "p")).toBe("/local");
  render("remote:s:r:other");
  expect(host.querySelector("select")!.value).toBe("");
  render("remote:s:r:p");
  expect(host.querySelector("select")!.value).toBe("/local");
  act(() => {
    const input = host.querySelector("select")!;
    input.value = "";
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(readRemoteInstructionRoot("s", "r", "p")).toBeUndefined();
});
it("updates another mounted control and read-only summary when a mapping changes", () => {
  const local = {
    ...projectFixture(),
    rootPath: "/local",
    rootKey: "/local",
    trust: "trusted" as const,
  };
  act(() =>
    root.render(
      <>
        <RemoteInstructionSourceControl remoteRootKey="remote:s:r:p" projects={[local]} />
        <RemoteInstructionSourceControl remoteRootKey="remote:s:r:p" projects={[local]} />
        <RemoteInstructionSourceControl remoteRootKey="remote:s:r:p" projects={[]} readOnly />
      </>,
    ),
  );
  const selects = host.querySelectorAll("select");
  expect(selects).toHaveLength(2);
  act(() => {
    selects[0].value = "/local";
    selects[0].dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(selects[1].value).toBe("/local");
  expect(host.textContent).toContain("Global and project rules use local source: /local.");
  expect(host.textContent).not.toContain("reopen local project");
  act(() => {
    selects[1].value = "";
    selects[1].dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(selects[0].value).toBe("");
});
it("refreshes the source display when another window changes storage", () => {
  const local = {
    ...projectFixture(),
    rootPath: "/local",
    rootKey: "/local",
    trust: "trusted" as const,
  };
  act(() =>
    root.render(<RemoteInstructionSourceControl remoteRootKey="remote:s:r:p" projects={[local]} />),
  );
  act(() => {
    localStorage.setItem(
      "codevo.remote-instruction-sources.v1",
      JSON.stringify([[JSON.stringify(["s", "r", "p"]), "/local"]]),
    );
    window.dispatchEvent(
      new StorageEvent("storage", { key: "codevo.remote-instruction-sources.v1" }),
    );
  });
  expect(host.querySelector("select")!.value).toBe("/local");
});
