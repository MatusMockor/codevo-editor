import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { WindowZoomGateway } from "../application/windowZoomGateway";

export const tauriWindowZoomGateway: WindowZoomGateway = {
  async setScale(scale) {
    if (isTauri()) {
      await getCurrentWebview().setZoom(scale);
      window.dispatchEvent(new Event("resize"));
      return;
    }
    document.documentElement.style.zoom = String(scale);
    window.dispatchEvent(new Event("resize"));
  },
};
