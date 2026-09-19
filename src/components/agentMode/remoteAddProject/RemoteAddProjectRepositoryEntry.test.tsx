// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteAddProjectLookupState } from "../../../application/useRemoteAddProject";
import type { RepositoryHost } from "../../../domain/repositoryLookup";
import {
  RemoteAddProjectRepositoryEntry,
  RemoteAddProjectRepositoryHosts,
} from "./RemoteAddProjectRepositoryEntry";
import { pendingLookupFixture } from "./remoteAddProjectTestSupport";

describe("RemoteAddProjectRepositoryEntry", () => {
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

  it("hints how the exact lookup works while idle", () => {
    render({ status: "idle" });

    expect(host.textContent).toContain("Press Enter to look up one exact owner/repo");
    expect(host.querySelector('[role="status"]')).toBeNull();
  });

  it("announces the pending lookup", () => {
    render(pendingLookupFixture());

    expect(host.querySelector('[role="status"]')?.textContent).toBe("Looking up the repository…");
  });

  it("offers Git URL and the account hint when the repository is not found", () => {
    const onUseGitUrl = vi.fn();
    render({ status: "settled", outcome: { status: "notFound" } }, { onUseGitUrl });

    expect(host.textContent).toContain("That repository was not found.");
    expect(host.textContent).toContain("Access through this machine's The GitHub CLI (gh) account");

    const button = host.querySelector<HTMLButtonElement>(".agent-linkbutton");
    expect(button?.textContent).toBe("Use Git URL");
    act(() => button?.click());

    expect(onUseGitUrl).toHaveBeenCalledTimes(1);
  });

  it("keeps a failure to one bounded line without a Git URL loop", () => {
    render(
      { status: "settled", outcome: { status: "failed", reason: "network" } },
      {
        source: "gitUrl",
      },
    );

    expect(host.textContent).toContain("The lookup could not reach the network.");
    expect(host.querySelector(".agent-linkbutton")).toBeNull();
  });

  it("rejects an unusable entry before any lookup runs", () => {
    render({ status: "rejectedInput", reason: "invalidPath" });

    expect(host.textContent).toContain("Enter the repository as owner/repo.");
  });

  it("shows a badge for one host and a select for several", () => {
    const hosts: readonly RepositoryHost[] = [
      { provider: "gitlab", host: "gitlab.com", auth: "authenticated" },
      { provider: "gitlab", host: "git.example.test", auth: "notAuthenticated" },
    ];
    const onChooseHost = vi.fn();

    act(() => {
      root.render(
        <RemoteAddProjectRepositoryHosts
          host="gitlab.com"
          hosts={[hosts[0] as RepositoryHost]}
          onChooseHost={onChooseHost}
          truncated={false}
        />,
      );
    });
    expect(host.querySelector(".agent-remote-add-project__badge")?.textContent).toBe("gitlab.com");

    act(() => {
      root.render(
        <RemoteAddProjectRepositoryHosts
          host="gitlab.com"
          hosts={hosts}
          onChooseHost={onChooseHost}
          truncated={false}
        />,
      );
    });
    const select = host.querySelector<HTMLSelectElement>("select");
    expect([...(select?.options ?? [])].map((option) => option.disabled)).toEqual([false, true]);

    act(() => {
      select!.value = "git.example.test";
      select?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(onChooseHost).toHaveBeenCalledExactlyOnceWith("git.example.test");
  });

  function render(
    lookup: RemoteAddProjectLookupState,
    overrides: { onUseGitUrl?: () => void; source?: "gitUrl" | "github" } = {},
  ): void {
    act(() => {
      root.render(
        <RemoteAddProjectRepositoryEntry
          lookup={lookup}
          onUseGitUrl={overrides.onUseGitUrl ?? (() => undefined)}
          source={overrides.source ?? "github"}
        />,
      );
    });
  }
});
