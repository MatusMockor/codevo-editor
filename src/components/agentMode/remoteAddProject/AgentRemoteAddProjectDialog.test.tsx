// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteAddProjectStep } from "../../../application/useRemoteAddProject";
import { AgentRemoteAddProjectDialog } from "./AgentRemoteAddProjectDialog";
import {
  fakeRemoteAddProjectController,
  repositoryInfoFixture,
  type FakeRemoteAddProjectController,
} from "./remoteAddProjectTestSupport";

describe("AgentRemoteAddProjectDialog", () => {
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

  it("renders nothing while the controller is closed", () => {
    render(fakeRemoteAddProjectController({ open: false }));

    expect(host.querySelector(".agent-remote-add-project")).toBeNull();
  });

  it("wraps the highlight and activates the highlighted source on Enter", () => {
    const controller = render(fakeRemoteAddProjectController({}));

    expect(rowTitles()).toEqual([
      "Server project",
      "Git URL",
      "GitHub repository",
      "GitLab repository",
    ]);
    press({ key: "ArrowUp" });
    expect(activeDescendant()).toBe("agent-remote-add-project-option-3");
    press({ key: "ArrowDown" });
    expect(activeDescendant()).toBe("agent-remote-add-project-option-0");

    press({ key: "ArrowDown" });
    press({ key: "Enter" });

    expect(controller.chooseSource).toHaveBeenCalledExactlyOnceWith("gitUrl");
  });

  it("never activates a source that reports setup required", () => {
    const controller = render(
      fakeRemoteAddProjectController({
        availability: {
          serverProject: { status: "ready" },
          gitUrl: { status: "ready" },
          github: { status: "unavailable", reason: "cliMissing" },
          gitlab: { status: "checking" },
        },
      }),
    );

    expect(host.textContent).toContain("The GitHub CLI (gh) was not found on the selected server.");
    expect(host.textContent).toContain("Checking…");

    const github = optionAt(2);
    expect(github.getAttribute("aria-disabled")).toBe("true");
    act(() => github.click());
    press({ key: "ArrowDown" });
    press({ key: "ArrowDown" });
    press({ key: "Enter" });

    expect(controller.chooseSource).not.toHaveBeenCalled();
  });

  it("filters the rows, caps them and reports the remainder", () => {
    render(
      fakeRemoteAddProjectController({
        step: { kind: "serverProjects" },
        serverProjects: Array.from({ length: 220 }, (_unused, index) => ({
          key: `key-${index}`,
          label: `project-${String(index).padStart(3, "0")}`,
        })),
      }),
    );

    expect(rowTitles()).toHaveLength(200);
    expect(host.textContent).toContain("20 more not shown");

    type("project-199");

    expect(rowTitles()).toEqual(["project-199"]);
    expect(host.textContent).not.toContain("more not shown");
  });

  it("goes back only when the input is empty and closes on Escape", () => {
    const onClose = vi.fn();
    const controller = render(
      fakeRemoteAddProjectController({ step: { kind: "serverProjects" } }),
      {
        onClose,
      },
    );

    type("alpha");
    press({ key: "Backspace" });
    expect(controller.back).not.toHaveBeenCalled();

    type("");
    press({ key: "Backspace" });
    expect(controller.back).toHaveBeenCalledTimes(1);

    press({ key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("never walks back out of the sources step with Backspace", () => {
    const onClose = vi.fn();
    const controller = render(fakeRemoteAddProjectController({}), { onClose });

    press({ key: "Backspace" });
    press({ key: "Backspace", repeat: true });

    expect(controller.back).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("back");
  });

  it("ignores a held Backspace after the field emptied", () => {
    const controller = render(fakeRemoteAddProjectController({ step: { kind: "serverProjects" } }));

    press({ key: "Backspace", repeat: true });

    expect(controller.back).not.toHaveBeenCalled();
  });

  it("ignores Enter while an input method is composing", () => {
    const controller = render(
      fakeRemoteAddProjectController({
        step: { kind: "urlEntry", entry: "", lookup: { status: "idle" } },
      }),
    );

    type("git@github.com:acme/editor.git");
    act(() => {
      const event = new KeyboardEvent("keydown", { bubbles: true, key: "Enter" });
      Object.defineProperty(event, "isComposing", { value: true });
      input().dispatchEvent(event);
    });

    expect(controller.submitEntry).not.toHaveBeenCalled();
  });

  it("ignores a held Enter so one keypress starts one lookup", () => {
    const controller = render(
      fakeRemoteAddProjectController({
        step: {
          kind: "repository",
          provider: "github",
          host: "github.com",
          hosts: [{ provider: "github", host: "github.com", auth: "authenticated" }],
          hostsTruncated: false,
          entry: "",
          lookup: { status: "idle" },
        },
      }),
    );

    type("acme/storefront-api");
    press({ key: "Enter" });
    press({ key: "Enter", repeat: true });
    press({ key: "Enter", repeat: true });

    expect(controller.submitEntry).toHaveBeenCalledExactlyOnceWith("acme/storefront-api");
  });

  it("ignores a held Cmd+Enter on the confirm step", () => {
    const controller = render(fakeRemoteAddProjectController({ step: confirmStep({}) }));

    press({ key: "Enter", metaKey: true }, section());
    press({ key: "Enter", metaKey: true, repeat: true }, section());

    expect(controller.confirmClone).toHaveBeenCalledTimes(1);
  });

  it("reports a host without a usable clone URL and offers the Git URL escape", () => {
    const controller = render(
      fakeRemoteAddProjectController({
        step: {
          kind: "repository",
          provider: "gitlab",
          host: "gitlab.example.com",
          hosts: [{ provider: "gitlab", host: "gitlab.example.com", auth: "authenticated" }],
          hostsTruncated: false,
          entry: "platform/billing",
          lookup: { status: "settled", outcome: { status: "noCloneUrl" } },
        },
      }),
    );

    expect(host.textContent).toContain("This host returned no usable clone URL. Use a Git URL");
    const useGitUrl = [...host.querySelectorAll<HTMLButtonElement>(".agent-linkbutton")].find(
      (button) => button.textContent === "Use Git URL",
    );
    expect(useGitUrl).toBeDefined();
    act(() => useGitUrl?.click());

    expect(controller.useGitUrl).toHaveBeenCalledTimes(1);
  });

  it("clears the filter when the dialog reopens and restores the entry text", () => {
    render(fakeRemoteAddProjectController({}));
    type("gitlab");
    expect(input().value).toBe("gitlab");

    render(fakeRemoteAddProjectController({ open: false }));
    render(fakeRemoteAddProjectController({}));
    expect(input().value).toBe("");

    render(
      fakeRemoteAddProjectController({
        step: {
          kind: "repository",
          provider: "github",
          host: "github.com",
          hosts: [{ provider: "github", host: "github.com", auth: "authenticated" }],
          hostsTruncated: false,
          entry: "acme/storefront-api",
          lookup: { status: "idle" },
        },
      }),
    );
    expect(input().value).toBe("acme/storefront-api");
  });

  it("submits the typed repository entry on Enter", () => {
    const controller = render(
      fakeRemoteAddProjectController({
        step: {
          kind: "repository",
          provider: "gitlab",
          host: "gitlab.com",
          hosts: [
            { provider: "gitlab", host: "gitlab.com", auth: "authenticated" },
            { provider: "gitlab", host: "git.example.test", auth: "authenticated" },
          ],
          hostsTruncated: true,
          entry: "",
          lookup: { status: "idle" },
        },
      }),
    );

    expect(input().placeholder).toBe("Enter GitLab repository (group/project)");
    expect(input().getAttribute("role")).toBeNull();
    const hosts = host.querySelector<HTMLSelectElement>(".agent-remote-add-project__host");
    expect(hosts?.value).toBe("gitlab.com");
    expect(host.textContent).toContain("Some hosts are not shown.");

    press({ key: "Enter" });
    expect(controller.submitEntry).not.toHaveBeenCalled();

    type("group/project");
    press({ key: "Enter" });

    expect(controller.submitEntry).toHaveBeenCalledExactlyOnceWith("group/project");
  });

  it("confirms the clone on Cmd+Enter unless the form is blocked", () => {
    const blocked = render(
      fakeRemoteAddProjectController({ step: confirmStep({ nameError: "taken" }) }),
    );

    expect(primaryButton().disabled).toBe(true);
    press({ key: "Enter", metaKey: true }, section());
    expect(blocked.confirmClone).not.toHaveBeenCalled();

    const controller = render(fakeRemoteAddProjectController({ step: confirmStep({}) }));
    expect(primaryButton().textContent).toBe("Clone on server");
    press({ key: "Enter", ctrlKey: true }, section());

    expect(controller.confirmClone).toHaveBeenCalledTimes(1);
  });

  it("keeps a focused field on the confirm step so Escape still closes", () => {
    const onClose = vi.fn();
    render(fakeRemoteAddProjectController({ step: confirmStep({}) }), { onClose });

    const name = host.querySelector<HTMLInputElement>("input");
    expect(document.activeElement).toBe(name);

    press({ key: "Escape" }, name as HTMLInputElement);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("blocks the footer and shortcut until the full clone destination is available", () => {
    const controller = {
      ...fakeRemoteAddProjectController({ step: confirmStep({}) }),
      directoryGateway: {
        listDirectoryEntries: vi.fn(() => new Promise<never>(() => undefined)),
        revealDirectory: vi.fn(async () => undefined),
      },
      setParentPath: vi.fn(),
      parentPath: null,
    };
    render(controller);
    expect(primaryButton().disabled).toBe(true);
    act(() => primaryButton().click());
    press({ key: "Enter", metaKey: true }, section());
    expect(controller.confirmClone).not.toHaveBeenCalled();

    const ready = { ...controller, parentPath: "/srv/projects" };
    render(ready);
    expect(primaryButton().disabled).toBe(false);
    act(() => primaryButton().click());
    expect(controller.confirmClone).toHaveBeenCalledTimes(1);
  });

  it("closes when the backdrop is pressed and keeps presses inside the dialog", () => {
    const onClose = vi.fn();
    render(fakeRemoteAddProjectController({}), { onClose });

    act(() => {
      section().dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      host
        .querySelector(".palette-backdrop")
        ?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  function render(
    controller: FakeRemoteAddProjectController,
    overrides: { onClose?: () => void } = {},
  ) {
    act(() => {
      root.render(
        <AgentRemoteAddProjectDialog
          controller={controller}
          onClose={overrides.onClose ?? (() => undefined)}
        />,
      );
    });
    return controller;
  }

  function confirmStep(overrides: Partial<Extract<RemoteAddProjectStep, { kind: "confirm" }>>) {
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
    } satisfies RemoteAddProjectStep;
  }

  function type(value: string): void {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setter?.call(input(), value);
      input().dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function press(init: KeyboardEventInit, target: Element = input()): void {
    act(() => {
      target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
    });
  }

  function rowTitles(): ReadonlyArray<string> {
    return [...host.querySelectorAll<HTMLElement>('[role="option"] strong')].map(
      (row) => row.textContent ?? "",
    );
  }

  function optionAt(index: number): HTMLElement {
    const option = host.querySelectorAll<HTMLElement>('[role="option"]')[index];
    expect(option, `Missing option ${index}`).not.toBeUndefined();
    return option as HTMLElement;
  }

  function activeDescendant(): string | null {
    return input().getAttribute("aria-activedescendant");
  }

  function input(): HTMLInputElement {
    const element = host.querySelector<HTMLInputElement>(".palette-search input");
    expect(element, "Missing search input").not.toBeNull();
    return element as HTMLInputElement;
  }

  function section(): HTMLElement {
    const element = host.querySelector<HTMLElement>(".agent-remote-add-project");
    expect(element, "Missing dialog").not.toBeNull();
    return element as HTMLElement;
  }

  function primaryButton(): HTMLButtonElement {
    const element = host.querySelector<HTMLButtonElement>(".agent-remote-add-project__primary");
    expect(element, "Missing primary button").not.toBeNull();
    return element as HTMLButtonElement;
  }
});
