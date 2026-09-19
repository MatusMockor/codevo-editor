// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RemoteAddProjectConfirm,
  type RemoteAddProjectConfirmStep,
} from "./RemoteAddProjectConfirm";
import { repositoryInfoFixture } from "./remoteAddProjectTestSupport";

describe("RemoteAddProjectConfirm", () => {
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

  it("shows the repository card, the projects root prefix and the default branch placeholder", () => {
    render(step({}));

    expect(host.querySelector(".agent-remote-add-project__repo")?.textContent).toContain(
      "octo/editor",
    );
    expect(host.textContent).toContain("github.com · Private");
    expect(host.querySelector(".agent-remote-add-project__prefix")?.textContent).toBe(
      "projects root/",
    );
    expect(inputs()[0]?.value).toBe("editor");
    expect(inputs()[1]?.placeholder).toBe("main");
  });

  it("reports both folder name errors on the field", () => {
    render(step({ nameError: "invalid" }));
    expect(inputs()[0]?.getAttribute("aria-invalid")).toBe("true");
    expect(host.textContent).toContain("64 characters");

    render(step({ nameError: "taken" }));
    expect(host.textContent).toContain("already on the server");
  });

  it("disables the protocol whose URL is null and warns about anonymous HTTPS", () => {
    render(
      step({
        protocol: "https",
        candidate: { kind: "repository", repository: repositoryInfoFixture({ sshUrl: null }) },
      }),
    );

    const [ssh, https] = protocolButtons();
    expect(ssh?.disabled).toBe(true);
    expect(https?.getAttribute("aria-pressed")).toBe("true");
    expect(host.textContent).toContain("clones over HTTPS anonymously");
  });

  it("drops the warning for a public repository", () => {
    render(
      step({
        protocol: "https",
        candidate: {
          kind: "repository",
          repository: repositoryInfoFixture({ visibility: "public" }),
        },
      }),
    );

    expect(host.textContent).not.toContain("anonymously");
  });

  it("offers the existing project when the folder name is already on the server", () => {
    const onOpenExisting = vi.fn();
    render(step({ existingProjectKey: "remote:linux:r:editor" }), { onOpenExisting });

    expect(host.textContent).toContain("Name exists on server");
    const button = host.querySelector<HTMLButtonElement>(".agent-linkbutton");
    expect(button?.textContent).toBe("Open existing");
    act(() => button?.click());

    expect(onOpenExisting).toHaveBeenCalledTimes(1);
  });

  it("raises a bounded submit error as an alert", () => {
    render(step({ submitError: "x".repeat(400) }));

    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toHaveLength(200);
  });

  it("reports field edits and submits on Enter", () => {
    const onName = vi.fn();
    const onBranch = vi.fn();
    const onProtocol = vi.fn();
    const onSubmit = vi.fn();
    render(step({}), { onBranch, onName, onProtocol, onSubmit });

    setValue(inputs()[0] as HTMLInputElement, "renamed");
    setValue(inputs()[1] as HTMLInputElement, "release");
    act(() => protocolButtons()[1]?.click());
    act(() => {
      inputs()[0]?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    });

    expect(onName).toHaveBeenCalledExactlyOnceWith("renamed");
    expect(onBranch).toHaveBeenCalledExactlyOnceWith("release");
    expect(onProtocol).toHaveBeenCalledExactlyOnceWith("https");
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("never starts the clone from Enter on another control", () => {
    const onOpenExisting = vi.fn();
    const onProtocol = vi.fn();
    const onSubmit = vi.fn();
    render(step({ existingProjectKey: "remote:linux:r:editor" }), {
      onOpenExisting,
      onProtocol,
      onSubmit,
    });

    const existing = buttonNamed("Open existing");
    press(existing);
    expect(onSubmit).not.toHaveBeenCalled();
    act(() => existing.click());
    expect(onOpenExisting).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();

    const https = buttonNamed("HTTPS");
    press(https);
    expect(onSubmit).not.toHaveBeenCalled();
    act(() => https.click());
    expect(onProtocol).toHaveBeenCalledExactlyOnceWith("https");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("reports an invalid branch on the branch field", () => {
    render(step({ branch: "a..b", branchError: "invalid" }));

    expect(inputs()[1]?.getAttribute("aria-invalid")).toBe("true");
    expect(host.textContent).toContain("Use a Git branch name");
  });

  function press(target: Element): void {
    act(() => {
      target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    });
  }

  function buttonNamed(name: string): HTMLButtonElement {
    const match = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === name,
    );
    expect(match, `Missing button ${name}`).not.toBeUndefined();
    return match as HTMLButtonElement;
  }

  function setValue(element: HTMLInputElement, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setter?.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function inputs(): ReadonlyArray<HTMLInputElement> {
    return [...host.querySelectorAll<HTMLInputElement>("input")];
  }

  function protocolButtons(): ReadonlyArray<HTMLButtonElement> {
    return [
      ...host.querySelectorAll<HTMLButtonElement>(".agent-remote-add-project__segmented button"),
    ];
  }

  function step(overrides: Partial<RemoteAddProjectConfirmStep>): RemoteAddProjectConfirmStep {
    return {
      kind: "confirm",
      candidate: { kind: "repository", repository: repositoryInfoFixture({}) },
      name: "editor",
      branch: "",
      protocol: "ssh",
      nameError: null,
      branchError: null,
      existingProjectKey: null,
      submitError: null,
      submitting: false,
      ...overrides,
    };
  }

  function render(
    confirmStep: RemoteAddProjectConfirmStep,
    overrides: {
      onBranch?: () => void;
      onName?: () => void;
      onOpenExisting?: () => void;
      onProtocol?: () => void;
      onSubmit?: () => void;
    } = {},
  ): void {
    act(() => {
      root.render(
        <RemoteAddProjectConfirm
          onBranch={overrides.onBranch ?? (() => undefined)}
          onName={overrides.onName ?? (() => undefined)}
          onOpenExisting={overrides.onOpenExisting ?? (() => undefined)}
          onProtocol={overrides.onProtocol ?? (() => undefined)}
          onSubmit={overrides.onSubmit ?? (() => undefined)}
          step={confirmStep}
        />,
      );
    });
  }
});
