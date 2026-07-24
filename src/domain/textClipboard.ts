export interface TextClipboardGateway {
  canWriteText(): boolean;
  writeText(text: string): Promise<void>;
}
