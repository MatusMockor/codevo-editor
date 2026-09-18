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
