import { invoke } from "@tauri-apps/api/core";
import type { HtmlFilePreviewHandle } from "../application/htmlFilePreviewPort";

interface HtmlFilePreviewRequest {
  readonly workspaceId: string;
  readonly relativePath: string;
  readonly html: string;
}

type InvokePreview = (
  command: string,
  args: { readonly request: Readonly<Record<string, string>> },
) => Promise<unknown>;

const encoder = new TextEncoder();

function validateRequest(request: HtmlFilePreviewRequest): void {
  const { workspaceId, relativePath, html } = request;
  if (
    Object.keys(request).length !== 3 ||
    typeof workspaceId !== "string" ||
    workspaceId.length === 0 ||
    workspaceId.length > 1024 ||
    workspaceId.includes("\0") ||
    encoder.encode(workspaceId).byteLength > 1024 ||
    typeof relativePath !== "string" ||
    relativePath.length > 4096 ||
    encoder.encode(relativePath).byteLength > 4096 ||
    /[\\\0:]/.test(relativePath) ||
    relativePath.split("/").some((part) => part === "" || part === "." || part === "..") ||
    !/\.html?$/i.test(relativePath) ||
    typeof html !== "string" ||
    html.length === 0 ||
    html.length > 2 * 1024 * 1024 ||
    html.includes("\0") ||
    encoder.encode(html).byteLength > 2 * 1024 * 1024
  )
    throw new Error("Invalid HTML file preview request.");
}

function parseHandle(value: unknown): { readonly token: string; readonly url: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Invalid HTML file preview response.");
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 2 ||
    typeof record.token !== "string" ||
    !/^[a-f0-9]{64}$/.test(record.token) ||
    typeof record.url !== "string" ||
    ![
      `codevo-artifact-preview://localhost/${record.token}/index.html`,
      `http://codevo-artifact-preview.localhost/${record.token}/index.html`,
    ].includes(record.url)
  )
    throw new Error("Invalid HTML file preview response.");
  return { token: record.token, url: record.url };
}

/** Native snapshots isolate executable HTML and its assets from the editor origin. */
export class TauriHtmlFilePreviewGateway {
  constructor(private readonly invokeCommand: InvokePreview = invoke) {}

  async prepare(request: HtmlFilePreviewRequest): Promise<HtmlFilePreviewHandle> {
    validateRequest(request);
    const handle = parseHandle(
      await this.invokeCommand("workspace_html_preview_create", { request: { ...request } }),
    );
    let disposal: Promise<void> | undefined;
    return {
      url: handle.url,
      dispose: (): Promise<void> => {
        disposal ??= this.invokeCommand("artifact_preview_revoke", {
          request: { token: handle.token },
        }).then(() => undefined);
        return disposal;
      },
    };
  }
}
