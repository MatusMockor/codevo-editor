// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloneProgressBanner } from "./CloneProgressBanner";
import { ProjectTrustBanner } from "./ProjectTrustBanner";

describe("clone banners", () => {
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
  const handlers = () => ({
    onCancel: vi.fn(),
    onRetry: vi.fn(),
    onRemove: vi.fn(),
    onHide: vi.fn(),
  });
  function button(label: string) {
    return Array.from(host.querySelectorAll("button")).find(
      (candidate) =>
        candidate.textContent === label || candidate.getAttribute("aria-label") === label,
    );
  }

  it("renders progress with an accessible track and cancels", () => {
    const actions = handlers();
    act(() =>
      root.render(
        <CloneProgressBanner
          model={{
            kind: "running",
            title: "Cloning acme/web",
            summary: "Receiving objects · 45%",
            percent: 41,
          }}
          {...actions}
        />,
      ),
    );
    expect(host.textContent).toContain("Cloning acme/web");
    expect(host.textContent).toContain("Receiving objects · 45%");
    expect(host.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("41");
    act(() => button("Cancel")?.click());
    act(() => button("Close clone draft")?.click());
    expect(actions.onCancel).toHaveBeenCalledTimes(1);
    expect(actions.onHide).toHaveBeenCalledTimes(1);
    expect(button("Retry")).toBeUndefined();
    expect(button("Remove project")).toBeUndefined();
  });

  it("omits the track while the percentage is unknown", () => {
    act(() =>
      root.render(
        <CloneProgressBanner
          model={{
            kind: "running",
            title: "Cloning web",
            summary: "Working on the server",
            percent: null,
          }}
          {...handlers()}
        />,
      ),
    );
    expect(host.querySelector('[role="progressbar"]')).toBeNull();
    expect(button("Cancel")).not.toBeUndefined();
  });

  it("renders failure copy with the command and offers remove and retry", () => {
    const actions = handlers();
    act(() =>
      root.render(
        <CloneProgressBanner
          model={{
            kind: "failed",
            title: "Could not clone acme/web",
            detail: {
              text: "Repository not found or access denied on github.com. If it is private, run",
              command: "gh auth login",
              tail: "in a terminal, or use an SSH URL.",
            },
            retryable: true,
          }}
          {...actions}
        />,
      ),
    );
    expect(host.textContent).toContain("Could not clone acme/web");
    expect(host.querySelector("code")?.textContent).toBe("gh auth login");
    expect(button("Cancel")).toBeUndefined();
    act(() => button("Remove project")?.click());
    act(() => button("Retry")?.click());
    act(() => button("Close clone draft")?.click());
    expect(actions.onRemove).toHaveBeenCalledTimes(1);
    expect(actions.onRetry).toHaveBeenCalledTimes(1);
    expect(actions.onHide).toHaveBeenCalledTimes(1);
  });

  it("hides Retry when the clone cannot be retried", () => {
    act(() =>
      root.render(
        <CloneProgressBanner
          model={{
            kind: "cancelled",
            title: "Cancelled cloning acme/web",
            detail: { text: "Retry to bring in the repository.", command: null, tail: "" },
            retryable: false,
          }}
          {...handlers()}
        />,
      ),
    );
    expect(host.querySelector("code")).toBeNull();
    expect(button("Retry")).toBeUndefined();
    expect(button("Remove project")).not.toBeUndefined();
  });

  it("renders nothing when there is no clone state to show", () => {
    act(() => root.render(<CloneProgressBanner model={{ kind: "none" }} {...handlers()} />));
    expect(host.innerHTML).toBe("");
  });

  it("asks to review trust", () => {
    const onReview = vi.fn();
    act(() => root.render(<ProjectTrustBanner onReview={onReview} />));
    expect(host.textContent).toContain("Not trusted yet");
    expect(host.textContent).toContain("Agents start here once you trust this project");
    act(() => button("Review")?.click());
    expect(onReview).toHaveBeenCalledTimes(1);
  });
});
