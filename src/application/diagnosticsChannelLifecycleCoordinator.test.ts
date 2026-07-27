import { describe, expect, it, vi } from "vitest";
import type { DiagnosticsCoalescer } from "../domain/diagnosticsCoalescer";
import { createWorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import { createDiagnosticsChannelLifecycleCoordinator } from "./diagnosticsChannelLifecycleCoordinator";
import {
  diagnosticsOwnerLifecycleKey,
  type DiagnosticsChannelKind,
} from "./diagnosticsOwnerIdentity";
import { DiagnosticsOwnerLifecycleStore } from "./diagnosticsOwnerLifecycleStore";

describe.each(["php", "typescript"] as const)(
  "%s diagnostics channel lifecycle",
  (kind: DiagnosticsChannelKind) => {
    it("shares exact-owner prepare, reset, and close policy", () => {
      const lifecycleStore = new DiagnosticsOwnerLifecycleStore();
      const clearVisibleDiagnostics = vi.fn();
      const clearUriCapacity = vi.fn();
      const reportOwnerCapacity = vi.fn();
      const dropOwner = vi.fn();
      const dropRoot = vi.fn();
      const owner = createWorkspaceRuntimeOwner("workspace-owner", "/workspace");
      const lifecycleKey = diagnosticsOwnerLifecycleKey(kind, owner.ownerKey);
      const cacheByOwnerRef = {
        current: {
          [owner.ownerKey]: {
            "/workspace/file.ts": [],
          },
        },
      };
      const coordinator = createDiagnosticsChannelLifecycleCoordinator({
        cacheByOwnerRef,
        clearUriCapacity,
        clearVisibleDiagnostics,
        coalescerRef: {
          current: { dropOwner, dropRoot } as unknown as DiagnosticsCoalescer,
        },
        isOwnerVisible: (ownerKey) => ownerKey === owner.ownerKey,
        kind,
        lifecycleStore,
        reportOwnerCapacity,
        visibleOwnerKeyRef: { current: owner.ownerKey },
      });

      coordinator.prepare(owner.executionRoot, owner);
      const preparedGeneration = lifecycleStore.revision(lifecycleKey);
      expect(preparedGeneration).not.toBeNull();
      expect(cacheByOwnerRef.current[owner.ownerKey]).toBeUndefined();
      expect(dropOwner).toHaveBeenCalledWith(owner.ownerKey);
      expect(clearVisibleDiagnostics).toHaveBeenCalledTimes(1);
      expect(reportOwnerCapacity).toHaveBeenCalledWith(kind, owner.ownerKey, true);

      coordinator.reset(owner.executionRoot, owner);
      expect(lifecycleStore.isCurrent(lifecycleKey, preparedGeneration!)).toBe(false);

      coordinator.clear(owner.executionRoot, owner);
      expect(lifecycleStore.isClosed(lifecycleKey)).toBe(true);
      expect(clearUriCapacity).toHaveBeenCalledWith(kind, owner.ownerKey);
    });

    it("uses root retirement for legacy root-scoped owners", () => {
      const dropRoot = vi.fn();
      const coordinator = createDiagnosticsChannelLifecycleCoordinator({
        cacheByOwnerRef: { current: {} },
        clearUriCapacity: vi.fn(),
        clearVisibleDiagnostics: vi.fn(),
        coalescerRef: {
          current: {
            dropOwner: vi.fn(),
            dropRoot,
          } as unknown as DiagnosticsCoalescer,
        },
        isOwnerVisible: () => false,
        kind,
        lifecycleStore: new DiagnosticsOwnerLifecycleStore(),
        reportOwnerCapacity: vi.fn(),
        visibleOwnerKeyRef: { current: "" },
      });

      coordinator.reset("/workspace");
      expect(dropRoot).toHaveBeenCalledWith("/workspace");
    });
  },
);
