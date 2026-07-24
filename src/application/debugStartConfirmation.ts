import type { DebugGateway } from "../domain/debug";
import type { DebugStartDescriptor } from "./debugStartDescriptor";

export interface DebugStartConfirmationRequest {
  readonly descriptor: DebugStartDescriptor;
  readonly gateway: Pick<DebugGateway, "stop">;
  readonly isAuthorized: () => boolean;
  readonly isMounted: () => boolean;
  readonly rootPath: string;
  readonly sessionId: number;
  readonly takeStopRequest: () => boolean;
}

/**
 * Completes the second phase of a capability-bearing debug start.
 *
 * The backend start response deliberately precedes confirmation. Every editor
 * authority that admitted phase one is checked both before and after the await,
 * and Stop is consumed on both sides as well. This prevents a Stop, dirty
 * buffer, workspace switch, or expired clean-target lease from racing the
 * confirmation response into session adoption.
 */
export async function confirmDebugStart(request: DebugStartConfirmationRequest): Promise<boolean> {
  if (!stillAuthorized(request)) {
    await compensateStart(request);
    return false;
  }

  const confirm = request.descriptor.confirmStart;
  if (confirm) {
    try {
      await confirm(request.rootPath, request.sessionId);
    } catch {
      await compensateStart(request);
      return false;
    }
  }

  if (!stillAuthorized(request)) {
    await compensateStart(request);
    return false;
  }
  return true;
}

function stillAuthorized(request: DebugStartConfirmationRequest): boolean {
  return request.isMounted() && !request.takeStopRequest() && request.isAuthorized();
}

async function compensateStart(request: DebugStartConfirmationRequest): Promise<void> {
  await request.gateway.stop(request.sessionId);
}
