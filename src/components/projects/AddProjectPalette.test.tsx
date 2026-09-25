// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AddProjectPalette, type AddProjectPaletteProps } from "./AddProjectPalette";

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function press(target: HTMLElement, key: string, init: KeyboardEventInit = {}) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
  });
}

const SERVER = {
  id: "srv",
  name: "build-box",
  host: "10.0.0.2",
  username: "dev",
  port: 22,
  connected: true,
};

describe("AddProjectPalette", () => {
  let host: HTMLDivElement;
  let root: Root;
  let props: AddProjectPaletteProps;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    props = {
      servers: [],
      serverId: null,
      hosts: { github: { kind: "ready", host: "github.com" }, gitlab: { kind: "missing" } },
      recent: [
        { path: "/Users/dev/code/billing-worker", label: "billing-worker", openedAtMs: null },
      ],
      home: "/Users/dev",
      cloneAvailable: true,
      notice: null,
      onServerChange: vi.fn(),
      onClose: vi.fn(),
      onOpenFolder: vi.fn(),
      onOpenPath: vi.fn(),
      onCloneForm: vi.fn(),
      onRepositoryPicker: vi.fn(),
      onServerAction: vi.fn(),
    };
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  function render(next: Partial<AddProjectPaletteProps> = {}) {
    props = { ...props, ...next };
    act(() => root.render(<AddProjectPalette {...props} />));
  }
  function input(): HTMLInputElement {
    const found = document.querySelector<HTMLInputElement>(
      'input[placeholder="Search sources, or paste a path or Git URL"]',
    );
    expect(found).toBeInstanceOf(HTMLInputElement);
    return found as HTMLInputElement;
  }
  function option(text: string): HTMLElement {
    const found = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
      (item) => item.textContent?.includes(text),
    );
    expect(found).toBeInstanceOf(HTMLElement);
    return found as HTMLElement;
  }
  function activeOption(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[role="option"][aria-selected="true"]');
  }

  it("opens each source and a recent folder", () => {
    render();
    act(() => option("Open folder").click());
    act(() => option("Git URL").click());
    act(() => option("GitHub repository").click());
    act(() => option("billing-worker").click());
    expect(props.onOpenFolder).toHaveBeenCalledTimes(1);
    expect(props.onCloneForm).toHaveBeenCalledWith("");
    expect(props.onRepositoryPicker).toHaveBeenCalledWith("github");
    expect(props.onOpenPath).toHaveBeenCalledWith("/Users/dev/code/billing-worker");
  });

  it("does not run a disabled GitLab row and explains why", () => {
    render();
    const gitlab = option("GitLab repository");
    expect(gitlab.getAttribute("aria-disabled")).toBe("true");
    expect(gitlab.textContent).toContain("Setup required");
    expect(gitlab.getAttribute("title")).toBe("Install glab on This computer, then sign in.");
    act(() => gitlab.click());
    expect(props.onRepositoryPicker).not.toHaveBeenCalled();
  });

  it("jumps to the clone form when a Git URL is pasted", () => {
    render();
    act(() => typeInto(input(), "https://github.com/acme/web-dashboard"));
    expect(props.onCloneForm).toHaveBeenCalledWith("https://github.com/acme/web-dashboard");
  });

  it("offers a typed path as a folder to open", () => {
    render();
    act(() => typeInto(input(), "~/code/app"));
    expect(option("Open ~/code/app")).toBeInstanceOf(HTMLElement);
    press(input(), "Enter");
    expect(props.onOpenPath).toHaveBeenCalledWith("/Users/dev/code/app");
  });

  it("does not open the home folder or the disk root and says why", () => {
    render();
    act(() => typeInto(input(), "~"));
    expect(option("Open ~").getAttribute("aria-disabled")).toBe("true");
    expect(document.body.textContent).toContain("Choose a project folder, not your home folder.");
    press(input(), "Enter");
    act(() => option("Open ~").click());
    act(() => typeInto(input(), "/"));
    press(input(), "Enter");
    expect(props.onOpenPath).not.toHaveBeenCalled();
  });

  it("opens the folder browser with Cmd+O and runs the highlighted row with Enter", () => {
    render();
    press(input(), "o", { metaKey: true });
    expect(props.onOpenFolder).toHaveBeenCalledTimes(1);
    press(input(), "ArrowDown");
    expect(activeOption()?.textContent).toContain("Git URL");
    expect(input().getAttribute("aria-activedescendant")).toBe(activeOption()?.id);
    press(input(), "Enter");
    expect(props.onCloneForm).toHaveBeenCalledWith("");
  });

  it("wraps with ArrowUp and keeps Enter inert on a disabled row", () => {
    render();
    press(input(), "ArrowUp");
    expect(activeOption()?.textContent).toContain("billing-worker");
    press(input(), "ArrowUp");
    expect(activeOption()?.textContent).toContain("GitLab repository");
    press(input(), "Enter");
    expect(props.onRepositoryPicker).not.toHaveBeenCalled();
    expect(props.onCloneForm).not.toHaveBeenCalled();
  });

  it("closes with Escape", () => {
    render();
    press(input(), "Escape");
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("switches to server sources", () => {
    render({
      servers: [
        {
          id: "srv",
          name: "build-box",
          host: "10.0.0.2",
          username: "dev",
          port: 22,
          connected: true,
        },
      ],
      serverId: "srv",
    });
    act(() => option("Clone repository").click());
    expect(props.onServerAction).toHaveBeenCalledWith("srv", "clone");
    act(() => option("Open server project").click());
    expect(props.onServerAction).toHaveBeenCalledWith("srv", "existing");
    expect(document.body.textContent).not.toContain("billing-worker");
    press(input(), "o", { metaKey: true });
    expect(props.onOpenFolder).not.toHaveBeenCalled();
  });

  it("picks the environment from the control", () => {
    render({
      servers: [
        {
          id: "srv",
          name: "build-box",
          host: "10.0.0.2",
          username: "dev",
          port: 22,
          connected: true,
        },
      ],
    });
    const control = document.querySelector<HTMLButtonElement>(
      'button[title="Where the project lives"]',
    );
    expect(control?.textContent).toContain("This computer");
    act(() => control?.click());
    const server = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]'),
    ).find((item) => item.textContent?.includes("build-box"));
    expect(server).toBeInstanceOf(HTMLElement);
    act(() => server?.click());
    expect(props.onServerChange).toHaveBeenCalledWith("srv");
  });

  it("keeps Cmd+O inside the palette so the global shortcut does not also run", () => {
    const global = vi.fn();
    window.addEventListener("keydown", global);
    render();
    press(input(), "o", { metaKey: true, cancelable: true });
    render({ serverId: "srv", servers: [SERVER] });
    press(input(), "o", { metaKey: true, cancelable: true });
    window.removeEventListener("keydown", global);
    expect(props.onOpenFolder).toHaveBeenCalledTimes(1);
    expect(global).not.toHaveBeenCalled();
  });

  it("moves focus between the search and the environment control with Tab", () => {
    render({ servers: [SERVER] });
    const control = document.querySelector<HTMLButtonElement>(
      'button[title="Where the project lives"]',
    );
    expect(control).toBeInstanceOf(HTMLButtonElement);
    expect(document.activeElement).toBe(input());
    press(input(), "Tab", { cancelable: true });
    expect(document.activeElement).toBe(control);
    press(control as HTMLElement, "Tab", { cancelable: true });
    expect(document.activeElement).toBe(input());
    press(input(), "Tab", { shiftKey: true, cancelable: true });
    expect(document.activeElement).toBe(control);
    press(control as HTMLElement, "Tab", { shiftKey: true, cancelable: true });
    expect(document.activeElement).toBe(input());
  });

  it("keeps Tab on the search when there is no environment to choose", () => {
    render();
    press(input(), "Tab", { cancelable: true });
    expect(document.activeElement).toBe(input());
  });

  it("shows a capacity notice", () => {
    render({
      notice: "You can keep up to 4 clones open. Finish or remove one before starting another.",
    });
    expect(document.body.textContent).toContain("You can keep up to 4 clones open.");
  });
});
