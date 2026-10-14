import { windowZoomFactor } from "../domain/windowZoom";
import type { WindowZoomGateway } from "./windowZoomGateway";

export class WindowZoomApplication {
  private desiredLevel: number | null = null;
  private running = false;
  private disposed = false;

  constructor(
    private readonly gateway: WindowZoomGateway,
    private readonly reportError: (error: unknown) => void,
  ) {}

  applyLevel(level: number): void {
    if (this.disposed) return;
    this.desiredLevel = level;
    if (this.running) return;
    void this.flush();
  }

  dispose(): void {
    this.disposed = true;
    this.desiredLevel = null;
  }

  private async flush(): Promise<void> {
    this.running = true;
    while (!this.disposed && this.desiredLevel !== null) {
      const level = this.desiredLevel;
      this.desiredLevel = null;
      try {
        await this.gateway.setScale(windowZoomFactor(level));
      } catch (error) {
        if (!this.disposed && this.desiredLevel === null) this.reportError(error);
      }
    }
    this.running = false;
  }
}
