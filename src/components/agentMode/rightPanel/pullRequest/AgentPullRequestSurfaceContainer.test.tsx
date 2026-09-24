// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { CreatePullRequestRequest, PullRequestContext } from "../../../../domain/pullRequest";
import { waitForReact } from "../../../../test/reactTestLifecycle";
import { click, mountUi, type MountedUi } from "../../../../ui/foundation/foundationTestSupport";
import { WithRightPanelContext, rightPanelTestContext } from "../agentRightPanelTestSupport";
import { AgentPullRequestSurfaceContainer } from "./AgentPullRequestSurfaceContainer";

let ui: MountedUi | null = null;
afterEach(() => {
  ui?.unmount();
  ui = null;
});

const CONTEXT: PullRequestContext = {
  headBranch: "feat/x",
  defaultBase: "main",
  base: "main",
  commitsAhead: 1,
  filesChanged: 2,
  unpushedCommits: 0,
  hasUpstream: true,
  forge: "github",
  cliAvailable: true,
  commitSubjects: ["feat: add x"],
  compareUrl: null,
};

function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  expect(found, name).toBeDefined();
  return found as HTMLButtonElement;
}

describe("AgentPullRequestSurfaceContainer", () => {
  it("creates the pull request, refreshes git status and opens the result", async () => {
    const requests: CreatePullRequestRequest[] = [];
    const opened: string[] = [];
    const refresh = vi.fn();
    const openSurface = vi.fn();
    const value = rightPanelTestContext(
      { gitStatus: { load: { kind: "idle" }, refresh }, openSurface },
      {
        pullRequest: {
          getContext: async () => CONTEXT,
          create: async (request) => {
            requests.push(request);
            return { url: "https://github.com/acme/app/pull/9", forge: "github" };
          },
        },
        externalUrl: {
          openExternal: async (url) => {
            opened.push(url);
          },
        },
      },
    );
    ui = mountUi();
    ui.render(
      <WithRightPanelContext value={value}>
        <AgentPullRequestSurfaceContainer />
      </WithRightPanelContext>,
    );
    await waitForReact(() => expect(ui?.host.textContent).toContain("1 commit · 2 files"));

    click(button("Create pull request"));
    await waitForReact(() => expect(ui?.host.textContent).toContain("Pull request created"));
    click(button("Open pull request"));
    click(button("Cancel"));

    expect(requests).toEqual([
      {
        repositoryRoot: "/repo",
        worktreePath: null,
        base: "main",
        title: "feat: add x",
        body: "## Changes\n\n- feat: add x\n",
        draft: false,
      },
    ]);
    expect(refresh).toHaveBeenCalled();
    await waitForReact(() => expect(opened).toEqual(["https://github.com/acme/app/pull/9"]));
    expect(openSurface).toHaveBeenCalledWith("git");
  });

  it("shows an opener refusal instead of failing silently", async () => {
    const value = rightPanelTestContext(
      {},
      {
        pullRequest: {
          getContext: async () => CONTEXT,
          create: () => Promise.reject(new Error("alreadyExists:https://evil.example/pull/1")),
        },
        externalUrl: {
          openExternal: () =>
            Promise.reject(
              new Error("Only github.com and gitlab.com addresses can be opened here."),
            ),
        },
      },
    );
    ui = mountUi();
    ui.render(
      <WithRightPanelContext value={value}>
        <AgentPullRequestSurfaceContainer />
      </WithRightPanelContext>,
    );
    await waitForReact(() => expect(ui?.host.textContent).toContain("1 commit · 2 files"));

    click(button("Create pull request"));
    await waitForReact(() =>
      expect(ui?.host.textContent).toContain("A pull request for this branch already exists."),
    );
    click(button("Open existing pull request"));

    await waitForReact(() =>
      expect(ui?.host.textContent).toContain(
        "Only github.com and gitlab.com addresses can be opened here.",
      ),
    );
  });
});
