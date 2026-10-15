import type { TerminalGateway, TerminalProfile } from "../domain/terminal";

interface TerminalProfileCatalogEntry {
  readonly request: Promise<readonly TerminalProfile[]>;
  profiles: readonly TerminalProfile[] | null;
}

const catalogs = new WeakMap<TerminalGateway, TerminalProfileCatalogEntry>();

export function cachedTerminalProfiles(
  gateway: TerminalGateway,
): readonly TerminalProfile[] | null {
  return catalogs.get(gateway)?.profiles ?? null;
}

export function loadTerminalProfiles(
  gateway: TerminalGateway,
): Promise<readonly TerminalProfile[]> {
  const existing = catalogs.get(gateway);
  if (existing) return existing.request;
  const request = gateway.listProfiles().then(
    (profiles) => {
      const snapshot = Object.freeze([...profiles]);
      if (catalogs.get(gateway) === entry) entry.profiles = snapshot;
      return snapshot;
    },
    (error: unknown) => {
      if (catalogs.get(gateway) === entry) catalogs.delete(gateway);
      throw error;
    },
  );
  const entry: TerminalProfileCatalogEntry = { profiles: null, request };
  catalogs.set(gateway, entry);
  return request;
}
