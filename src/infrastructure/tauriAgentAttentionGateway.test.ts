import { describe, expect, it, vi } from "vitest";
import {
  MAX_AGENT_DOCK_BADGE_COUNT,
  TauriAgentAttentionGateway,
  type DockBadgeApi,
  type SystemNotificationApi,
} from "./tauriAgentAttentionGateway";

function fakes(options: { granted?: boolean; answer?: NotificationPermission } = {}) {
  const notifications: SystemNotificationApi = {
    isPermissionGranted: vi.fn(async () => options.granted ?? true),
    requestPermission: vi.fn(async () => options.answer ?? "granted"),
    sendNotification: vi.fn(),
  };
  const badge: DockBadgeApi = { setBadgeCount: vi.fn(async () => undefined) };
  const gateway = new TauriAgentAttentionGateway({
    runtimeAvailable: () => true,
    loadNotifications: async () => notifications,
    loadBadge: async () => badge,
  });
  return { gateway, notifications, badge };
}

describe("TauriAgentAttentionGateway", () => {
  it("sends a notification once permission is granted", async () => {
    const { gateway, notifications } = fakes();

    await expect(gateway.notify({ title: "Thread finished", body: "Fix · app" })).resolves.toBe(
      "delivered",
    );
    expect(notifications.sendNotification).toHaveBeenCalledWith({
      title: "Thread finished",
      body: "Fix · app",
    });
  });

  it("asks for permission once and remembers a refusal", async () => {
    const { gateway, notifications } = fakes({ granted: false, answer: "denied" });

    await expect(gateway.notify({ title: "a", body: "b" })).resolves.toBe("unavailable");
    await expect(gateway.notify({ title: "a", body: "b" })).resolves.toBe("unavailable");

    expect(notifications.requestPermission).toHaveBeenCalledTimes(1);
    expect(notifications.sendNotification).not.toHaveBeenCalled();
  });

  it("checks a refused permission again after the window regains focus", async () => {
    const { gateway, notifications } = fakes({ granted: false, answer: "denied" });
    await gateway.notify({ title: "a", body: "b" });
    vi.mocked(notifications.isPermissionGranted).mockResolvedValue(true);
    await expect(gateway.notify({ title: "a", body: "b" })).resolves.toBe("unavailable");

    gateway.recheckPermission();

    await expect(gateway.notify({ title: "a", body: "b" })).resolves.toBe("delivered");
  });

  it("shares one permission prompt between concurrent notifications", async () => {
    const { gateway, notifications } = fakes({ granted: false, answer: "granted" });

    await Promise.all([
      gateway.notify({ title: "a", body: "b" }),
      gateway.notify({ title: "c", body: "d" }),
    ]);

    expect(notifications.requestPermission).toHaveBeenCalledTimes(1);
    expect(notifications.sendNotification).toHaveBeenCalledTimes(2);
  });

  it("bounds notification text", async () => {
    const { gateway, notifications } = fakes();
    await gateway.notify({ title: "t".repeat(500), body: "b".repeat(500) });

    const sent = vi.mocked(notifications.sendNotification).mock.calls[0]?.[0];
    expect(Array.from(sent?.title ?? "").length).toBeLessThanOrEqual(120);
    expect(Array.from(sent?.body ?? "").length).toBeLessThanOrEqual(240);
  });

  it("applies badge counts in order, clamps them and clears with no label", async () => {
    const { gateway, badge } = fakes();

    await Promise.all([
      gateway.setBadgeCount(3),
      gateway.setBadgeCount(1_000),
      gateway.setBadgeCount(0),
    ]);

    expect(vi.mocked(badge.setBadgeCount).mock.calls).toEqual([
      [3],
      [MAX_AGENT_DOCK_BADGE_COUNT],
      [undefined],
    ]);
  });

  it("does nothing outside the desktop runtime", async () => {
    const loadNotifications = vi.fn();
    const loadBadge = vi.fn();
    const gateway = new TauriAgentAttentionGateway({
      runtimeAvailable: () => false,
      loadNotifications,
      loadBadge,
    });

    await expect(gateway.notify({ title: "a", body: "b" })).resolves.toBe("unavailable");
    await gateway.setBadgeCount(2);

    expect(loadNotifications).not.toHaveBeenCalled();
    expect(loadBadge).not.toHaveBeenCalled();
  });
});
