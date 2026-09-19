// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteAddProjectPendingClone } from "../../../application/useRemoteAddProject";
import { AgentRailCloneRow } from "./AgentRailCloneRow";

describe("AgentRailCloneRow", () => {
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

  it("announces an active clone with an indeterminate bar and a cancel action", () => {
    const onCancel = vi.fn();
    render({ name: "editor", status: "running", error: null }, { onCancel });

    expect(host.querySelector('[role="status"]')?.textContent).toBe("Cloning on the server");
    expect(host.querySelector(".agent-rail-clone__track")).not.toBeNull();

    const button = host.querySelector<HTMLButtonElement>("button");
    expect(button?.textContent).toBe("Cancel");
    act(() => button?.click());

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("keeps the queued state active", () => {
    render({ name: "editor", status: "queued", error: null });

    expect(host.querySelector('[role="status"]')?.textContent).toBe("Queued on the server");
    expect(host.querySelector(".agent-rail-clone__track")).not.toBeNull();
  });

  it("offers dismissal and a bounded error once the clone settles", () => {
    const onDismiss = vi.fn();
    render({ name: "editor", status: "failed", error: "e".repeat(400) }, { onDismiss });

    expect(host.querySelector('[role="status"]')?.textContent).toBe("Clone failed");
    expect(host.querySelector(".agent-rail-clone__track")).toBeNull();
    expect(host.querySelector(".agent-rail-clone__error")?.textContent).toHaveLength(200);

    const button = host.querySelector<HTMLButtonElement>("button");
    expect(button?.textContent).toBe("Dismiss");
    act(() => button?.click());

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("names every terminal status", () => {
    const statuses = ["succeeded", "interrupted", "cancelled"] as const;

    const texts = statuses.map((status) => {
      render({ name: "editor", status, error: null });
      return host.querySelector('[role="status"]')?.textContent ?? "";
    });

    expect(texts).toEqual(["Clone finished", "Clone interrupted", "Clone cancelled"]);
  });

  function render(
    clone: RemoteAddProjectPendingClone,
    overrides: { onCancel?: () => void; onDismiss?: () => void } = {},
  ): void {
    act(() => {
      root.render(
        <AgentRailCloneRow
          clone={clone}
          onCancel={overrides.onCancel ?? (() => undefined)}
          onDismiss={overrides.onDismiss ?? (() => undefined)}
        />,
      );
    });
  }
});
