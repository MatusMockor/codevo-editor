// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { FileEntry } from "../domain/workspace";
import {
  useNetteSourceRegistries,
  type NetteSourceRegistries,
  type UseNetteSourceRegistriesDependencies,
} from "./useNetteSourceRegistries";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace";
const ROOT_CONFIG = `${ROOT}/config/root.neon`;
const SHARED_CONFIG = `${ROOT}/shared/services.neon`;

function renderRegistry(dependencies: UseNetteSourceRegistriesDependencies) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { current: NetteSourceRegistries | null } = { current: null };

  function Harness() {
    captured.current = useNetteSourceRegistries(dependencies);
    return null;
  }

  act(() => root.render(<Harness />));

  return {
    api: () => {
      if (!captured.current) {
        throw new Error("registry hook not mounted");
      }

      return captured.current;
    },
    unmount: () => act(() => root.unmount()),
  };
}

describe("useNetteSourceRegistries", () => {
  it("invalidates and reloads edits to recursively discovered includes", async () => {
    const files = new Map([
      [ROOT_CONFIG, "includes:\n  - ../shared/services.neon"],
      [SHARED_CONFIG, "services:\n  mailer: App\\Mail\\FirstMailer"],
    ]);
    const readTextFile = vi.fn(async (path: string) => {
      const source = files.get(path);

      if (!source) {
        throw new Error(`Missing file: ${path}`);
      }

      return source;
    });
    const rootEntry: FileEntry = {
      kind: "file",
      name: "root.neon",
      path: ROOT_CONFIG,
    };
    const harness = renderRegistry({
      currentWorkspaceRootRef: { current: ROOT },
      isActive: true,
      onSourcesLoaded: vi.fn(),
      workspaceFiles: {
        readDirectory: vi.fn(async (path: string) => {
          if (path === `${ROOT}/config`) {
            return [rootEntry];
          }

          throw new Error(`Missing directory: ${path}`);
        }),
        readTextFile,
      },
    });

    await act(async () => {
      await harness.api().ensurePhpNetteNeonConfigSourcesLoaded(ROOT);
    });
    expect(
      harness.api().currentPhpNetteSourceContextForRoot(ROOT).workspaceSources,
    ).toEqual([
      "includes:\n  - ../shared/services.neon",
      "services:\n  mailer: App\\Mail\\FirstMailer",
    ]);

    files.set(
      SHARED_CONFIG,
      "services:\n  mailer: App\\Mail\\SecondMailer",
    );
    harness.api().invalidatePhpNetteNeonConfigSourcesForPath(
      ROOT,
      SHARED_CONFIG,
    );

    await act(async () => {
      await harness.api().ensurePhpNetteNeonConfigSourcesLoaded(ROOT);
    });
    expect(
      harness.api().currentPhpNetteSourceContextForRoot(ROOT).workspaceSources,
    ).toEqual([
      "includes:\n  - ../shared/services.neon",
      "services:\n  mailer: App\\Mail\\SecondMailer",
    ]);
    expect(readTextFile).toHaveBeenCalledWith(SHARED_CONFIG);

    harness.unmount();
  });
});
