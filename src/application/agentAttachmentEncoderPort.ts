/** Supplies bounded asynchronous encoding without a JavaScript binary-string loop. */
export interface AgentAttachmentEncoderPort {
  encode(bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal): Promise<string>;
}

export const MAX_AGENT_ATTACHMENT_ENCODING_BYTES = 5 * 1024 * 1024;
