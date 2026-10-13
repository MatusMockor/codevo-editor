// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BILLING_KEY,
  BILLING_PATH,
  FOLDER_RUNNER,
  mountFolderHarness,
  OTHER_ROW,
  REGISTERED,
  type FolderHarness,
  type FolderHarnessOptions,
} from "../../../test/remoteProjectFolderTestSupport";
import { REMOTE_PROJECT_FOLDER_ADOPTION_GRACE_MS } from "../../../application/useRemoteProjectFolderRegistration";
import { AgentRemoteFolderProjectDialog } from "./AgentRemoteFolderProjectDialog";

const SOURCE_TITLE = "Existing folder on server";
const BROWSER = 'section[aria-label="Choose folder on server"]';
const FORM_DIALOG = 'section[aria-label="Add existing folder on server"]';
const NAME_RULE =
  "Use letters or digits first, then letters, digits, hyphen or underscore, up to 64 characters.";

describe("AgentRemoteFolderProjectDialog", () => {
  let harness: FolderHarness;
  const onBackToEntry = vi.fn<() => void>();

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    onBackToEntry.mockClear();
  });

  afterEach(() => {
    harness.unmount();
    vi.useRealTimers();
  });

  async function mount(options: FolderHarnessOptions = {}): Promise<void> {
    harness = mountFolderHarness({
      ...options,
      view: (controller) => (
        <AgentRemoteFolderProjectDialog controller={controller} onBackToEntry={onBackToEntry} />
      ),
    });
    await harness.render();
  }

  function all(selector: string): HTMLElement[] {
    return [...harness.host.querySelectorAll<HTMLElement>(selector)];
  }

  function one(selector: string): HTMLElement {
    const found = harness.host.querySelector<HTMLElement>(selector);
    expect(found, selector).toBeInstanceOf(HTMLElement);
    return found as HTMLElement;
  }

  function option(text: string): HTMLElement {
    const found = all('[role="option"]').find((row) => row.textContent?.includes(text));
    expect(found, `option ${text}`).toBeInstanceOf(HTMLElement);
    return found as HTMLElement;
  }

  function optionNames(): string[] {
    return all('[role="option"]').map((row) => row.textContent ?? "");
  }

  async function click(target: HTMLElement): Promise<void> {
    await act(async () => target.click());
    await harness.settled();
  }

  async function press(target: HTMLElement, key: string, init: KeyboardEventInit = {}) {
    await act(async () => {
      target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
    });
    await harness.settled();
  }

  async function typeName(value: string): Promise<void> {
    const input = nameInput();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function nameInput(): HTMLInputElement {
    return one('input[aria-label="Project name"]') as HTMLInputElement;
  }

  function primary(): HTMLButtonElement {
    return one(".agent-remote-add-project__primary") as HTMLButtonElement;
  }

  function path(): string {
    return one(".agent-add-project__path-value").textContent ?? "";
  }

  function errors(): string[] {
    return all(".agent-remote-add-project__error").map((node) => node.textContent ?? "");
  }

  async function openBrowser(): Promise<void> {
    await harness.openFor();
  }

  async function openForm(folder = "billing"): Promise<void> {
    await openBrowser();
    await click(option("repos"));
    await click(option(folder));
    await click(one(".agent-add-project__add"));
  }

  async function submitted(options: FolderHarnessOptions = {}): Promise<void> {
    await mount(options);
    await openForm();
    await click(primary());
  }

  it("renders nothing until it is opened", async () => {
    await mount();
    expect(harness.host.innerHTML).toBe("");
    expect(harness.listDirectoryEntries).not.toHaveBeenCalled();
  });

  it("says so when server folders cannot be browsed", async () => {
    await mount({ directory: false });
    await harness.openFor();
    expect(harness.host.querySelector(BROWSER)).toBeNull();
    expect(one(FORM_DIALOG).textContent).toContain("Server folders cannot be browsed here.");
    expect(primary().disabled).toBe(true);
    expect(one('button[aria-label="Go back"]').hasAttribute("disabled")).toBe(true);
  });

  it("opens the server folder browser at the listing root", async () => {
    await mount();
    await openBrowser();
    expect(one(BROWSER).textContent).toContain(SOURCE_TITLE);
    expect(path()).toBe("/srv");
    expect(optionNames()).toEqual(["archive", "repos"]);
    expect(one('button[aria-label="Parent folder"]').hasAttribute("disabled")).toBe(true);
    expect(one(".agent-add-project__add").textContent).toBe("Use this folder");
    expect(harness.listDirectoryEntries).toHaveBeenCalledExactlyOnceWith({
      path: null,
      includeFiles: false,
    });
  });

  it("navigates into a folder and back up with the button and the keyboard", async () => {
    await mount();
    await openBrowser();
    await click(option("repos"));
    expect(path()).toBe("/srv/repos");
    expect(optionNames()).toEqual(["---", "billing", "my.project"]);

    const filter = one('input[aria-label="Filter directories"]');
    expect(document.activeElement).toBe(filter);
    await press(filter, "ArrowDown");
    expect(option("billing").getAttribute("aria-selected")).toBe("true");
    expect(filter.getAttribute("aria-activedescendant")).toBe(option("billing").id);
    await press(filter, "Enter");
    expect(path()).toBe(BILLING_PATH);

    await click(one('button[aria-label="Parent folder"]'));
    expect(path()).toBe("/srv/repos");
    await press(one('input[aria-label="Filter directories"]'), "Backspace");
    expect(path()).toBe("/srv");
    expect(one('button[aria-label="Parent folder"]').hasAttribute("disabled")).toBe(true);
    await press(one('input[aria-label="Filter directories"]'), "Backspace");
    expect(path()).toBe("/srv");
  });

  it("says so when the listing is truncated", async () => {
    await mount();
    await openBrowser();
    expect(one(BROWSER).textContent).not.toContain("Showing the first");
    await click(option("archive"));
    expect(one(BROWSER).textContent).toContain("Showing the first 2 entries");
  });

  it("shows loading, then a listing error with a working Retry", async () => {
    await mount();
    const refuse: { current: ((error: Error) => void) | null } = { current: null };
    harness.listDirectoryEntries.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          refuse.current = reject;
        }),
    );
    await harness.openFor();
    expect(one(BROWSER).textContent).toContain("Loading…");
    expect(one(".agent-add-project__add").hasAttribute("disabled")).toBe(true);
    await act(async () => refuse.current?.(new Error("Unable to list that directory.")));
    await harness.settled();
    expect(one(BROWSER).textContent).toContain("Unable to list that directory.");
    expect(one(".agent-add-project__add").hasAttribute("disabled")).toBe(true);

    const retry = all("button").find((button) => button.textContent === "Retry");
    expect(retry).toBeInstanceOf(HTMLElement);
    await click(retry as HTMLElement);
    expect(path()).toBe("/srv");
    expect(one(".agent-add-project__add").hasAttribute("disabled")).toBe(false);
  });

  it("uses the current folder and prefills a valid name", async () => {
    await mount();
    await openForm();
    const dialog = one(FORM_DIALOG);
    expect(dialog.textContent).toContain(SOURCE_TITLE);
    expect(dialog.textContent).toContain(BILLING_PATH);
    expect(nameInput().value).toBe("billing");
    expect(document.activeElement).toBe(nameInput());
    expect(nameInput().getAttribute("aria-invalid")).toBe("false");
    expect(errors()).toEqual([]);
    expect(primary().textContent).toBe("Add project");
    expect(primary().disabled).toBe(false);
  });

  it("derives the prefilled name from an awkward folder name", async () => {
    await mount();
    await openForm("my.project");
    expect(nameInput().value).toBe("my-project");
    expect(primary().disabled).toBe(false);
  });

  it("asks for a name when the folder name gives none", async () => {
    await mount();
    await openForm("---");
    expect(nameInput().value).toBe("");
    expect(errors()).toEqual([NAME_RULE]);
    expect(primary().disabled).toBe(true);
  });

  it("validates the name live and gates Add project on it", async () => {
    await mount();
    await openForm();
    await typeName("my.project");
    expect(errors()).toEqual([NAME_RULE]);
    expect(nameInput().getAttribute("aria-invalid")).toBe("true");
    expect(
      document.getElementById(nameInput().getAttribute("aria-describedby") ?? "")?.textContent,
    ).toBe(NAME_RULE);
    expect(primary().disabled).toBe(true);
    await click(primary());
    await press(nameInput(), "Enter");
    expect(harness.registerProject).not.toHaveBeenCalled();

    await typeName("my-project");
    expect(errors()).toEqual([]);
    expect(primary().disabled).toBe(false);
  });

  it("shows the in-flight state and submits exactly once", async () => {
    await mount();
    await openForm();
    await press(nameInput(), "Enter");
    await press(nameInput(), "Enter", { repeat: true });
    await click(primary());
    await press(one(FORM_DIALOG), "Enter", { metaKey: true });

    expect(harness.registerProject).toHaveBeenCalledExactlyOnceWith({
      path: BILLING_PATH,
      name: "billing",
    });
    expect(primary().textContent).toBe("Adding project…");
    expect(primary().disabled).toBe(true);
    expect(nameInput().disabled).toBe(true);
    expect(one("form").getAttribute("aria-busy")).toBe("true");
    expect(one('button[aria-label="Go back"]').hasAttribute("disabled")).toBe(true);
    await click(one('button[aria-label="Go back"]'));
    expect(harness.host.querySelector(BROWSER)).toBeNull();
    expect(primary().textContent).toBe("Adding project…");
  });

  it("selects the registered project and closes", async () => {
    await submitted();
    await harness.settle(REGISTERED);
    expect(harness.selectProject).toHaveBeenCalledExactlyOnceWith(BILLING_KEY);
    expect(harness.host.querySelector(FORM_DIALOG)).toBeNull();
    expect(harness.host.querySelector(BROWSER)).toBeNull();
  });

  it.each([
    [
      "not_git_root",
      "This folder is not the root of a Git repository. Choose the repository's top-level folder.",
    ],
    ["limit_reached", "This server already has the maximum number of projects."],
    ["not_allowed", "This folder cannot be added as a project."],
  ] as const)("explains the %s rejection and allows another try", async (reason, message) => {
    await submitted();
    await harness.settle({ status: "rejected", reason });
    expect(one('[role="alert"]').textContent).toBe(message);
    expect(nameInput().getAttribute("aria-invalid")).toBe("false");
    expect(primary().textContent).toBe("Add project");
    expect(primary().disabled).toBe(false);
    expect(harness.selectProject).not.toHaveBeenCalled();
  });

  it("puts a taken name on the name field until it changes", async () => {
    await submitted();
    await harness.settle({ status: "rejected", reason: "name_taken" });
    const message = "A project with this name already exists on this server.";
    expect(errors()).toEqual([message]);
    expect(harness.host.querySelector('[role="alert"]')).toBeNull();
    expect(nameInput().getAttribute("aria-invalid")).toBe("true");
    expect(
      document.getElementById(nameInput().getAttribute("aria-describedby") ?? "")?.textContent,
    ).toBe(message);
    expect(primary().disabled).toBe(true);

    await typeName("billing-2");
    expect(errors()).toEqual([]);
    expect(primary().disabled).toBe(false);
    await click(primary());
    expect(harness.registerProject).toHaveBeenLastCalledWith({
      path: BILLING_PATH,
      name: "billing-2",
    });
  });

  it("tells the user to update a runner that predates the route", async () => {
    await submitted();
    await harness.fail("Runner request failed (HTTP 404).");
    expect(one('[role="alert"]').textContent).toBe(
      "This server's runner does not support adding existing folders yet. Update the runner.",
    );
    expect(primary().disabled).toBe(false);
  });

  it.each([
    `Runner request failed (HTTP 503).\u0007${"x".repeat(900)}`,
    new Error("Runner request failed (HTTP 400)."),
    undefined,
  ])("shows fixed copy and no backend text for the failure %j", async (error) => {
    await submitted();
    await harness.fail(error);
    expect(one('[role="alert"]').textContent).toBe("Could not add this folder. Try again.");
    expect(harness.host.innerHTML).not.toContain("Runner request failed");
    expect(harness.host.innerHTML).not.toContain("HTTP");
    expect(harness.host.innerHTML).not.toContain("xxxx");
    expect(primary().disabled).toBe(false);
  });

  it("selects once and closes under StrictMode", async () => {
    await submitted({ strict: true });
    expect(harness.registerProject).toHaveBeenCalledTimes(1);
    await harness.settle(REGISTERED);
    expect(harness.selectProject).toHaveBeenCalledExactlyOnceWith(BILLING_KEY);
    expect(harness.host.querySelector(FORM_DIALOG)).toBeNull();
  });

  it("reports a project that never appears after the refresh", async () => {
    await submitted({ projectsAfterRefresh: [OTHER_ROW] });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    await harness.settle(REGISTERED);
    expect(primary().textContent).toBe("Adding project…");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REMOTE_PROJECT_FOLDER_ADOPTION_GRACE_MS);
    });
    expect(one('[role="alert"]').textContent).toBe(
      "The folder was added, but the project is not in this server's list yet. Close this dialog and open it from the server projects.",
    );
    expect(harness.selectProject).not.toHaveBeenCalled();
  });

  it("goes back from the name to the browser at that folder, then to the entry palette", async () => {
    await mount();
    await openForm();
    await click(one('button[aria-label="Go back"]'));
    expect(path()).toBe(BILLING_PATH);
    expect(onBackToEntry).not.toHaveBeenCalled();
    await click(one('button[aria-label="Go back"]'));
    expect(harness.host.querySelector(BROWSER)).toBeNull();
    expect(harness.controller.open).toBe(false);
    expect(onBackToEntry).toHaveBeenCalledTimes(1);
  });

  it("walks the folder history before leaving the browser", async () => {
    await mount();
    await openBrowser();
    await click(option("repos"));
    await click(one('button[aria-label="Go back"]'));
    expect(path()).toBe("/srv");
    expect(harness.controller.open).toBe(true);
    expect(onBackToEntry).not.toHaveBeenCalled();
  });

  it("returns to the entry palette from the listing root", async () => {
    await mount();
    await openBrowser();
    expect(path()).toBe("/srv");
    await click(one('button[aria-label="Go back"]'));
    expect(harness.controller.open).toBe(false);
    expect(harness.host.querySelector(BROWSER)).toBeNull();
    expect(onBackToEntry).toHaveBeenCalledTimes(1);
  });

  it("closes from either phase with Escape", async () => {
    await mount();
    await openBrowser();
    await press(one('input[aria-label="Filter directories"]'), "Escape");
    expect(harness.controller.open).toBe(false);

    await openForm();
    await press(nameInput(), "Escape");
    expect(harness.controller.open).toBe(false);

    await openForm();
    await act(async () => {
      one(FORM_DIALOG).dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(harness.controller.open).toBe(true);
    await act(async () => {
      one(".palette-backdrop").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(harness.controller.open).toBe(false);
  });

  it("keeps the server path and backend identities out of DOM attributes", async () => {
    await submitted();
    const attributes = () =>
      all("*").flatMap((node) => [...node.attributes].map((attribute) => attribute.value));
    for (const value of attributes()) {
      expect(value).not.toContain(BILLING_PATH);
      expect(value).not.toContain(FOLDER_RUNNER);
    }
    await harness.settle({ status: "rejected", reason: "not_allowed" });
    for (const value of attributes()) {
      expect(value).not.toContain(BILLING_PATH);
      expect(value).not.toContain(BILLING_KEY);
    }
  });
});
