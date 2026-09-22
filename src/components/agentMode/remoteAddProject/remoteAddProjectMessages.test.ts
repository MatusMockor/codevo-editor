import { describe, expect, it } from "vitest";
import type { RemoteProjectSourceKind } from "../../../domain/repositoryLookup";
import { pendingLookupFixture } from "./remoteAddProjectTestSupport";
import {
  remoteAddProjectCloneStatusText,
  remoteAddProjectEntryHint,
  remoteAddProjectLookupMessage,
  remoteAddProjectNameErrorMessage,
  remoteAddProjectPathHint,
  remoteAddProjectProviderLabel,
  remoteAddProjectSourceDescription,
  remoteAddProjectSourceReason,
  remoteAddProjectSourceTitle,
  remoteAddProjectVisibilityLabel,
} from "./remoteAddProjectMessages";

describe("remoteAddProjectMessages", () => {
  it("stays silent while a lookup is idle or pending", () => {
    expect(remoteAddProjectLookupMessage({ status: "idle" }, "github")).toBeNull();
    expect(remoteAddProjectLookupMessage(pendingLookupFixture(), "github")).toBeNull();
  });

  it("returns one bounded message for every settled outcome", () => {
    const outcomes = [
      { status: "notFound" },
      { status: "cliMissing" },
      { status: "notAuthenticated" },
      { status: "hostNotAllowed" },
      { status: "timedOut" },
      { status: "rateLimited", retryAfterSeconds: 45 },
      { status: "rateLimited", retryAfterSeconds: null },
      { status: "failed", reason: "network" },
      { status: "failed", reason: "invalidOutput" },
      { status: "failed", reason: "outputTooLarge" },
      { status: "failed", reason: "busy" },
      { status: "failed", reason: "unknown" },
    ] as const;

    const messages = outcomes.map((outcome) =>
      remoteAddProjectLookupMessage({ status: "settled", outcome }, "gitlab"),
    );

    expect(messages.every((entry) => entry !== null)).toBe(true);
    expect(messages.every((entry) => (entry?.message.length ?? 0) <= 200)).toBe(true);
    expect(messages[0]?.remedy).toBe(
      "Access through the selected server's The GitLab CLI (glab) account is required.",
    );
    expect(messages[5]?.remedy).toBe("Try again in 45 seconds.");
    expect(messages[6]?.remedy).toBeNull();
    expect(new Set(messages.map((entry) => entry?.message)).size).toBe(11);
  });

  it("names the expected input shape when the entry is rejected", () => {
    expect(
      remoteAddProjectLookupMessage({ status: "rejectedInput", reason: "invalidPath" }, "gitlab")
        ?.message,
    ).toBe("Enter the repository as group/project.");
    expect(
      remoteAddProjectLookupMessage({ status: "rejectedInput", reason: "invalidUrl" }, "gitUrl")
        ?.remedy,
    ).toContain("without credentials");
    expect(remoteAddProjectEntryHint("gitUrl")).toContain("credentials");
    expect(remoteAddProjectEntryHint("github")).toContain("owner/repo");
  });

  it("explains every unavailable reason with a distinct truthful line", () => {
    const reasons = [
      "cliMissing",
      "notAuthenticated",
      "hostsFailed",
      "cloningUnsupported",
      "lookupUnavailable",
    ] as const;

    const messages = reasons.map((reason) => remoteAddProjectSourceReason("gitlab", reason));

    expect(messages).toEqual([
      "The GitLab CLI (glab) was not found on the selected server. Install `glab`, then retry.",
      "The GitLab CLI (glab) is not logged in to any host. Run `glab auth login` in a terminal, then retry.",
      "The GitLab CLI (glab) host check did not finish.",
      "This server cannot clone repositories.",
      "Repository lookup is unavailable in this build.",
    ]);
    expect(remoteAddProjectSourceReason("github", "cliMissing")).toBe(
      "The GitHub CLI (gh) was not found on the selected server. Install `gh`, then retry.",
    );
    expect(remoteAddProjectSourceReason("serverProject", "cloningUnsupported")).toBe(
      "This server cannot clone repositories.",
    );
  });

  it("titles and describes every source", () => {
    const kinds: readonly RemoteProjectSourceKind[] = [
      "serverProject",
      "gitUrl",
      "github",
      "gitlab",
    ];

    expect(kinds.map(remoteAddProjectSourceTitle)).toEqual([
      "Server project",
      "Git URL",
      "GitHub repository",
      "GitLab repository",
    ]);
    expect(new Set(kinds.map(remoteAddProjectSourceDescription)).size).toBe(4);
  });

  it("labels every visibility and both providers", () => {
    expect(
      (["public", "private", "internal", "unknown"] as const).map(remoteAddProjectVisibilityLabel),
    ).toEqual(["Public", "Private", "Internal", "Visibility unknown"]);
    expect(remoteAddProjectProviderLabel("github")).toBe("GitHub");
    expect(remoteAddProjectProviderLabel("gitlab")).toBe("GitLab");
    expect(remoteAddProjectPathHint("github")).toBe("owner/repo");
    expect(remoteAddProjectPathHint("gitlab")).toBe("group/project");
  });

  it("explains both folder name errors", () => {
    expect(remoteAddProjectNameErrorMessage("taken")).toContain("already on the server");
    expect(remoteAddProjectNameErrorMessage("invalid")).toContain("64 characters");
  });

  it("names every clone status", () => {
    expect(
      (["queued", "running", "succeeded", "failed", "interrupted", "cancelled"] as const).map(
        (status) => remoteAddProjectCloneStatusText(status),
      ),
    ).toEqual([
      "Queued on the server",
      "Cloning on the server",
      "Clone finished",
      "Clone failed",
      "Clone interrupted",
      "Clone cancelled",
    ]);
  });
});
