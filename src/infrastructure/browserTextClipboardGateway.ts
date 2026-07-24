import type { TextClipboardGateway } from "../domain/textClipboard";

export class BrowserTextClipboardGateway implements TextClipboardGateway {
  canWriteText(): boolean {
    return typeof navigator !== "undefined" && typeof navigator.clipboard?.writeText === "function";
  }

  writeText(text: string): Promise<void> {
    if (!this.canWriteText()) {
      return Promise.reject(new Error("Clipboard is unavailable."));
    }
    return navigator.clipboard.writeText(text);
  }
}
