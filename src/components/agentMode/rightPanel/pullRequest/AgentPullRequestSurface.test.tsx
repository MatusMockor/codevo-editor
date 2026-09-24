// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { PullRequestContext } from "../../../../domain/pullRequest";
import { click, mountUi, type MountedUi } from "../../../../ui/foundation/foundationTestSupport";
import {
  AgentPullRequestSurface,
  type AgentPullRequestSurfaceProps,
} from "./AgentPullRequestSurface";

let ui: MountedUi | null = null;
afterEach(() => {
  ui?.unmount();
  ui = null;
});

const COMPARE = "https://github.com/acme/orders-api/compare/main...feat/idempotency-keys";

function context(overrides: Partial<PullRequestContext> = {}): PullRequestContext {
  return {
    headBranch: "feat/idempotency-keys",
    defaultBase: "main",
    base: "main",
    commitsAhead: 3,
    filesChanged: 3,
    unpushedCommits: 2,
    hasUpstream: true,
    forge: "github",
    cliAvailable: true,
    commitSubjects: [],
    compareUrl: COMPARE,
    ...overrides,
  };
}

function props(
  overrides: Partial<AgentPullRequestSurfaceProps> = {},
): AgentPullRequestSurfaceProps {
  return {
    state: {
      context: { kind: "ready", value: context() },
      base: "main",
      title: "Replay responses for repeated Idempotency-Key",
      body: "## Why",
      draft: false,
      titleError: null,
      bodyError: null,
      baseError: null,
      submit: { kind: "idle" },
    },
    baseOptions: ["main", "develop"],
    onBaseChange: vi.fn(),
    onTitleChange: vi.fn(),
    onBodyChange: vi.fn(),
    onDraftChange: vi.fn(),
    onCreate: vi.fn(),
    onCancel: vi.fn(),
    onOpen: vi.fn(),
    onReload: vi.fn(),
    ...overrides,
  };
}

function render(next: AgentPullRequestSurfaceProps): HTMLElement {
  ui = ui ?? mountUi();
  ui.render(<AgentPullRequestSurface {...next} />);
  return ui.host;
}

function button(host: ParentNode, name: string): HTMLButtonElement {
  const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) =>
      candidate.getAttribute("aria-label") === name || candidate.textContent?.trim() === name,
  );
  expect(found, name).toBeDefined();
  return found as HTMLButtonElement;
}

function withSubmit(submit: AgentPullRequestSurfaceProps["state"]["submit"]) {
  return props({ state: { ...props().state, submit } });
}

describe("AgentPullRequestSurface", () => {
  it("shows the compare header with a base menu and the change counts", () => {
    const next = props();
    const host = render(next);
    const sub = host.querySelector(".cv-rp-sub");

    expect(sub?.textContent).toContain("feat/idempotency-keys");
    expect(button(host, "Base branch: main").getAttribute("aria-haspopup")).toBe("menu");
    expect(sub?.textContent).toContain("3 commits · 3 files");

    click(button(host, "Base branch: main"));
    click(button(document, "develop"));
    expect(next.onBaseChange).toHaveBeenCalledWith("develop");
  });

  it("edits title, description and draft", () => {
    const next = props();
    const host = render(next);
    const title = host.querySelector<HTMLInputElement>("input");
    const description = host.querySelector<HTMLTextAreaElement>("textarea");

    expect(host.querySelector(`label[for="${title?.id}"]`)?.textContent).toContain("Title");
    expect(host.querySelector(`label[for="${description?.id}"]`)?.textContent).toContain(
      "Description",
    );
    expect(title?.value).toBe("Replay responses for repeated Idempotency-Key");
    expect(description?.value).toBe("## Why");
    click(host.querySelector('[role="switch"][aria-label="Create as draft"]') as HTMLElement);
    expect(next.onDraftChange).toHaveBeenCalledWith(true);
  });

  it("notes the pending push only when commits are unpushed", () => {
    expect(render(props()).textContent).toContain("Pushes 2 commits to origin first");
    ui?.unmount();
    ui = null;
    const quiet = render(
      props({
        state: {
          ...props().state,
          context: { kind: "ready", value: context({ unpushedCommits: 0 }) },
        },
      }),
    );
    expect(quiet.textContent).not.toContain("Pushes");
  });

  it("cancels and creates, and disables Create while submitting", () => {
    const next = props();
    const host = render(next);
    click(button(host, "Cancel"));
    click(button(host, "Create pull request"));
    expect(next.onCancel).toHaveBeenCalledTimes(1);
    expect(next.onCreate).toHaveBeenCalledTimes(1);

    const busy = render(withSubmit({ kind: "submitting" }));
    expect(button(busy, "Creating…").disabled).toBe(true);
  });

  it("offers to open a created pull request", () => {
    const next = withSubmit({
      kind: "created",
      receipt: { url: "https://github.com/acme/orders-api/pull/4", forge: "github" },
    });
    const host = render(next);

    expect(host.querySelector('[role="status"]')?.textContent).toContain("Pull request created");
    click(button(host, "Open pull request"));
    expect(next.onOpen).toHaveBeenCalledWith("https://github.com/acme/orders-api/pull/4");
    expect(button(host, "Create pull request").disabled).toBe(true);
    click(button(host, "Create pull request"));
    expect(next.onCreate).not.toHaveBeenCalled();
  });

  it("falls back to the compare page when the CLI is missing or the host is unsupported", () => {
    for (const kind of ["cliMissing", "unsupportedHost"] as const) {
      const next = withSubmit({
        kind: "failed",
        failure: { kind, message: `${kind} message`, url: null },
      });
      const host = render(next);
      expect(host.querySelector('[role="alert"]')?.textContent).toContain(`${kind} message`);
      click(button(host, "Open compare page"));
      expect(next.onOpen).toHaveBeenCalledWith(COMPARE);
    }
  });

  it("opens an existing pull request", () => {
    const next = withSubmit({
      kind: "failed",
      failure: {
        kind: "alreadyExists",
        message: "A pull request for this branch already exists.",
        url: "https://github.com/acme/orders-api/pull/3",
      },
    });
    const host = render(next);
    click(button(host, "Open existing pull request"));
    expect(next.onOpen).toHaveBeenCalledWith("https://github.com/acme/orders-api/pull/3");
  });

  it("explains an unsupported remote and disables Create", () => {
    const host = render(
      props({
        state: { ...props().state, context: { kind: "ready", value: context({ forge: null }) } },
      }),
    );
    expect(host.textContent).toContain("Pull requests need a github.com or gitlab.com remote.");
    expect(button(host, "Create pull request").disabled).toBe(true);
  });

  it("shows field errors and context load states", () => {
    const errors = render(
      props({
        state: {
          ...props().state,
          titleError: "Enter a pull request title.",
          baseError: "Choose a valid base branch.",
        },
      }),
    );
    expect(errors.textContent).toContain("Enter a pull request title.");
    expect(errors.textContent).toContain("Choose a valid base branch.");

    const loading = render(props({ state: { ...props().state, context: { kind: "loading" } } }));
    expect(loading.textContent).toContain("Reading the branch…");
    const next = props({
      state: { ...props().state, context: { kind: "failed", message: "Trust it first" } },
    });
    const failed = render(next);
    expect(failed.textContent).toContain("Trust it first");
    click(button(failed, "Retry"));
    expect(next.onReload).toHaveBeenCalledTimes(1);
  });
});
