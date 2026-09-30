import { describe, expect, it } from "vitest";
import { remoteAgentProjectKey, remoteAgentProjectServerId } from "./remoteAgentProjection";

describe("remoteAgentProjectServerId", () => {
  it("reads the server back from a canonical project key", () => {
    expect(remoteAgentProjectServerId(remoteAgentProjectKey("linux", "runner", "project"))).toBe(
      "linux",
    );
    expect(remoteAgentProjectServerId(remoteAgentProjectKey("build box:1", "run/ner", "p:1"))).toBe(
      "build box:1",
    );
  });

  it.each([
    ["a local root", "/workspace/app"],
    ["a thread key", "remote-thread:linux:runner:conversation"],
    ["too few parts", "remote:linux:runner"],
    ["an empty server", "remote::runner:project"],
    ["a non-canonical encoding", "remote:li%6Eux:runner:project"],
    ["a malformed escape", "remote:%E0%A4%A:runner:project"],
  ])("rejects %s", (_label, key) => {
    expect(remoteAgentProjectServerId(key)).toBeNull();
  });
});
