import { describe, expect, it } from "vitest";
import { canonicalRepositoryIdentity } from "./repositoryIdentity";

describe("repository identity", () => {
  it("groups credential-free equivalent protocols and preserves private forge casing and ports", () => {
    for (const raw of [
      "git@github.com:Org/Repo.git",
      "https://secret:password@GitHub.com/Org/Repo.git/",
      "ssh://git@github.com:22/Org/Repo",
    ])
      expect(canonicalRepositoryIdentity(raw)).toBe("github.com/org/repo");
    expect(canonicalRepositoryIdentity("ssh://git@git.example.com:2222/Team/Repo.git")).toBe(
      "git.example.com:2222/Team/Repo",
    );
  });
  it("rejects local, ambiguous, secret query and unsafe paths", () => {
    for (const raw of [
      "/tmp/repo",
      "file:///tmp/repo",
      "https://git.example.com/a/../b",
      "https://git.example.com/a?secret=x",
      "https://git.example.com/a#token",
      "https://git.example.com//a",
      "https://git.example.com:0/a",
      "https://git.example.com/a%2fb",
      "https://git.example.com/a\nb",
      "x:repo",
      "x".repeat(2049),
    ])
      expect(canonicalRepositoryIdentity(raw)).toBeNull();
  });
});
