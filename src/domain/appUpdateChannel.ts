export const APP_UPDATE_CHANNELS = ["stable", "beta"] as const;
export type AppUpdateChannel = (typeof APP_UPDATE_CHANNELS)[number];

export const DEFAULT_APP_UPDATE_CHANNEL: AppUpdateChannel = "beta";

export const APP_UPDATE_CHANNEL_LABELS: Readonly<Record<AppUpdateChannel, string>> = {
  stable: "Stable",
  beta: "Beta",
};

export function isAppUpdateChannel(value: unknown): value is AppUpdateChannel {
  return value === "stable" || value === "beta";
}

export function normalizeAppUpdateChannel(value: unknown): AppUpdateChannel {
  if (isAppUpdateChannel(value)) return value;
  return DEFAULT_APP_UPDATE_CHANNEL;
}
