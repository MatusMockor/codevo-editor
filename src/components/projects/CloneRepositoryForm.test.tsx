// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectoryListingGateway } from "../../domain/directoryListing";
import {
  WORKSPACE_ROOT_FILESYSTEM_ROOT_REFUSAL,
  WORKSPACE_ROOT_HOME_ANCESTOR_REFUSAL,
  WORKSPACE_ROOT_HOME_REFUSAL,
} from "../../domain/workspaceRootEligibility";
import { CloneRepositoryForm, type CloneRepositoryFormProps } from "./CloneRepositoryForm";

function gateway(existing: string[] = []): DirectoryListingGateway {
  return {
    listDirectoryEntries: vi.fn(async ({ path }) => ({
      path: path ?? "/Users/dev",
      parent: "/",
      entries: existing.map((name) => ({ name, kind: "directory" as const, hidden: false })),
      truncated: false,
    })),
    revealDirectory: vi.fn(async () => undefined),
  };
}

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("CloneRepositoryForm", () => {
  let host: HTMLDivElement;
  let root: Root;
  let props: CloneRepositoryFormProps;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    props = {
      initialUrl: "",
      environmentLabel: "This computer",
      directoryGateway: gateway(),
      home: "/Users/dev",
      shorthandHost: "github.com",
      lastParentPath: null,
      projectRootPaths: [],
      busy: false,
      error: null,
      onBack: vi.fn(),
      onClone: vi.fn(),
      onOpenExisting: vi.fn(),
    };
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  async function render(next: Partial<CloneRepositoryFormProps> = {}) {
    props = { ...props, ...next };
    await act(async () => root.render(<CloneRepositoryForm {...props} />));
  }
  async function settleProbe() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 260));
    });
  }
  function urlInput(): HTMLInputElement {
    const input = document.querySelector<HTMLInputElement>(
      'input[placeholder="Enter Git clone URL or owner/repo"]',
    );
    expect(input).toBeInstanceOf(HTMLInputElement);
    return input as HTMLInputElement;
  }
  function field(label: string): HTMLInputElement {
    const labelElement = Array.from(document.querySelectorAll("label")).find((candidate) =>
      candidate.textContent?.startsWith(label),
    );
    const input = labelElement?.htmlFor ? document.getElementById(labelElement.htmlFor) : null;
    expect(input).toBeInstanceOf(HTMLInputElement);
    return input as HTMLInputElement;
  }
  function cloneButton(): HTMLButtonElement {
    const button = document.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(button).toBeInstanceOf(HTMLButtonElement);
    return button as HTMLButtonElement;
  }

  it("keeps Clone disabled until the destination check settles", async () => {
    await render();
    act(() => typeInto(urlInput(), "https://github.com/acme/web-dashboard"));
    expect(cloneButton().disabled).toBe(true);
    act(() => cloneButton().form?.requestSubmit());
    expect(props.onClone).not.toHaveBeenCalled();
    await settleProbe();
    expect(cloneButton().disabled).toBe(false);
  });

  it("fills ~/code/<name> and submits one request", async () => {
    await render();
    expect(cloneButton().disabled).toBe(true);
    act(() => typeInto(urlInput(), "https://github.com/acme/web-dashboard"));
    await settleProbe();
    expect(document.body.textContent).toContain("acme/web-dashboard");
    expect(document.body.textContent).toContain("github.com · HTTPS");
    expect(field("Destination").value).toBe("~/code/web-dashboard");
    expect(document.body.textContent).toContain("The repository is cloned into this folder.");
    expect(cloneButton().disabled).toBe(false);
    act(() => cloneButton().click());
    expect(props.onClone).toHaveBeenCalledExactlyOnceWith(
      {
        url: "https://github.com/acme/web-dashboard",
        name: "web-dashboard",
        parentPath: "/Users/dev/code",
        ensureParent: true,
      },
      { host: "github.com", path: "acme/web-dashboard" },
    );
  });

  it("never enables Clone for credential URLs", async () => {
    await render({ initialUrl: "https://ghp_x@github.com/acme/repo.git" });
    expect(document.body.textContent).toContain("A URL carrying credentials is rejected");
    expect(cloneButton().disabled).toBe(true);
    act(() => cloneButton().click());
    act(() => typeInto(urlInput(), "https://user:pw@git.example.com/acme/repo"));
    await settleProbe();
    expect(document.body.textContent).toContain("A URL carrying credentials is rejected");
    expect(cloneButton().disabled).toBe(true);
    act(() => {
      cloneButton().form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(props.onClone).not.toHaveBeenCalled();
  });

  it("offers Open existing for a project destination", async () => {
    await render({
      initialUrl: "acme/web-dashboard",
      projectRootPaths: ["/Users/dev/code/web-dashboard"],
    });
    expect(document.body.textContent).toContain("~/code/web-dashboard is already a project.");
    const open = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Open existing",
    );
    expect(open).toBeInstanceOf(HTMLButtonElement);
    act(() => open?.click());
    expect(props.onOpenExisting).toHaveBeenCalledWith("/Users/dev/code/web-dashboard");
    expect(cloneButton().disabled).toBe(true);
  });

  it("flags an existing folder and a bad branch inline", async () => {
    await render({
      initialUrl: "https://github.com/acme/web-dashboard",
      directoryGateway: gateway(["web-dashboard"]),
    });
    await settleProbe();
    expect(document.body.textContent).toContain(
      "~/code/web-dashboard already exists. Choose another folder name.",
    );
    act(() => typeInto(field("Destination"), "~/code/web-2"));
    act(() => typeInto(field("Branch"), "bad..name"));
    await settleProbe();
    expect(document.body.textContent).toContain("Not a valid branch name.");
    expect(cloneButton().disabled).toBe(true);
  });

  it.each([
    ["~", WORKSPACE_ROOT_HOME_REFUSAL],
    ["/", WORKSPACE_ROOT_FILESYSTEM_ROOT_REFUSAL],
    ["/Users", WORKSPACE_ROOT_HOME_ANCESTOR_REFUSAL],
  ])("refuses %s as a destination inline", async (destination, message) => {
    await render({ initialUrl: "https://github.com/acme/web-dashboard" });
    act(() => typeInto(field("Destination"), destination));
    await settleProbe();
    const alert = Array.from(document.querySelectorAll('[role="alert"]')).find(
      (element) => element.textContent === message,
    );
    expect(alert).toBeInstanceOf(HTMLElement);
    expect(field("Destination").getAttribute("aria-invalid")).toBe("true");
    expect(cloneButton().disabled).toBe(true);
  });

  it("keeps the destination the user edited when the URL changes", async () => {
    await render({ initialUrl: "https://github.com/acme/one" });
    act(() => typeInto(field("Destination"), "/opt/work/custom"));
    act(() => typeInto(urlInput(), "https://github.com/acme/two"));
    expect(field("Destination").value).toBe("/opt/work/custom");
  });

  it("goes back from the header and with Escape, and shows a start error", async () => {
    await render({ error: "Two clones are already running. Wait for one to finish." });
    expect(document.body.textContent).toContain(
      "Two clones are already running. Wait for one to finish.",
    );
    const back = document.querySelector<HTMLButtonElement>('button[aria-label="Back"]');
    act(() => back?.click());
    expect(props.onBack).toHaveBeenCalledTimes(1);
    act(() => {
      urlInput().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(props.onBack).toHaveBeenCalledTimes(2);
  });

  it("disables the fields while a clone is starting", async () => {
    await render({ initialUrl: "https://github.com/acme/web-dashboard", busy: true });
    await settleProbe();
    expect(cloneButton().disabled).toBe(true);
    expect(cloneButton().textContent).toContain("Starting…");
    expect(field("Destination").disabled).toBe(true);
  });
});
