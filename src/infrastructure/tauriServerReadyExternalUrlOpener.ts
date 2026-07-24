import {
  validateDebugServerReadyLoopbackUrl,
  type DebugServerReadyExternalUrlOpener,
  type DebugServerReadyLoopbackUrl,
} from "../domain/debugServerReadyUrl";

export const DEBUG_SERVER_READY_OPEN_FAILED = "Unable to open the server URL.";

type OpenUrl = (url: string) => Promise<void>;

const openWithTauri: OpenUrl = async (url) => {
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
};

/**
 * Desktop adapter for the narrow server-ready opener port.
 *
 * The domain brand protects ordinary callers; the repeated runtime validation fails closed if an
 * untyped boundary or future refactor supplies a forged value.
 */
export class TauriServerReadyExternalUrlOpener
  implements DebugServerReadyExternalUrlOpener
{
  constructor(private readonly openUrl: OpenUrl = openWithTauri) {}

  async openExternal(url: DebugServerReadyLoopbackUrl): Promise<void> {
    const validated = validateDebugServerReadyLoopbackUrl(url);
    if (validated.kind !== "valid") throw new Error(DEBUG_SERVER_READY_OPEN_FAILED);

    try {
      await this.openUrl(validated.url);
    } catch {
      throw new Error(DEBUG_SERVER_READY_OPEN_FAILED);
    }
  }
}
