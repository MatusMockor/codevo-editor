import { describe, expect, it, vi } from "vitest";
import { PhpDiagnosticsReclassificationCoordinator } from "./phpDiagnosticsReclassificationCoordinator";

describe("PhpDiagnosticsReclassificationCoordinator", () => {
  it("settles an alias source warmup after a canonical-root diagnostics commit", () => {
    const coordinator = new PhpDiagnosticsReclassificationCoordinator();
    const reclassify = vi
      .fn<(rootPath: string, ownerKey: string) => boolean>()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);

    coordinator.sourcesLoaded("/selected-alias", "owner-a", reclassify);
    coordinator.diagnosticsCommitted("owner-a", reclassify);

    expect(reclassify.mock.calls).toEqual([
      ["/selected-alias", "owner-a"],
      ["/selected-alias", "owner-a"],
    ]);
  });

  it("keeps A → B → A owners isolated and uses A's latest accepted root", () => {
    const coordinator = new PhpDiagnosticsReclassificationCoordinator();
    const reclassify = vi.fn(() => false);

    coordinator.sourcesLoaded("/a-old", "owner-a", reclassify);
    coordinator.sourcesLoaded("/b", "owner-b", reclassify);
    coordinator.sourcesLoaded("/a-current", "owner-a", reclassify);
    reclassify.mockClear();

    coordinator.diagnosticsCommitted("owner-b", reclassify);
    coordinator.diagnosticsCommitted("owner-a", reclassify);

    expect(reclassify.mock.calls).toEqual([
      ["/b", "owner-b"],
      ["/a-current", "owner-a"],
    ]);
  });

  it("bounds pending owners with deterministic oldest-first eviction", () => {
    const coordinator = new PhpDiagnosticsReclassificationCoordinator(2);
    const reclassify = vi.fn(() => false);
    coordinator.sourcesLoaded("/a", "owner-a", reclassify);
    coordinator.sourcesLoaded("/b", "owner-b", reclassify);
    coordinator.sourcesLoaded("/c", "owner-c", reclassify);
    reclassify.mockClear();

    coordinator.diagnosticsCommitted("owner-a", reclassify);
    coordinator.diagnosticsCommitted("owner-b", reclassify);
    coordinator.diagnosticsCommitted("owner-c", reclassify);

    expect(reclassify.mock.calls).toEqual([
      ["/b", "owner-b"],
      ["/c", "owner-c"],
    ]);
  });
});
