import { describe, expect, it, vi } from "vitest";
import { TauriHtmlFilePreviewGateway } from "./tauriHtmlFilePreviewGateway";

const token = "a".repeat(64);
const url = `codevo-artifact-preview://localhost/${token}/index.html`;
const request = {
  workspaceId: "workspace-a",
  relativePath: "web/index.html",
  html: "<h1>Hello</h1>",
};

describe("TauriHtmlFilePreviewGateway", () => {
  it("captures the unsaved HTML with its exact workspace and path and revokes once", async () => {
    const invoke = vi.fn().mockResolvedValueOnce({ token, url }).mockResolvedValue(null);
    const handle = await new TauriHtmlFilePreviewGateway(invoke).prepare(request);
    expect(handle.url).toBe(url);
    expect(invoke).toHaveBeenCalledWith("workspace_html_preview_create", { request });
    await Promise.all([handle.dispose(), handle.dispose()]);
    await handle.dispose();
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenLastCalledWith("artifact_preview_revoke", { request: { token } });
  });

  it("accepts Windows mapping and mixed case HTML extensions", async () => {
    const mapped = `http://codevo-artifact-preview.localhost/${token}/index.html`;
    const invoke = vi.fn().mockResolvedValue({ token, url: mapped });
    const handle = await new TauriHtmlFilePreviewGateway(invoke).prepare({
      ...request,
      relativePath: "site/Index.HTM",
    });
    expect(handle.url).toBe(mapped);
  });

  it.each([
    { workspaceId: "" },
    { workspaceId: "a".repeat(1025) },
    { workspaceId: "é".repeat(513) },
    { workspaceId: "a\0b" },
    { relativePath: "" },
    { relativePath: "/index.html" },
    { relativePath: "../index.html" },
    { relativePath: "web/../index.html" },
    { relativePath: "./index.html" },
    { relativePath: "web//index.html" },
    { relativePath: "web\\index.html" },
    { relativePath: "C:/index.html" },
    { relativePath: "web/\0index.html" },
    { relativePath: "a".repeat(4096) + ".html" },
    { relativePath: "é".repeat(2048) + ".html" },
    { relativePath: "index.txt" },
    { relativePath: "index.html?query" },
    { html: "" },
    { html: "\0" },
    { html: "a".repeat(2 * 1024 * 1024 + 1) },
    { html: "é".repeat(1024 * 1024 + 1) },
    { unknown: "field" },
  ])("rejects invalid request before IPC", async (invalid) => {
    const invoke = vi.fn();
    await expect(
      new TauriHtmlFilePreviewGateway(invoke).prepare({ ...request, ...invalid }),
    ).rejects.toThrow("Invalid HTML file preview request.");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("accepts the exact UTF-8 payload limit", async () => {
    const invoke = vi.fn().mockResolvedValue({ token, url });
    await expect(
      new TauriHtmlFilePreviewGateway(invoke).prepare({
        ...request,
        html: "é".repeat(1024 * 1024),
      }),
    ).resolves.toMatchObject({ url });
  });

  it.each([
    null,
    [],
    { token, url, extra: true },
    { token: "foreign", url },
    { token, url: `codevo-artifact-preview://localhost/${"b".repeat(64)}/index.html` },
    { token, url: `codevo-artifact-preview://localhost/${token}` },
    { token, url: `${url}?secret=1` },
    { token, url: `${url}#fragment` },
    { token, url: `http://codevo-artifact-preview.localhost.evil/${token}/index.html` },
    { token, url: "https://example.com/index.html" },
  ])("rejects foreign or malformed handles: %j", async (response) => {
    const invoke = vi.fn().mockResolvedValue(response);
    await expect(new TauriHtmlFilePreviewGateway(invoke).prepare(request)).rejects.toThrow(
      "Invalid HTML file preview response.",
    );
  });

  it("propagates preparation and revocation failures and does not revoke twice", async () => {
    const invoke = vi.fn().mockRejectedValueOnce(new Error("Workspace closed"));
    const gateway = new TauriHtmlFilePreviewGateway(invoke);
    await expect(gateway.prepare(request)).rejects.toThrow("Workspace closed");
    invoke.mockResolvedValueOnce({ token, url }).mockRejectedValue(new Error("Disconnected"));
    const handle = await gateway.prepare(request);
    await expect(handle.dispose()).rejects.toThrow("Disconnected");
    await expect(handle.dispose()).rejects.toThrow("Disconnected");
    expect(invoke).toHaveBeenCalledTimes(3);
  });
});
