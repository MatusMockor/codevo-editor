import { isTauri } from "@tauri-apps/api/core";
import type {
  AgentSystemAttentionPort,
  AgentSystemNotification,
  AgentSystemNotificationOutcome,
} from "../application/agentThreadNotificationCenter";

export interface SystemNotificationApi {
  isPermissionGranted(): Promise<boolean>;
  requestPermission(): Promise<NotificationPermission>;
  sendNotification(options: { readonly title: string; readonly body: string }): void;
}

export interface DockBadgeApi {
  setBadgeCount(count?: number): Promise<void>;
}

export interface TauriAgentAttentionDependencies {
  readonly runtimeAvailable: () => boolean;
  readonly loadNotifications: () => Promise<SystemNotificationApi>;
  readonly loadBadge: () => Promise<DockBadgeApi>;
}

export const MAX_AGENT_DOCK_BADGE_COUNT = 99;
const MAX_SYSTEM_NOTIFICATION_TITLE_CHARS = 120;
const MAX_SYSTEM_NOTIFICATION_BODY_CHARS = 240;

type PermissionState = "unknown" | "granted" | "denied";

const DEFAULT_DEPENDENCIES: TauriAgentAttentionDependencies = {
  runtimeAvailable: isTauri,
  loadNotifications: () => import("@tauri-apps/plugin-notification"),
  loadBadge: async () => (await import("@tauri-apps/api/window")).getCurrentWindow(),
};

export class TauriAgentAttentionGateway implements AgentSystemAttentionPort {
  private permission: PermissionState = "unknown";
  private permissionRequest: Promise<boolean> | null = null;
  private badgeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly dependencies: TauriAgentAttentionDependencies = DEFAULT_DEPENDENCIES,
  ) {}

  async notify(notification: AgentSystemNotification): Promise<AgentSystemNotificationOutcome> {
    if (!this.dependencies.runtimeAvailable()) return "unavailable";
    const api = await this.dependencies.loadNotifications();
    if (!(await this.permitted(api))) return "unavailable";
    api.sendNotification({
      title: truncate(notification.title, MAX_SYSTEM_NOTIFICATION_TITLE_CHARS),
      body: truncate(notification.body, MAX_SYSTEM_NOTIFICATION_BODY_CHARS),
    });
    return "delivered";
  }

  recheckPermission(): void {
    if (this.permission === "denied") this.permission = "unknown";
  }

  setBadgeCount(count: number): Promise<void> {
    const bounded = Math.min(Math.max(0, Math.floor(count)), MAX_AGENT_DOCK_BADGE_COUNT);
    const next = this.badgeQueue.then(() => this.applyBadge(bounded));
    this.badgeQueue = next.catch(() => undefined);
    return next;
  }

  private async applyBadge(count: number): Promise<void> {
    if (!this.dependencies.runtimeAvailable()) return;
    const badge = await this.dependencies.loadBadge();
    await badge.setBadgeCount(count > 0 ? count : undefined);
  }

  private async permitted(api: SystemNotificationApi): Promise<boolean> {
    if (this.permission === "granted") return true;
    if (this.permission === "denied") return false;
    this.permissionRequest ??= this.resolvePermission(api).finally(() => {
      this.permissionRequest = null;
    });
    return this.permissionRequest;
  }

  private async resolvePermission(api: SystemNotificationApi): Promise<boolean> {
    if (await api.isPermissionGranted()) {
      this.permission = "granted";
      return true;
    }
    const answer = await api.requestPermission();
    this.permission = answer === "granted" ? "granted" : "denied";
    return this.permission === "granted";
  }
}

function truncate(value: string, limit: number): string {
  const characters = Array.from(value);
  if (characters.length <= limit) return value;
  return `${characters.slice(0, limit - 1).join("")}…`;
}
