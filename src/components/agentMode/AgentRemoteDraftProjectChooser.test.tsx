// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentRemoteDraftProjectChooser } from "./AgentRemoteDraftProjectChooser";
import { projectFixture } from "./agentThreadsSurfaceTestFixtures";
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));
it("shows management instead of guessing when no eligible project exists", () => {
  const manage = vi.fn();
  const select = vi.fn();
  act(() =>
    root.render(
      <AgentRemoteDraftProjectChooser
        projects={[
          projectFixture({ trust: "untrusted" }),
          projectFixture({ origin: "closed-tab-live-tasks" }),
        ]}
        onSelect={select}
        onOpenSettings={manage}
      />,
    ),
  );
  expect(host.querySelector("select")).toBeNull();
  expect(host.textContent).toContain("No available projects");
  act(() => host.querySelector("button")!.click());
  expect(manage).toHaveBeenCalledOnce();
  expect(select).not.toHaveBeenCalled();
});
it("offers the clone entry point and states why the thread is still locked", () => {
  const add = vi.fn();
  act(() =>
    root.render(
      <AgentRemoteDraftProjectChooser
        projects={[projectFixture({})]}
        onSelect={vi.fn()}
        onAddProject={add}
        cloneRunning
      />,
    ),
  );
  const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find((candidate) =>
    candidate.textContent?.includes("Add project or clone repository"),
  );
  expect(button).not.toBeUndefined();
  expect(host.querySelector('[role="status"]')?.textContent).toBe(
    "Clone running. Thread unlocks when ready.",
  );
  act(() => button!.click());
  expect(add).toHaveBeenCalledOnce();
});
it("keeps the clone note away while nothing is cloning", () => {
  act(() =>
    root.render(
      <AgentRemoteDraftProjectChooser projects={[projectFixture({})]} onSelect={vi.fn()} />,
    ),
  );
  expect(host.querySelector('[role="status"]')).toBeNull();
  expect(host.textContent).not.toContain("Add project or clone repository");
});
it("disambiguates equal labels and returns only the exact selected descriptor", () => {
  const first = projectFixture({ rootKey: "remote:linux:r:a", rootPath: "remote:linux:r:a" });
  const second = projectFixture({ rootKey: "remote:linux:r:b", rootPath: "remote:linux:r:b" });
  const select = vi.fn();
  act(() =>
    root.render(<AgentRemoteDraftProjectChooser projects={[first, second]} onSelect={select} />),
  );
  expect(host.querySelector("select")?.value).toBe("");
  expect(host.textContent).toContain(first.rootPath);
  expect(host.textContent).toContain(second.rootPath);
  act(() => {
    const field = host.querySelector("select")!;
    field.value = second.rootKey;
    field.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(select).toHaveBeenCalledExactlyOnceWith(second);
});
