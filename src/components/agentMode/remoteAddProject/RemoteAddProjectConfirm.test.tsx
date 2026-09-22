// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RemoteAddProjectConfirm,
  type RemoteAddProjectConfirmStep,
  type RemoteAddProjectConfirmProps,
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

  it("shows a compact repository summary and the default destination name", () => {
    render(step({}));

    expect(host.querySelector(".agent-remote-add-project__repo")?.textContent).toContain(
      "octo/editor",
    );
    expect(host.textContent).toContain("github.com · Private");
    expect(host.textContent).toContain("Inside the server projects folder");
    expect(inputs()[0]?.value).toBe("editor");
    expect(inputs()).toHaveLength(1);
  });

  it("reports both folder name errors on the field", () => {
    render(step({ nameError: "invalid" }));
    expect(inputs()[0]?.getAttribute("aria-invalid")).toBe("true");
    expect(host.textContent).toContain("64 characters");

    render(step({ nameError: "taken" }));
    expect(host.textContent).toContain("already on the server");
  });

  it("hides the protocol selector when only one URL exists and keeps the HTTPS warning", () => {
    render(
      step({
        protocol: "https",
        candidate: { kind: "repository", repository: repositoryInfoFixture({ sshUrl: null }) },
      }),
    );

    expect(protocolButtons()).toHaveLength(0);
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
    act(() => protocolButtons()[1]?.click());
    act(() => {
      inputs()[0]?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    });

    expect(onName).toHaveBeenCalledExactlyOnceWith("renamed");
    expect(onBranch).not.toHaveBeenCalled();
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

  it("chooses a server destination without submitting or changing clone fields", async () => {
    const onParentPath = vi.fn();
    const onSubmit = vi.fn();
    const onName = vi.fn();
    const listDirectoryEntries = vi.fn(async () => ({
      path: "/srv/projects",
      parent: "/srv",
      entries: [],
      truncated: false,
    }));
    const props = {
      directoryGateway: { listDirectoryEntries, revealDirectory: vi.fn() },
      parentPath: "/srv/projects",
      onParentPath,
      onSubmit,
      onName,
      environmentLabel: "Linux server",
    };
    render(step({ name: "custom", branch: "release", protocol: "https" }), props);
    await act(async () => buttonNamed("Choose destination folder").click());
    expect(listDirectoryEntries).toHaveBeenCalledWith({
      path: "/srv/projects",
      includeFiles: false,
    });
    expect(host.textContent).toContain("Linux server");
    expect(host.textContent).not.toContain("Open in Finder");
    await act(async () => buttonNamed("Choose folder").click());
    expect(onParentPath).toHaveBeenCalledExactlyOnceWith("/srv/projects");
    expect(inputs()[0]?.value).toBe("/srv/projects/custom");
    expect(inputs()).toHaveLength(1);
    expect(protocolButtons()[1]?.getAttribute("aria-pressed")).toBe("true");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onName).not.toHaveBeenCalled();
  });

  it("cancels destination browsing without changing the selection or bubbling Escape", async () => {
    const onParentPath = vi.fn();
    const parentKey = vi.fn();
    document.addEventListener("keydown", parentKey);
    render(step({ name: "custom" }), {
      directoryGateway: {
        listDirectoryEntries: async () => ({
          path: "/srv",
          parent: "/",
          entries: [],
          truncated: false,
        }),
        revealDirectory: vi.fn(),
      },
      onParentPath,
      parentPath: "/srv",
    });
    await act(async () => buttonNamed("Choose destination folder").click());
    act(() =>
      host
        .querySelector('input[type="checkbox"]')
        ?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })),
    );
    expect(onParentPath).not.toHaveBeenCalled();
    document.removeEventListener("keydown", parentKey);
    expect(parentKey).not.toHaveBeenCalled();
    expect(inputs()[0]?.value).toBe("/srv/custom");
  });

  it("contains keyboard focus in destination browsing", async () => {
    render(step({}), {
      directoryGateway: {
        listDirectoryEntries: async () => ({
          path: "/srv",
          parent: "/",
          entries: [],
          truncated: false,
        }),
        revealDirectory: vi.fn(),
      },
      onParentPath: vi.fn(),
    });
    await act(async () => buttonNamed("Choose destination folder").click());
    const last = buttonNamed("Choose folder");
    expect(last.disabled).toBe(false);
    const first = host.querySelector<HTMLInputElement>('input[role="combobox"]');
    const tab = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Tab" });
    act(() => {
      last.focus();
      expect(document.activeElement).toBe(last);
      last.dispatchEvent(tab);
    });
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
    const backTab = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Tab",
      shiftKey: true,
    });
    act(() => first?.dispatchEvent(backTab));
    expect(backTab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
  });

  it("disables destination changes while submitting", () => {
    render(step({ submitting: true }), {
      directoryGateway: { listDirectoryEntries: vi.fn(), revealDirectory: vi.fn() },
      onParentPath: vi.fn(),
      parentPath: "/srv/checkout",
    });
    expect(buttonNamed("Choose destination folder").disabled).toBe(true);
    expect(inputs()[0]?.value).toBe("/srv/checkout/editor");
    expect(inputs()[0]?.disabled).toBe(true);
  });

  it("splits an edited full destination into its parent and repository name", () => {
    const onParentPath = vi.fn();
    const onName = vi.fn();
    render(step({}), {
      parentPath: "/srv/projects",
      onParentPath,
      onName,
      directoryGateway: { listDirectoryEntries: vi.fn(), revealDirectory: vi.fn() },
    });
    setValue(inputs()[0] as HTMLInputElement, "/srv/projects/team/renamed");
    expect(onParentPath).toHaveBeenCalledExactlyOnceWith("/srv/projects/team");
    expect(onName).toHaveBeenCalledExactlyOnceWith("renamed");
    expect(inputs()[0]?.value).toBe("/srv/projects/team/renamed");
  });

  it("invalidates the outer clone action and blocks Enter for an invalid full path", () => {
    const onName = vi.fn();
    const onParentPath = vi.fn();
    const onSubmit = vi.fn();
    render(step({}), {
      parentPath: "/srv/projects",
      onParentPath,
      onName,
      onSubmit,
      directoryGateway: { listDirectoryEntries: vi.fn(), revealDirectory: vi.fn() },
    });
    setValue(inputs()[0] as HTMLInputElement, "/srv/projects/../escape");
    press(inputs()[0] as HTMLInputElement);
    expect(onName).toHaveBeenCalledExactlyOnceWith("");
    expect(onParentPath).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(inputs()[0]?.value).toBe("/srv/projects/../escape");
  });

  it("does not overwrite a typed destination with a late default root", async () => {
    let resolve!: (value: { path: string; parent: null; entries: []; truncated: false }) => void;
    const onParentPath = vi.fn();
    render(step({}), {
      onParentPath,
      directoryGateway: {
        listDirectoryEntries: () =>
          new Promise((done) => {
            resolve = done;
          }),
        revealDirectory: vi.fn(),
      },
    });
    setValue(inputs()[0] as HTMLInputElement, "/srv/typed/repo");
    await act(async () =>
      resolve({ path: "/srv/default", parent: null, entries: [], truncated: false }),
    );
    expect(onParentPath).toHaveBeenCalledExactlyOnceWith("/srv/typed");
    expect(inputs()[0]?.value).toBe("/srv/typed/repo");
  });

  it("resolves the configured root and ignores a replaced server response", async () => {
    let resolve!: (value: { path: string; parent: null; entries: []; truncated: false }) => void;
    const oldParent = vi.fn();
    render(step({}), {
      onParentPath: oldParent,
      directoryGateway: {
        listDirectoryEntries: () =>
          new Promise((done) => {
            resolve = done;
          }),
        revealDirectory: vi.fn(),
      },
    });
    const nextParent = vi.fn();
    await act(async () =>
      render(step({}), {
        onParentPath: nextParent,
        environmentLabel: "Other server",
        directoryGateway: {
          listDirectoryEntries: async () => ({
            path: "/srv/current",
            parent: null,
            entries: [],
            truncated: false,
          }),
          revealDirectory: vi.fn(),
        },
      }),
    );
    await act(async () =>
      resolve({ path: "/srv/stale", parent: null, entries: [], truncated: false }),
    );
    expect(oldParent).not.toHaveBeenCalled();
    expect(nextParent).toHaveBeenCalledExactlyOnceWith("/srv/current");
  });

  function press(target: Element): void {
    act(() => {
      target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    });
  }

  function buttonNamed(name: string): HTMLButtonElement {
    const match = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === name || button.getAttribute("aria-label") === name,
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
    overrides: Partial<RemoteAddProjectConfirmProps> = {},
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
          {...overrides}
        />,
      );
    });
  }
});
