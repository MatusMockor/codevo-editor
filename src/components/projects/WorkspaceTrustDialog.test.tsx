// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  WorkspaceTrustPromptCoordinator,
  type WorkspaceTrustDecision,
} from "../../application/workspaceTrustPrompt";
import { WorkspaceTrustDialogHost } from "./WorkspaceTrustDialogHost";

describe("WorkspaceTrustDialogHost", () => {
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
  function button(label: string): HTMLButtonElement {
    const found = Array.from(document.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === label,
    );
    expect(found).toBeInstanceOf(HTMLButtonElement);
    return found as HTMLButtonElement;
  }
  function openPrompt(
    prompt: WorkspaceTrustPromptCoordinator,
    request: Parameters<WorkspaceTrustPromptCoordinator["request"]>[0],
  ): Promise<WorkspaceTrustDecision> {
    let decision: Promise<WorkspaceTrustDecision> = Promise.resolve("notNow");
    act(() => {
      decision = prompt.request(request);
    });
    return decision;
  }

  it("renders the mockup copy for a cloned project and trusts on confirm", async () => {
    const prompt = new WorkspaceTrustPromptCoordinator();
    act(() => root.render(<WorkspaceTrustDialogHost prompt={prompt} workspaceScope="ws" />));
    const decision = openPrompt(prompt, {
      rootPath: "/Users/dev/code/web-dashboard",
      label: "web-dashboard",
      origin: { kind: "clone", host: "github.com", path: "acme/web-dashboard" },
    });
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Trust web-dashboard?");
    expect(dialog?.textContent).toContain(
      "Agents can only start in trusted projects. Trust it if you know where this code comes from.",
    );
    expect(dialog?.textContent).toContain("/Users/dev/code/web-dashboard");
    expect(dialog?.textContent).toContain("Cloned from github.com/acme/web-dashboard");
    expect(dialog?.textContent).toContain("Agents run commands and edit files in this folder");
    expect(dialog?.textContent).toContain("Package scripts, tasks, tests and the debugger can run");
    expect(dialog?.textContent).toContain("Language servers start from the project's own binaries");
    expect(dialog?.textContent).toContain("You can revoke trust any time in project settings.");
    expect(document.activeElement).toBe(button("Not now"));
    act(() => button("Trust project").click());
    await expect(decision).resolves.toBe("trust");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("treats Escape and Not now as notNow and labels local folders", async () => {
    const prompt = new WorkspaceTrustPromptCoordinator();
    act(() => root.render(<WorkspaceTrustDialogHost prompt={prompt} workspaceScope="ws" />));
    const escaped = openPrompt(prompt, {
      rootPath: "/opt/app",
      label: "app",
      origin: { kind: "local" },
    });
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Local folder");
    act(() => {
      document
        .querySelector('[role="dialog"]')
        ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await expect(escaped).resolves.toBe("notNow");
    const declined = openPrompt(prompt, {
      rootPath: "/opt/app",
      label: "app",
      origin: { kind: "local" },
    });
    act(() => button("Not now").click());
    await expect(declined).resolves.toBe("notNow");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("dismisses a prompt when the workspace scope changes A -> B -> A", async () => {
    const prompt = new WorkspaceTrustPromptCoordinator();
    act(() => root.render(<WorkspaceTrustDialogHost prompt={prompt} workspaceScope="ws-a" />));
    const decision = openPrompt(prompt, {
      rootPath: "/opt/app",
      label: "app",
      origin: { kind: "local" },
    });
    act(() => root.render(<WorkspaceTrustDialogHost prompt={prompt} workspaceScope="ws-b" />));
    act(() => root.render(<WorkspaceTrustDialogHost prompt={prompt} workspaceScope="ws-a" />));
    await expect(decision).resolves.toBe("notNow");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("dismisses a pending prompt when the host unmounts", async () => {
    const prompt = new WorkspaceTrustPromptCoordinator();
    act(() => root.render(<WorkspaceTrustDialogHost prompt={prompt} workspaceScope="ws" />));
    const decision = openPrompt(prompt, {
      rootPath: "/opt/app",
      label: "app",
      origin: { kind: "local" },
    });
    act(() => root.render(<></>));
    await expect(decision).resolves.toBe("notNow");
  });
});
