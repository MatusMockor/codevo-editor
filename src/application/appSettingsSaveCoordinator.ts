import type { AppSettings, SettingsGateway } from "../domain/settings";

export interface AppSettingsSaveCoordinator {
  committedSnapshot(): AppSettings | null;
  initializeCommittedSnapshot(settings: AppSettings): void;
  save(
    initialCommittedSettings: AppSettings,
    mutation: (committed: AppSettings) => AppSettings,
  ): Promise<AppSettings>;
}

const coordinators = new WeakMap<object, AppSettingsSaveCoordinator>();

export function appSettingsSaveCoordinatorFor(
  gateway: Pick<SettingsGateway, "saveAppSettings">,
): AppSettingsSaveCoordinator {
  const key = gateway as object;
  const existing = coordinators.get(key);
  if (existing) return existing;
  let tail = Promise.resolve();
  let committed: AppSettings | null = null;
  const coordinator: AppSettingsSaveCoordinator = {
    committedSnapshot: () => committed,
    initializeCommittedSnapshot(settings) {
      if (committed === null) committed = settings;
    },
    save(initialCommittedSettings, mutation) {
      coordinator.initializeCommittedSnapshot(initialCommittedSettings);
      const operation = tail.then(async () => {
        const candidate = mutation(committed ?? initialCommittedSettings);
        await gateway.saveAppSettings(candidate);
        committed = candidate;
        return candidate;
      });
      tail = operation.then(
        () => undefined,
        () => undefined,
      );
      return operation;
    },
  };
  coordinators.set(key, coordinator);
  return coordinator;
}
