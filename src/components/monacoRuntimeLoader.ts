export interface MonacoEnvironmentModule {
  configureMonacoEnvironment(): void;
}

export function createMonacoRuntimeLoader(
  loadEnvironment: () => Promise<MonacoEnvironmentModule>,
): () => Promise<void> {
  let initialization: Promise<void> | null = null;
  return () => {
    initialization ??= loadEnvironment()
      .then((environment) => {
        environment.configureMonacoEnvironment();
      })
      .catch((error: unknown) => {
        initialization = null;
        throw error;
      });
    return initialization;
  };
}

export const initializeMonacoRuntime = createMonacoRuntimeLoader(
  () => import("../infrastructure/monacoEnvironment"),
);
