// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RemoteAddProjectSources } from "./RemoteAddProjectSources";
import { remoteAddProjectSourceRows } from "./remoteAddProjectPresentation";
import { readyAvailability } from "./remoteAddProjectTestSupport";

describe("RemoteAddProjectSources", () => {
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

  it("marks the highlighted row and reports activation and hover", () => {
    const onActivate = vi.fn();
    const onHighlight = vi.fn();
    render({ activeIndex: 1, onActivate, onHighlight });

    const options = [...host.querySelectorAll<HTMLElement>('[role="option"]')];
    expect(options).toHaveLength(4);
    expect(options[1]?.getAttribute("aria-selected")).toBe("true");
    expect(options[1]?.className).toContain("active");
    expect(options[0]?.id).toBe("option-0");

    act(() => options[2]?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    act(() => options[2]?.click());

    expect(onHighlight).toHaveBeenCalledWith(2);
    expect(onActivate).toHaveBeenCalledExactlyOnceWith("github");
  });

  it("renders a setup-required chip and refuses to activate the disabled row", () => {
    const onActivate = vi.fn();
    render({
      availability: {
        ...readyAvailability(),
        gitlab: { status: "unavailable", reason: "lookupUnavailable" },
      },
      onActivate,
    });

    const gitlab = [...host.querySelectorAll<HTMLElement>('[role="option"]')][3];
    expect(gitlab?.getAttribute("aria-disabled")).toBe("true");
    expect(gitlab?.textContent).toContain("Repository lookup is unavailable in this build.");
    expect(gitlab?.textContent).toContain("Setup required");

    act(() => gitlab?.click());

    expect(onActivate).not.toHaveBeenCalled();
  });

  it("offers a retry and a sign-in hint for a provider that is not signed in", () => {
    const onRetry = vi.fn();
    render({
      availability: {
        ...readyAvailability(),
        gitlab: { status: "unavailable", reason: "notAuthenticated" },
      },
      onRetry,
    });

    const gitlab = [...host.querySelectorAll<HTMLElement>('[role="option"]')][3];
    expect(gitlab?.textContent).toContain("Run `glab auth login` in a terminal, then retry.");
    expect(gitlab?.textContent).not.toContain("Setup required");

    const retry = host.querySelector<HTMLButtonElement>(".agent-linkbutton");
    expect(retry?.textContent).toBe("Retry");
    act(() => retry?.click());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("offers a retry for a missing provider CLI", () => {
    render({
      availability: {
        ...readyAvailability(),
        github: { status: "unavailable", reason: "cliMissing" },
      },
    });

    const github = [...host.querySelectorAll<HTMLElement>('[role="option"]')][2];
    expect(github?.textContent).toContain("Install `gh`, then retry.");
    expect(github?.textContent).not.toContain("Setup required");
    expect(host.querySelector(".agent-linkbutton")?.textContent).toBe("Retry");
  });

  it("shows a pending state while a provider is still being checked", () => {
    render({ availability: { ...readyAvailability(), github: { status: "checking" } } });

    const github = [...host.querySelectorAll<HTMLElement>('[role="option"]')][2];
    expect(github?.getAttribute("aria-disabled")).toBe("true");
    expect(github?.textContent).toContain("Checking…");
    expect(github?.textContent).toContain("Clone owner/repo");
  });

  it("offers a retry instead of setup required for a reachable failure", () => {
    const onRetry = vi.fn();
    render({
      availability: {
        ...readyAvailability(),
        gitUrl: { status: "unavailable", reason: "probeFailed" },
        github: { status: "unavailable", reason: "hostsFailed" },
      },
      onRetry,
    });

    const rows = [...host.querySelectorAll<HTMLElement>('[role="option"]')];
    expect(rows[1]?.textContent).toContain("Could not reach this server. Try again.");
    expect(rows[1]?.textContent).not.toContain("Setup required");
    expect(rows[2]?.textContent).not.toContain("Setup required");

    const retry = host.querySelector<HTMLButtonElement>(".agent-linkbutton");
    expect(retry?.textContent).toBe("Retry");
    act(() => retry?.click());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("offers no retry while every source is usable", () => {
    render({});
    expect(host.querySelector(".agent-linkbutton")).toBeNull();
  });

  function render(
    overrides: {
      activeIndex?: number;
      availability?: ReturnType<typeof readyAvailability>;
      onActivate?: () => void;
      onHighlight?: () => void;
      onRetry?: () => void;
    } = {},
  ): void {
    act(() => {
      root.render(
        <RemoteAddProjectSources
          activeIndex={overrides.activeIndex ?? 0}
          listboxId="listbox"
          onActivate={overrides.onActivate ?? (() => undefined)}
          onRetry={overrides.onRetry ?? (() => undefined)}
          onHighlight={overrides.onHighlight ?? (() => undefined)}
          optionPrefix="option-"
          rows={remoteAddProjectSourceRows(overrides.availability ?? readyAvailability())}
        />,
      );
    });
  }
});
