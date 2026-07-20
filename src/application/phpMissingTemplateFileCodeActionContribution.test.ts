import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkLaravelProvider";
import { describe, expect, it, vi } from "vitest";

import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import { createPhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import { createActiveMissingTemplateFileCodeAction } from "./phpMissingTemplateFileCodeActionContribution";

const ROOT = "/workspace";

describe("phpMissingTemplateFileCodeActionContribution", () => {
  it("preserves the Blade UI callback at the concrete adapter edge", async () => {
    const frameworkRuntime = createPhpFrameworkRuntimeContext(
      createPhpFrameworkIntelligence({
        matchedProviderIds: ["laravel"],
        profile: "laravel",
        providers: [phpLaravelFrameworkProvider],
      }),
    );
    const createMissingTemplateFileCodeAction =
      createActiveMissingTemplateFileCodeAction({
        collectViewTargets: vi.fn(async () => [{ name: "dashboard" }]),
        frameworkRuntime,
        readTestFileIfExists: vi.fn(async () => null),
        workspaceRoot: ROOT,
      });
    const source = "@include('orders.show')";
    const start = source.indexOf("orders.show");

    await expect(
      createMissingTemplateFileCodeAction(
        source,
        { end: start + "orders.show".length, start },
        "blade",
        () => true,
      ),
    ).resolves.toEqual({
      edits: [],
      isPreferred: true,
      kind: "quickfix",
      newFile: {
        content: "",
        path: `${ROOT}/resources/views/orders/show.blade.php`,
        title: "Create Blade View",
      },
      title: "Create Blade view orders.show",
    });
  });

  it("returns a null callback without an active missing-template provider", async () => {
    const frameworkRuntime = createPhpFrameworkRuntimeContext(
      createPhpFrameworkIntelligence({
        matchedProviderIds: [],
        profile: "generic",
        providers: [],
      }),
    );
    const createMissingTemplateFileCodeAction =
      createActiveMissingTemplateFileCodeAction({
        collectViewTargets: vi.fn(async () => []),
        frameworkRuntime,
        readTestFileIfExists: vi.fn(async () => null),
        workspaceRoot: ROOT,
      });

    await expect(
      createMissingTemplateFileCodeAction(
        "@include('orders.show')",
        { end: 22, start: 10 },
        "blade",
        () => true,
      ),
    ).resolves.toBeNull();
  });
});
