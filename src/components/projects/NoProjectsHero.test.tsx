// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { NoProjectsHero } from "./NoProjectsHero";

describe("NoProjectsHero", () => {
  it("renders the first-run copy and opens add project", () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onAddProject = vi.fn();
    act(() => root.render(<NoProjectsHero onAddProject={onAddProject} />));
    expect(host.querySelector("h1")?.textContent).toBe("What should we work on?");
    expect(host.textContent).toContain("Add a project to start your first thread.");
    const button = Array.from(host.querySelectorAll("button")).find(
      (item) => item.textContent === "Add project",
    );
    act(() => button?.click());
    expect(onAddProject).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    host.remove();
  });
});
