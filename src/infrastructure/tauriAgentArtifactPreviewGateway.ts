import { invoke } from "@tauri-apps/api/core";
import type { AgentArtifactPreviewPort } from "../application/agentArtifactPorts";
import { AGENT_ARTIFACT_HTML_LIMIT } from "../domain/agentArtifact";

type InvokePreview = (
  command: string,
  args: { readonly request: Readonly<Record<string, string>> },
) => Promise<unknown>;

function parseHandle(value: unknown): { readonly token: string; readonly url: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Invalid preview response.");
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 2 ||
    typeof record.token !== "string" ||
    !/^[a-f0-9]{64}$/.test(record.token) ||
    typeof record.url !== "string" ||
    ![
      `codevo-artifact-preview://localhost/${record.token}`,
      `http://codevo-artifact-preview.localhost/${record.token}`,
    ].includes(record.url)
  )
    throw new Error("Invalid preview response.");
  return { token: record.token, url: record.url };
}

/** Native isolation keeps generated scripts outside the editor's origin and CSP. */
export class TauriAgentArtifactPreviewGateway implements AgentArtifactPreviewPort {
  constructor(private readonly invokeCommand: InvokePreview = invoke) {}

  async prepare(bytes: ArrayBuffer) {
    if (bytes.byteLength === 0 || bytes.byteLength > AGENT_ARTIFACT_HTML_LIMIT)
      throw new Error("HTML preview is empty or exceeds 2 MiB.");
    const html = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (html.includes("\0")) throw new Error("Invalid HTML preview.");
    const handle = parseHandle(
      await this.invokeCommand("artifact_preview_create", { request: { html } }),
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
