// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteAddProjectStep } from "../../../application/useRemoteAddProject";
import { RemoteAddProjectFooter } from "./RemoteAddProjectFooter";

describe("RemoteAddProjectFooter", () => {
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

  it("shows navigation hints only on list steps", () => {
    render({ kind: "sources" }, { listStep: true });
    expect(host.textContent).toContain("navigate");
    expect(host.textContent).toContain("select");
    expect(host.textContent).toContain("close");

    render({ kind: "urlEntry", entry: "", lookup: { status: "idle" } }, { listStep: false });
    expect(host.textContent).not.toContain("navigate");
    expect(host.textContent).toContain("continue");
  });

  it("offers the back hint only where going back works", () => {
    render({ kind: "sources" }, { listStep: true });
    expect(host.textContent).not.toContain("back");

    render({ kind: "serverProjects" }, { listStep: true });
    expect(host.textContent).toContain("back");
  });

  it("runs the primary action unless it is disabled", () => {
    const onPrimary = vi.fn();
    render({ kind: "sources" }, { listStep: true, onPrimary });
    act(() => button().click());
    expect(onPrimary).toHaveBeenCalledTimes(1);

    render({ kind: "sources" }, { disabled: true, listStep: true, onPrimary });
    expect(button().disabled).toBe(true);
  });

  function button(): HTMLButtonElement {
    const element = host.querySelector<HTMLButtonElement>(".agent-remote-add-project__primary");
    expect(element, "Missing primary button").not.toBeNull();
    return element as HTMLButtonElement;
  }

  function render(
    step: RemoteAddProjectStep,
    overrides: { disabled?: boolean; listStep?: boolean; onPrimary?: () => void },
  ): void {
    act(() => {
      root.render(
        <RemoteAddProjectFooter
          disabled={overrides.disabled ?? false}
          listStep={overrides.listStep ?? false}
          onPrimary={overrides.onPrimary ?? (() => undefined)}
          step={step}
        />,
      );
    });
  }
});
