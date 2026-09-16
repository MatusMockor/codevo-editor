import { describe, expect, it, vi } from "vitest";
import { TauriAgentArtifactPreviewGateway } from "./tauriAgentArtifactPreviewGateway";
import { AGENT_ARTIFACT_HTML_LIMIT } from "../domain/agentArtifact";
const token = "a".repeat(64);
const url = `codevo-artifact-preview://localhost/${token}`;
const bytes = () => new TextEncoder().encode("<button>Hello</button>").buffer;

describe("TauriAgentArtifactPreviewGateway", () => {
  it("registers immutable HTML and disposes a lease at most once", async () => {
    const invoke = vi.fn().mockResolvedValueOnce({ token, url }).mockResolvedValue(null);
    const handle = await new TauriAgentArtifactPreviewGateway(invoke).prepare(bytes());
    expect(handle.url).toBe(url);
    expect(invoke).toHaveBeenCalledWith("artifact_preview_create", {
      request: { html: "<button>Hello</button>" },
    });
    await Promise.all([handle.dispose(), handle.dispose()]);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenLastCalledWith("artifact_preview_revoke", { request: { token } });
  });
  it("accepts the Windows custom scheme mapping", async () => {
    const mapped = `http://codevo-artifact-preview.localhost/${token}`;
    const invoke = vi.fn().mockResolvedValue({ token, url: mapped });
    expect((await new TauriAgentArtifactPreviewGateway(invoke).prepare(bytes())).url).toBe(mapped);
  });
  it.each([
    new ArrayBuffer(0),
    new ArrayBuffer(AGENT_ARTIFACT_HTML_LIMIT + 1),
    new Uint8Array([0xff]).buffer,
    new Uint8Array([0]).buffer,
  ])("rejects invalid bytes before IPC", async (invalid) => {
    const invoke = vi.fn();
    await expect(new TauriAgentArtifactPreviewGateway(invoke).prepare(invalid)).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
  it.each([
    null,
    { token, url: "https://example.com/" },
    { token, url: `${url}?secret=1` },
    { token, url, extra: true },
    { token: "foreign", url },
    { token, url: `http://codevo-artifact-preview.localhost.evil/${token}` },
  ])("rejects foreign and malformed native handles", async (response) => {
    const invoke = vi.fn().mockResolvedValue(response);
    await expect(new TauriAgentArtifactPreviewGateway(invoke).prepare(bytes())).rejects.toThrow(
      "Invalid preview response.",
    );
  });
});
