/** Captures the current document and bounded sibling assets under the exact workspace owner. */
export interface HtmlFilePreviewPort {
  prepare(path: string): Promise<HtmlFilePreviewHandle>;
}

export interface HtmlFilePreviewHandle {
  readonly url: string;
  dispose(): Promise<void>;
}
