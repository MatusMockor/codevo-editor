// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ImageViewer } from "./ImageViewer";

describe("ImageViewer", () => {
  let host: HTMLDivElement | null = null;

  afterEach(() => host?.remove());

  it("renders the image data URL and actual-size information", async () => {
    host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<ImageViewer
        image={{
          path: "/workspace/photo.png",
          name: "photo.png",
          dataUrl: "data:image/png;base64,iVBORw==",
          byteLength: 1536,
        }}
        naturalWidth={640}
        naturalHeight={480}
      />));

    const image = host.querySelector("img");
    expect(image?.getAttribute("alt")).toBe("photo.png");
    expect(image?.getAttribute("src")).toBe("data:image/png;base64,iVBORw==");
    expect(host.textContent).toContain("640 × 480");
    expect(host.textContent).toContain("1.5 KiB");
    await act(async () => root.unmount());
  });
});
