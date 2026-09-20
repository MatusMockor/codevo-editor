import type { HtmlFilePreviewHandle } from "./htmlFilePreviewPort";

export interface HtmlFilePreviewGateway {
  prepare(request: {
    readonly workspaceId: string;
    readonly relativePath: string;
    readonly html: string;
  }): Promise<HtmlFilePreviewHandle>;
}
