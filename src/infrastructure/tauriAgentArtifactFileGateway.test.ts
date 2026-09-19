import { describe, expect, it, vi } from "vitest";
import type { AgentArtifactOwner } from "../application/agentArtifactPorts";
import {
  parseAgentArtifactFileLocation,
  TauriAgentArtifactFileGateway,
  AGENT_ARTIFACT_FILE_NOT_LOCAL,
} from "./tauriAgentArtifactFileGateway";

const owner: AgentArtifactOwner = {
  kind: "local",
  rootKey: "/workspace/app",
  ownerId: "owner",
  repositoryRoot: "/workspace/app",
  threadId: "agt-1-0a1b",
  turnId: "agt-2-0a1b",
};
const remote: AgentArtifactOwner = {
  kind: "remote",
  serverId: "server",
  runnerId: "runner",
  taskId: "6f1d2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b",
};
const location = { filePath: "/workspace/app/docs/design/page.html" };
const request = {
  workspaceId: "owner",
  threadId: "agt-1-0a1b",
  turnId: "agt-2-0a1b",
  path: "docs/design/page.html",
};

describe("TauriAgentArtifactFileGateway", () => {
  it("sends only the registered owner and the workspace-relative reference", async () => {
    const invokeCommand = vi.fn().mockResolvedValue(location);
    const gateway = new TauriAgentArtifactFileGateway(invokeCommand);

    await expect(gateway.locate(owner, "docs/design/page.html")).resolves.toEqual(location);
    expect(invokeCommand).toHaveBeenCalledWith("locate_agent_output_artifact_file", { request });
  });

  it("reveals through the native command instead of computing a root path", async () => {
    const invokeCommand = vi.fn().mockResolvedValue(null);
    const gateway = new TauriAgentArtifactFileGateway(invokeCommand);

    await expect(gateway.reveal(owner, "docs/design/page.html")).resolves.toBeUndefined();
    expect(invokeCommand).toHaveBeenCalledTimes(1);
    expect(invokeCommand).toHaveBeenCalledWith("reveal_agent_output_artifact_file", { request });
  });

  it("never sends an absolute path or a traversal from the DOM", async () => {
    const invokeCommand = vi.fn().mockResolvedValue(location);
    const gateway = new TauriAgentArtifactFileGateway(invokeCommand);

    await expect(gateway.locate(owner, "/etc/passwd.html")).rejects.toThrow(
      "Invalid artifact path",
    );
    await expect(gateway.locate(owner, "../../secret.html")).rejects.toThrow(
      "Invalid artifact path",
    );
    await expect(gateway.locate(owner, "file:///tmp/x.html")).rejects.toThrow(
      "Invalid artifact path",
    );
    await expect(gateway.reveal(owner, "/etc/passwd.html")).rejects.toThrow(
      "Invalid artifact path",
    );
    await expect(gateway.reveal(owner, "../../secret.html")).rejects.toThrow(
      "Invalid artifact path",
    );
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("refuses a remote owner", async () => {
    const invokeCommand = vi.fn();
    const gateway = new TauriAgentArtifactFileGateway(invokeCommand);

    await expect(gateway.locate(remote, "page.html")).rejects.toThrow(
      AGENT_ARTIFACT_FILE_NOT_LOCAL,
    );
    await expect(gateway.reveal(remote, "page.html")).rejects.toThrow(
      AGENT_ARTIFACT_FILE_NOT_LOCAL,
    );
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("accepts only an absolute file path and nothing else", () => {
    expect(parseAgentArtifactFileLocation(location)).toEqual(location);
    expect(() =>
      parseAgentArtifactFileLocation({ ...location, rootPath: "/workspace/app" }),
    ).toThrow("Invalid artifact location.");
    expect(() => parseAgentArtifactFileLocation({ filePath: "relative.html" })).toThrow(
      "Invalid artifact location.",
    );
    expect(() => parseAgentArtifactFileLocation(null)).toThrow("Invalid artifact location.");
    expect(() => parseAgentArtifactFileLocation({ filePath: "/a/bad\u0000.html" })).toThrow(
      "Invalid artifact location.",
    );
  });
});
