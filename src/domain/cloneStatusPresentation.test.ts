import { describe, expect, it } from "vitest";
import {
  cloneFailureDetail,
  cloneProgressSummary,
  overallClonePercent,
} from "./cloneStatusPresentation";
import { LOCAL_CLONE_FAILURES } from "./localProjectClone";

describe("clone status presentation", () => {
  it("maps phases to one monotonic overall track", () => {
    expect(overallClonePercent(null)).toBe(0);
    expect(
      overallClonePercent({
        phase: "counting",
        percent: 100,
        receivedBytes: null,
        bytesPerSecond: null,
      }),
    ).toBe(4);
    expect(
      overallClonePercent({
        phase: "receiving",
        percent: 50,
        receivedBytes: null,
        bytesPerSecond: null,
      }),
    ).toBe(45);
    expect(
      overallClonePercent({
        phase: "resolving",
        percent: 0,
        receivedBytes: null,
        bytesPerSecond: null,
      }),
    ).toBe(82);
    expect(
      overallClonePercent({
        phase: "checkingOut",
        percent: 100,
        receivedBytes: null,
        bytesPerSecond: null,
      }),
    ).toBe(100);
  });

  it("summarizes progress with transfer details", () => {
    expect(cloneProgressSummary(null)).toBe("Starting");
    expect(
      cloneProgressSummary({
        phase: "receiving",
        percent: 45,
        receivedBytes: 28_730_982,
        bytesPerSecond: 5_242_880,
      }),
    ).toBe("Receiving objects · 45% · 27.4 MiB | 5.0 MiB/s");
    expect(
      cloneProgressSummary({
        phase: "resolving",
        percent: 30,
        receivedBytes: null,
        bytesPerSecond: null,
      }),
    ).toBe("Resolving deltas · 30%");
    expect(
      cloneProgressSummary({
        phase: "checkingOut",
        percent: 10,
        receivedBytes: null,
        bytesPerSecond: null,
      }),
    ).toBe("Checking out files · 10%");
  });

  it("words the ambiguous GitHub not-found or access case truthfully", () => {
    expect(cloneFailureDetail("authentication", "github.com")).toEqual({
      text: "Repository not found or access denied on github.com. If it is private, run",
      command: "gh auth login",
      tail: "in a terminal, or use an SSH URL.",
    });
    expect(cloneFailureDetail("notFound", "github.com")).toEqual({
      text: "Repository not found or access denied on github.com. Check the URL and your access.",
      command: null,
      tail: "",
    });
    expect(cloneFailureDetail("notFound", null).text).toBe(
      "Repository not found or access denied on the Git host. Check the URL and your access.",
    );
  });

  it("gives each failure kind actionable copy", () => {
    expect(cloneFailureDetail("authentication", "gitlab.example.com")).toEqual({
      text: "Authentication failed for gitlab.example.com. Run",
      command: "glab auth login",
      tail: "in a terminal, or use an SSH URL.",
    });
    expect(cloneFailureDetail("authentication", "git.example.com")).toEqual({
      text: "Authentication failed for git.example.com. Check your Git credentials, or use an SSH URL.",
      command: null,
      tail: "",
    });
    expect(cloneFailureDetail("network", "github.com").text).toBe(
      "Could not reach github.com. Check your connection, then retry.",
    );
    expect(cloneFailureDetail("other", null).text).toBe(
      "Git could not clone the repository. Check the address and your local Git setup, then retry.",
    );
  });

  it("uses plain hyphens and no em dash in any failure copy", () => {
    for (const failure of LOCAL_CLONE_FAILURES) {
      const detail = cloneFailureDetail(failure, "github.com");
      const copy = `${detail.text} ${detail.command ?? ""} ${detail.tail}`;
      expect(copy).not.toMatch(/[–—]/);
      expect(detail.text.length).toBeGreaterThan(0);
    }
  });
});
