// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ComposerPackageDescriptor,
  WorkspaceDescriptor,
} from "../domain/workspace";
import type { PhpFrameworkProvider } from "../domain/phpFrameworkProviders";
import {
  usePhpFrameworkResolution,
  type UsePhpFrameworkResolutionOptions,
} from "./usePhpFrameworkResolution";
import { phpFrameworkPluginCatalog } from "./phpFrameworkPluginCatalog";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace";

type HookApi = ReturnType<typeof usePhpFrameworkResolution>;
type HookOptions = UsePhpFrameworkResolutionOptions;

function composerPackage(name: string): ComposerPackageDescriptor {
  return {
    classmapRoots: [],
    dev: false,
    installPath: null,
    name,
    packageType: null,
    psr4Roots: [],
    version: null,
  };
}

function phpDescriptor(
  packageNames: string[],
  rootPath: string = ROOT,
): WorkspaceDescriptor {
  return {
    javaScriptTypeScript: null,
    php: {
      classmapRoots: [],
      hasComposer: true,
      packageName: null,
      packages: packageNames.map(composerPackage),
      phpPlatformVersion: null,
      phpVersionConstraint: null,
      psr4Roots: [],
    },
    rootPath,
  };
}

function renderHook(options: HookOptions) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { api: HookApi | null } = { api: null };

  function Harness({ hookOptions }: { hookOptions: HookOptions }) {
    captured.api = usePhpFrameworkResolution(hookOptions);
    return null;
  }

  const render = (hookOptions: HookOptions) => {
    act(() => {
      root.render(<Harness hookOptions={hookOptions} />);
    });
  };

  render(options);

  return {
    api: () => {
      if (!captured.api) {
        throw new Error("hook not mounted");
      }

      return captured.api;
    },
    rerender: render,
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("usePhpFrameworkResolution", () => {
  it("uses the application-owned shipped plugin catalog", () => {
    expect(phpFrameworkPluginCatalog.map((provider) => provider.id)).toEqual([
      "laravel",
      "nette",
    ]);
  });

  it("resolves an injected third provider without changing the hook", () => {
    const symfonyProvider: PhpFrameworkProvider = {
      id: "symfony",
      appliesTo: (php) =>
        php.packages.some(
          (composerPackage) =>
            composerPackage.name === "symfony/framework-bundle",
        ),
      presentation: { activityLabel: "Symfony" },
    };
    const harness = renderHook({
      providerCatalog: [symfonyProvider],
      workspaceDescriptor: phpDescriptor(["symfony/framework-bundle"]),
    });

    expect(harness.api().activeFrameworkActivityLabel).toBe("Symfony");
    expect(
      harness.api().activePhpFrameworkProviders.map((provider) => provider.id),
    ).toEqual(["symfony"]);
    expect(harness.api().phpFrameworkRuntimeContext.profile).toBe("generic");

    harness.unmount();
  });

  it("resolves a Laravel descriptor to the Laravel runtime and providers", () => {
    const harness = renderHook({
      workspaceDescriptor: phpDescriptor(["laravel/framework"]),
    });
    const api = harness.api();

    expect(api.phpFrameworkRuntimeContext.hasProvider("laravel")).toBe(true);
    expect(api.phpFrameworkRuntimeContext.hasProvider("nette")).toBe(false);
    expect(api.phpFrameworkRuntimeContext.profile).toBe("laravel");
    expect(api.phpFrameworkIntelligence.hasProvider("laravel")).toBe(true);
    expect(
      api.activePhpFrameworkProviders.map((provider) => provider.id),
    ).toEqual(["laravel"]);
    expect(api.activeFrameworkActivityLabel).toBe("Laravel");

    harness.unmount();
  });

  it("resolves a Nette descriptor to the Nette runtime and providers", () => {
    const harness = renderHook({
      workspaceDescriptor: phpDescriptor(["nette/application"]),
    });
    const api = harness.api();

    expect(api.phpFrameworkRuntimeContext.hasProvider("nette")).toBe(true);
    expect(api.phpFrameworkRuntimeContext.hasProvider("laravel")).toBe(false);
    expect(api.phpFrameworkRuntimeContext.profile).toBe("nette");
    expect(
      api.activePhpFrameworkProviders.map((provider) => provider.id),
    ).toEqual(["nette"]);
    expect(api.activeFrameworkActivityLabel).toBe("Nette");

    harness.unmount();
  });

  it("does not leak framework resolution across project rerenders", () => {
    const harness = renderHook({
      workspaceDescriptor: phpDescriptor(
        ["laravel/framework"],
        "/workspace/laravel",
      ),
    });

    expect(harness.api().phpFrameworkRuntimeContext.profile).toBe("laravel");
    expect(
      harness.api().phpFrameworkRuntimeContext.hasProvider("laravel"),
    ).toBe(true);
    expect(harness.api().phpFrameworkRuntimeContext.hasProvider("nette")).toBe(
      false,
    );
    expect(
      harness.api().phpFrameworkIntelligence.hasProvider("laravel"),
    ).toBe(true);
    expect(
      harness.api().activePhpFrameworkProviders.map((provider) => provider.id),
    ).toEqual(["laravel"]);
    expect(harness.api().activeFrameworkActivityLabel).toBe("Laravel");

    harness.rerender({
      workspaceDescriptor: phpDescriptor(
        ["nette/application"],
        "/workspace/nette",
      ),
    });

    expect(harness.api().phpFrameworkRuntimeContext.profile).toBe("nette");
    expect(
      harness.api().phpFrameworkRuntimeContext.hasProvider("laravel"),
    ).toBe(false);
    expect(harness.api().phpFrameworkRuntimeContext.hasProvider("nette")).toBe(
      true,
    );
    expect(
      harness.api().phpFrameworkIntelligence.hasProvider("laravel"),
    ).toBe(false);
    expect(
      harness.api().activePhpFrameworkProviders.map((provider) => provider.id),
    ).toEqual(["nette"]);
    expect(harness.api().activeFrameworkActivityLabel).toBe("Nette");

    harness.rerender({
      workspaceDescriptor: phpDescriptor([], "/workspace/generic"),
    });

    expect(harness.api().phpFrameworkRuntimeContext.profile).toBe("generic");
    expect(
      harness.api().phpFrameworkRuntimeContext.hasProvider("laravel"),
    ).toBe(false);
    expect(harness.api().phpFrameworkRuntimeContext.hasProvider("nette")).toBe(
      false,
    );
    expect(
      harness.api().phpFrameworkIntelligence.hasProvider("laravel"),
    ).toBe(false);
    expect(harness.api().activePhpFrameworkProviders).toEqual([]);
    expect(harness.api().activeFrameworkActivityLabel).toBeNull();

    harness.unmount();
  });

  it("resolves a missing php descriptor to the generic runtime with no providers", () => {
    const harness = renderHook({ workspaceDescriptor: null });
    const api = harness.api();

    expect(api.phpFrameworkRuntimeContext.profile).toBe("generic");
    expect(api.phpFrameworkRuntimeContext.hasProvider("laravel")).toBe(false);
    expect(api.phpFrameworkRuntimeContext.hasProvider("nette")).toBe(false);
    expect(api.activePhpFrameworkProviders).toEqual([]);
    expect(api.activeFrameworkActivityLabel).toBeNull();

    harness.rerender({
      workspaceDescriptor: {
        javaScriptTypeScript: null,
        php: null,
        rootPath: ROOT,
      },
    });

    expect(harness.api().phpFrameworkRuntimeContext.profile).toBe("generic");
    expect(harness.api().activePhpFrameworkProviders).toEqual([]);

    harness.unmount();
  });

  it("keeps runtime identity stable across rerenders with the same descriptor", () => {
    const workspaceDescriptor = phpDescriptor(["laravel/framework"]);
    const harness = renderHook({ workspaceDescriptor });
    const firstRuntime = harness.api().phpFrameworkRuntimeContext;
    const firstIntelligence = harness.api().phpFrameworkIntelligence;
    const firstProviders = harness.api().activePhpFrameworkProviders;

    harness.rerender({ workspaceDescriptor });

    expect(harness.api().phpFrameworkRuntimeContext).toBe(firstRuntime);
    expect(harness.api().phpFrameworkIntelligence).toBe(firstIntelligence);
    expect(harness.api().activePhpFrameworkProviders).toBe(firstProviders);

    harness.unmount();
  });

  it("warns once when a descriptor carries multiple framework signals", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const workspaceDescriptor = phpDescriptor([
      "laravel/framework",
      "latte/latte",
    ]);
    const harness = renderHook({ workspaceDescriptor });

    expect(harness.api().phpFrameworkRuntimeContext.profile).toBe("laravel");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'Multiple PHP framework signals detected (laravel, nette); resolved exclusively to "laravel" by registry priority.',
    );

    harness.rerender({ workspaceDescriptor });

    expect(warn).toHaveBeenCalledTimes(1);

    harness.unmount();
  });

  it("does not warn for a single-signal descriptor", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const harness = renderHook({
      workspaceDescriptor: phpDescriptor(["laravel/framework"]),
    });

    expect(warn).not.toHaveBeenCalled();

    harness.unmount();
  });
});
