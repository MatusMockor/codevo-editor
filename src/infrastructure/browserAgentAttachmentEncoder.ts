import {
  MAX_AGENT_ATTACHMENT_ENCODING_BYTES,
  type AgentAttachmentEncoderPort,
} from "../application/agentAttachmentEncoderPort";

const MAX_ACTIVE_ENCODINGS = 8;
const ENCODING_TIMEOUT_MS = 30_000;
const DATA_URL_PREFIX = "data:application/octet-stream;base64,";

/** Native asynchronous Blob reading replaces the large JavaScript binary-string loop. */
export class BrowserAgentAttachmentEncoder implements AgentAttachmentEncoderPort {
  private active = 0;

  constructor(private readonly createReader: () => FileReader = () => new FileReader()) {}

  async encode(bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal): Promise<string> {
    if (bytes.byteLength < 1 || bytes.byteLength > MAX_AGENT_ATTACHMENT_ENCODING_BYTES)
      throw new Error("Attachment encoding requires between one byte and 5 MiB.");
    if (signal.aborted) throw new Error("Attachment encoding was cancelled.");
    if (this.active >= MAX_ACTIVE_ENCODINGS)
      throw new Error("Attachment encoding is busy. Retry the message.");
    this.active += 1;
    try {
      return await this.read(bytes, signal);
    } finally {
      this.active -= 1;
    }
  }

  private read(bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = this.createReader();
      let settled = false;
      const cleanup = () => {
        clearTimeout(timeout);
        signal.removeEventListener("abort", cancel);
        reader.onload = null;
        reader.onerror = null;
        reader.onabort = null;
      };
      const fail = (message: string, abort: boolean) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (abort && reader.readyState === FileReader.LOADING) reader.abort();
        reject(new Error(message));
      };
      const cancel = () => fail("Attachment encoding was cancelled.", true);
      const timeout = setTimeout(
        () => fail("Attachment encoding timed out. Retry the message.", true),
        ENCODING_TIMEOUT_MS,
      );
      signal.addEventListener("abort", cancel, { once: true });
      reader.onerror = () => fail("The attachment could not be encoded.", false);
      reader.onabort = () => fail("Attachment encoding was cancelled.", false);
      reader.onload = () => {
        if (settled) return;
        const result = reader.result;
        const expectedLength = Math.ceil(bytes.byteLength / 3) * 4;
        if (
          typeof result !== "string" ||
          !result.startsWith(DATA_URL_PREFIX) ||
          result.length !== DATA_URL_PREFIX.length + expectedLength
        ) {
          fail("The attachment encoder returned invalid data.", false);
          return;
        }
        settled = true;
        cleanup();
        resolve(result.slice(DATA_URL_PREFIX.length));
      };
      try {
        reader.readAsDataURL(new Blob([bytes], { type: "application/octet-stream" }));
      } catch {
        fail("The attachment could not be encoded.", true);
      }
    });
  }
}
