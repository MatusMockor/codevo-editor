import { describe, expect, it, vi } from "vitest";
import type { EditorDocument } from "../domain/workspace";
import { createPhpNetteIdentifierDefinitionNavigationAdapter } from "./phpNetteIdentifierDefinitionNavigationAdapter";

const source =
  "<?php class P { public function __construct(Catalog $catalog) {} }";
const activeDocument: EditorDocument = {
  content: source,
  language: "php",
  name: "P.php",
  path: "/workspace/P.php",
  savedContent: source,
};
const context = { kind: "classIdentifier", name: "Catalog" } as const;

describe("phpNetteIdentifierDefinitionNavigationAdapter", () => {
  it("passes an active request to the injection definition provider", async () => {
    const request = { canNavigate: vi.fn(() => true) };
    const providePhpNetteInjectionDefinition = vi.fn(async () => true);
    const adapter = createPhpNetteIdentifierDefinitionNavigationAdapter({
      activeDocument,
      activeEditorPositionRef: {
        current: { column: source.indexOf("Catalog") + 2, lineNumber: 1 },
      },
      providePhpNetteInjectionDefinition,
    });

    await expect(adapter.goToDefinition(context, request)).resolves.toBe(true);
    expect(providePhpNetteInjectionDefinition).toHaveBeenCalledWith(
      source,
      source.indexOf("Catalog") + 1,
      request,
    );
  });

  it("does not invoke the provider for a stale request", async () => {
    const providePhpNetteInjectionDefinition = vi.fn(async () => true);
    const adapter = createPhpNetteIdentifierDefinitionNavigationAdapter({
      activeDocument,
      activeEditorPositionRef: { current: { column: 1, lineNumber: 1 } },
      providePhpNetteInjectionDefinition,
    });

    await expect(
      adapter.goToDefinition(context, { canNavigate: () => false }),
    ).resolves.toBe(false);
    expect(providePhpNetteInjectionDefinition).not.toHaveBeenCalled();
  });

  it("returns false when the request becomes stale in the provider", async () => {
    let requestActive = true;
    const request = { canNavigate: () => requestActive };
    const adapter = createPhpNetteIdentifierDefinitionNavigationAdapter({
      activeDocument,
      activeEditorPositionRef: { current: { column: 1, lineNumber: 1 } },
      providePhpNetteInjectionDefinition: vi.fn(async () => {
        requestActive = false;
        return true;
      }),
    });

    await expect(adapter.goToDefinition(context, request)).resolves.toBe(false);
  });
});
