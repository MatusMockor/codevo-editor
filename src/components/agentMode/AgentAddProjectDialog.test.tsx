// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DirectoryEntry,
  DirectoryListing,
  DirectoryListingGateway,
  DirectoryListingRequest,
} from "../../domain/directoryListing";
import { waitForReact } from "../../test/reactTestLifecycle";
import {
  AgentAddProjectDialog,
  MAX_RENDERED_DIRECTORY_ROWS,
  type AgentAddProjectDialogProps,
} from "./AgentAddProjectDialog";

const HOME = "/Users/dev";

interface FakeGateway extends DirectoryListingGateway {
  readonly reveals: string[];
  readonly pathRejections: Map<string, Error>;
  revealRejection: Error | null;
  listRejection: Error | null;
}

describe("AgentAddProjectDialog", () => {
  let host: HTMLDivElement;
  let root: Root;
  let gateway: FakeGateway;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    gateway = fakeGateway();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("renders the home listing with the tilde display path", async () => {
    await render();

    expect(pathValue()).toBe("~/");
    expect(rowNames()).toEqual(["design-studio", "Developer", "linked-shop"]);
  });

  it("hides hidden entries until the toggle is on", async () => {
    await render();
    expect(rowNames()).not.toContain(".config");

    const toggle = query<HTMLInputElement>(".agent-add-project__toggle input");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked")?.set;
    await act(async () => {
      setter?.call(toggle, true);
      toggle.dispatchEvent(new Event("click", { bubbles: true }));
    });

    expect(rowNames()).toContain(".config");
  });

  it("filters the listed entries as the query is typed", async () => {
    await render();

    await type("des");

    expect(rowNames()).toEqual(["design-studio"]);
  });

  it("descends into the highlighted directory on Enter", async () => {
    await render();

    await type("dev");
    await press({ key: "Enter" });
    await waitForReact(() => {
      expect(pathValue()).toBe("~/Developer");
    });

    expect(rowNames()).toEqual(["editor"]);
  });

  it("descends into a clicked row", async () => {
    await render();

    const row = [...host.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (candidate) => candidate.textContent === "Developer",
    );
    expect(row).not.toBeUndefined();
    await act(async () => row?.click());
    await waitForReact(() => {
      expect(pathValue()).toBe("~/Developer");
    });
  });

  it("ascends on Backspace only while the query is empty", async () => {
    await render();
    await type("dev");
    await press({ key: "Enter" });
    await waitForReact(() => {
      expect(pathValue()).toBe("~/Developer");
    });

    await type("edi");
    await press({ key: "Backspace" });
    expect(pathValue()).toBe("~/Developer");

    await type("");
    await press({ key: "Backspace" });
    await waitForReact(() => {
      expect(pathValue()).toBe("~/");
    });
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    await render({ onClose });

    await press({ key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("adds the current directory on Cmd+Enter", async () => {
    const onAdd = vi.fn();
    await render({ onAdd });

    await press({ key: "Enter", metaKey: true });

    expect(onAdd).toHaveBeenCalledWith(HOME);
  });

  it("disables Add with a reason when the directory is already a project", async () => {
    const onAdd = vi.fn();
    await render({ onAdd, projectRootPaths: [HOME] });

    expect(addButton().disabled).toBe(true);
    expect(host.textContent).toContain("This directory is already a project.");

    await press({ key: "Enter", metaKey: true });
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("disables Add when a project root differs only by a trailing separator", async () => {
    const onAdd = vi.fn();
    await render({ onAdd, projectRootPaths: [`${HOME}/`] });

    expect(addButton().disabled).toBe(true);
    expect(host.textContent).toContain("This directory is already a project.");

    await press({ key: "Enter", metaKey: true });
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("returns focus to the filter input after a mouse descend", async () => {
    await render();

    const row = [...host.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (candidate) => candidate.textContent === "Developer",
    );
    expect(row).not.toBeUndefined();
    await act(async () => {
      row?.focus();
      row?.click();
    });
    await waitForReact(() => {
      expect(pathValue()).toBe("~/Developer");
    });

    expect(document.activeElement).toBe(query<HTMLInputElement>('input[role="combobox"]'));
  });

  it("keeps the previous listing visible when a descend fails", async () => {
    const onAdd = vi.fn();
    await render({ onAdd });
    gateway.pathRejections.set(`${HOME}/Developer`, new Error("Permission denied"));

    await type("dev");
    await press({ key: "Enter" });
    await waitForReact(() => {
      expect(host.textContent).toContain("Permission denied");
    });

    expect(pathValue()).toBe("~/");
    expect(rowNames()).toEqual(["design-studio", "Developer", "linked-shop"]);
    expect(addButton().disabled).toBe(true);
    expect(query<HTMLElement>(".agent-add-project__reason").textContent).toBe(
      "This directory could not be read.",
    );

    await press({ key: "Enter", metaKey: true });
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("caps the rendered rows and notes the remainder", async () => {
    await render({ gateway: crowdedGateway(250) });

    expect(rowNames()).toHaveLength(MAX_RENDERED_DIRECTORY_ROWS);
    expect(host.textContent).toContain("50 more not shown");
  });

  it("reports a bounded error with a working retry", async () => {
    gateway.listRejection = new Error("Permission denied");
    await render();

    await waitForReact(() => {
      expect(host.textContent).toContain("Permission denied");
    });
    expect(addButton().disabled).toBe(true);

    gateway.listRejection = null;
    const retry = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) => candidate.textContent === "Retry",
    );
    expect(retry).not.toBeUndefined();
    await act(async () => retry?.click());

    await waitForReact(() => {
      expect(rowNames()).toContain("Developer");
    });
    expect(addButton().disabled).toBe(false);
  });

  it("shows a bounded note when the listing is truncated", async () => {
    await render({ gateway: truncatedGateway() });

    expect(host.textContent).toContain("Showing the first 1 entries");
  });

  it("reveals the current directory and reports a failure through onNotice", async () => {
    const onNotice = vi.fn();
    await render({ onNotice });

    await clickFinder();
    expect(gateway.reveals).toEqual([HOME]);

    gateway.revealRejection = new Error("Finder is unavailable");
    await clickFinder();

    await waitForReact(() => {
      expect(onNotice).toHaveBeenCalledWith("Finder is unavailable");
    });
  });

  async function clickFinder(): Promise<void> {
    const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) => candidate.textContent === "Open in Finder",
    );
    expect(button).not.toBeUndefined();
    await act(async () => button?.click());
  }

  async function render(overrides: Partial<AgentAddProjectDialogProps> = {}): Promise<void> {
    const props: AgentAddProjectDialogProps = {
      gateway,
      projectRootPaths: [],
      onAdd: vi.fn(),
      onClose: vi.fn(),
      onNotice: vi.fn(),
      ...overrides,
    };
    await act(async () => {
      root.render(<AgentAddProjectDialog {...props} />);
    });
    await waitForReact(() => {
      expect(host.querySelector(".agent-add-project__path-value")).not.toBeNull();
    });
  }

  async function type(value: string): Promise<void> {
    const input = query<HTMLInputElement>('input[role="combobox"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function press(init: KeyboardEventInit): Promise<void> {
    const input = query<HTMLInputElement>('input[role="combobox"]');
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
    });
  }

  function addButton(): HTMLButtonElement {
    return query<HTMLButtonElement>(".agent-add-project__add");
  }

  function pathValue(): string {
    return query<HTMLElement>(".agent-add-project__path-value").textContent ?? "";
  }

  function rowNames(): ReadonlyArray<string> {
    return [...host.querySelectorAll<HTMLElement>('[role="option"]')].map(
      (row) => row.textContent ?? "",
    );
  }

  function query<T extends Element>(selector: string): T {
    const element = host.querySelector<T>(selector);
    expect(element, `Missing element ${selector}`).not.toBeNull();
    return element as T;
  }
});

function fakeGateway(): FakeGateway {
  const listings = new Map<string, DirectoryListing>([
    [
      HOME,
      listing(HOME, "/Users", false, [
        entry(".config", "directory", true),
        entry("Developer", "directory", false),
        entry("design-studio", "directory", false),
        entry("linked-shop", "symlink", false),
        entry("notes.md", "file", false),
      ]),
    ],
    [
      `${HOME}/Developer`,
      listing(`${HOME}/Developer`, HOME, false, [entry("editor", "directory", false)]),
    ],
  ]);

  return {
    reveals: [],
    pathRejections: new Map<string, Error>(),
    revealRejection: null,
    listRejection: null,
    async listDirectoryEntries(request: DirectoryListingRequest): Promise<DirectoryListing> {
      if (this.listRejection !== null) throw this.listRejection;
      const path = request.path ?? HOME;
      const pathRejection = this.pathRejections.get(path);
      if (pathRejection !== undefined) throw pathRejection;
      const found = listings.get(path);
      if (found === undefined) throw new Error(`No listing for ${path}`);
      return found;
    },
    async revealDirectory(path: string): Promise<void> {
      if (this.revealRejection !== null) throw this.revealRejection;
      this.reveals.push(path);
    },
  };
}

function crowdedGateway(count: number): DirectoryListingGateway {
  const entries = Array.from({ length: count }, (_unused, index) =>
    entry(`dir-${String(index).padStart(3, "0")}`, "directory", false),
  );
  return {
    listDirectoryEntries: async () => listing(HOME, "/Users", false, entries),
    revealDirectory: async () => undefined,
  };
}

function truncatedGateway(): DirectoryListingGateway {
  return {
    listDirectoryEntries: async () =>
      listing(HOME, "/Users", true, [entry("only", "directory", false)]),
    revealDirectory: async () => undefined,
  };
}

function listing(
  path: string,
  parent: string | null,
  truncated: boolean,
  entries: ReadonlyArray<DirectoryEntry>,
): DirectoryListing {
  return { path, parent, entries, truncated };
}

function entry(name: string, kind: DirectoryEntry["kind"], hidden: boolean): DirectoryEntry {
  return { name, kind, hidden };
}
