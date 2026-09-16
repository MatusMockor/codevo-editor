import { describe, expect, it } from "vitest";
import { parseRemoteAgentThreadIdentity } from "./remoteAgentIdentity";

describe("remote conversation identity", () => {
  it("retains encoded server identity independently of loaded inventory", () => {
    expect(
      parseRemoteAgentThreadIdentity("remote-thread:linux%3Ahome:runner:conversation"),
    ).toEqual({
      serverId: "linux:home",
      runnerId: "runner",
      conversationId: "conversation",
    });
  });
  it.each([
    null,
    "local",
    "remote-thread:a:b",
    "remote-thread:a:b:c:d",
    "remote-thread::b:c",
    "remote-thread:%ZZ:b:c",
    "remote-thread:%61:b:c",
    "remote-thread:" + "x".repeat(4096),
  ])("rejects invalid identities: %s", (value) => {
    expect(parseRemoteAgentThreadIdentity(value)).toBeNull();
  });
});
