import { describe, expect, it } from "vitest";
import {
  carriesCredentials,
  looksLikeCloneSource,
  resolveCloneRepositoryInput,
} from "./cloneRepositoryInput";

describe("resolveCloneRepositoryInput", () => {
  it("accepts HTTPS and SSH clone URLs as typed", () => {
    expect(
      resolveCloneRepositoryInput(" https://github.com/acme/web-dashboard.git ", null),
    ).toEqual({
      kind: "ok",
      url: "https://github.com/acme/web-dashboard.git",
      identity: { host: "github.com", path: "acme/web-dashboard" },
      transport: "https",
      shorthand: false,
    });
    expect(resolveCloneRepositoryInput("git@gitlab.com:group/sub/project.git", null)).toMatchObject(
      {
        kind: "ok",
        identity: { host: "gitlab.com", path: "group/sub/project" },
        transport: "ssh",
      },
    );
    expect(
      resolveCloneRepositoryInput("ssh://git@git.example.com:2222/a/b.git", null),
    ).toMatchObject({
      kind: "ok",
      transport: "ssh",
    });
  });

  it("expands a bare host path to HTTPS", () => {
    expect(resolveCloneRepositoryInput("github.com/acme/web-dashboard", null)).toMatchObject({
      kind: "ok",
      url: "https://github.com/acme/web-dashboard",
      transport: "https",
      shorthand: false,
    });
  });

  it("expands owner/repo only when a shorthand host is available", () => {
    expect(resolveCloneRepositoryInput("acme/web-dashboard", "github.com")).toEqual({
      kind: "ok",
      url: "https://github.com/acme/web-dashboard.git",
      identity: { host: "github.com", path: "acme/web-dashboard" },
      transport: "https",
      shorthand: true,
    });
    expect(resolveCloneRepositoryInput("acme/web-dashboard", null)).toEqual({ kind: "invalid" });
  });

  it("rejects credential-bearing URLs", () => {
    for (const value of [
      "https://ghp_secret@github.com/acme/repo.git",
      "https://ghp_x@github.com/a/b.git",
      "https://user:pass@example.com/a/b",
      "https://user:pw@host/a/b",
      "http://token@host.example/a/b",
      "ssh://git:secret@github.com/acme/repo.git",
      "HTTPS://ghp_x@github.com/a/b.git",
      "  https://ghp_x@github.com/a/b.git  ",
    ]) {
      expect(resolveCloneRepositoryInput(value, "github.com")).toEqual({ kind: "credentials" });
      expect(resolveCloneRepositoryInput(value, null)).toEqual({ kind: "credentials" });
      expect(looksLikeCloneSource(value)).toBe(true);
    }
    expect(carriesCredentials("ssh://git@github.com/acme/repo.git")).toBe(false);
    expect(carriesCredentials("git@github.com:acme/repo.git")).toBe(false);
    expect(carriesCredentials("https://github.com/acme/repo.git")).toBe(false);
  });

  it("classifies empty, oversized and unsupported input", () => {
    expect(resolveCloneRepositoryInput("   ", "github.com")).toEqual({ kind: "empty" });
    expect(resolveCloneRepositoryInput("x".repeat(2049), "github.com")).toEqual({
      kind: "invalid",
    });
    for (const value of [
      "file:///tmp/repo",
      "ext::sh -c x",
      "http://github.com/a/b",
      "not a url",
      "../a/b",
    ]) {
      expect(resolveCloneRepositoryInput(value, "github.com")).toEqual({ kind: "invalid" });
    }
  });

  it("detects pasted clone sources in free text search", () => {
    expect(looksLikeCloneSource("https://github.com/a/b")).toBe(true);
    expect(looksLikeCloneSource("git@github.com:a/b.git")).toBe(true);
    expect(looksLikeCloneSource("github.com/a/b")).toBe(true);
    expect(looksLikeCloneSource("acme/web")).toBe(false);
    expect(looksLikeCloneSource("open folder")).toBe(false);
  });
});
