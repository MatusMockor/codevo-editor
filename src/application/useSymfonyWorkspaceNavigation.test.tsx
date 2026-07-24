// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SymfonyRoute, SymfonyService } from "../domain/symfonyWorkspaceIntelligence";
import { useSymfonyWorkspaceNavigation } from "./useSymfonyWorkspaceNavigation";

type NavigationOptions = Parameters<typeof useSymfonyWorkspaceNavigation>[0];

describe("useSymfonyWorkspaceNavigation", () => {
  let host: HTMLDivElement;
  let root: Root;
  let navigation: ReturnType<typeof useSymfonyWorkspaceNavigation>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("forwards a route method and its stale-navigation guard", async () => {
    const openPhpMethodTarget = vi.fn<NavigationOptions["openPhpMethodTarget"]>(async () => true);
    await render({ openPhpMethodTarget });
    const shouldCommit = vi.fn(() => false);

    const opened = await navigation.openSymfonyRouteController(route(), shouldCommit);

    expect(opened).toBe(true);
    expect(openPhpMethodTarget).toHaveBeenCalledOnce();
    const [className, methodName, request] = openPhpMethodTarget.mock.calls[0]!;
    expect([className, methodName]).toEqual(["App\\Controller\\HomeController", "index"]);
    expect(request?.canNavigate()).toBe(false);
    expect(shouldCommit).toHaveBeenCalledOnce();
  });

  it("uses __invoke for an invokable route controller", async () => {
    const openPhpMethodTarget = vi.fn<NavigationOptions["openPhpMethodTarget"]>(async () => true);
    await render({ openPhpMethodTarget });

    await navigation.openSymfonyRouteController(
      route({ controller: "\\App\\Controller\\HealthController" }),
      () => true,
    );

    expect(openPhpMethodTarget).toHaveBeenCalledWith(
      "App\\Controller\\HealthController",
      "__invoke",
      expect.objectContaining({ canNavigate: expect.any(Function) }),
    );
  });

  it("does not navigate when a route has no conservative PHP method target", async () => {
    const openPhpMethodTarget = vi.fn<NavigationOptions["openPhpMethodTarget"]>(async () => true);
    await render({ openPhpMethodTarget });

    await expect(
      navigation.openSymfonyRouteController(route({ controller: "Closure" }), () => true),
    ).resolves.toBe(false);
    await expect(
      navigation.openSymfonyRouteController(route({ controller: null }), () => true),
    ).resolves.toBe(false);
    expect(openPhpMethodTarget).not.toHaveBeenCalled();
  });

  it("forwards a service class, label, and stale-navigation guard", async () => {
    const openPhpClassTarget = vi.fn<NavigationOptions["openPhpClassTarget"]>(async () => true);
    await render({ openPhpClassTarget });
    const shouldCommit = vi.fn(() => true);

    const opened = await navigation.openSymfonyService(service(), shouldCommit);

    expect(opened).toBe(true);
    expect(openPhpClassTarget).toHaveBeenCalledOnce();
    const [className, label, request] = openPhpClassTarget.mock.calls[0]!;
    expect([className, label]).toEqual(["App\\Clock", "App\\Clock"]);
    expect(request?.canNavigate()).toBe(true);
    expect(shouldCommit).toHaveBeenCalledOnce();
  });

  it("does not navigate when a service exposes no conservative PHP class target", async () => {
    const openPhpClassTarget = vi.fn<NavigationOptions["openPhpClassTarget"]>(async () => true);
    await render({ openPhpClassTarget });

    await expect(
      navigation.openSymfonyService(
        service({ alias: "clock.inner", className: null, id: "service.clock" }),
        () => true,
      ),
    ).resolves.toBe(false);
    expect(openPhpClassTarget).not.toHaveBeenCalled();
  });

  async function render({
    openPhpClassTarget = vi.fn(async () => true),
    openPhpMethodTarget = vi.fn(async () => true),
  }: Partial<Parameters<typeof useSymfonyWorkspaceNavigation>[0]> = {}): Promise<void> {
    await act(async () => {
      root.render(
        <Harness
          onReady={(value) => {
            navigation = value;
          }}
          openPhpClassTarget={openPhpClassTarget}
          openPhpMethodTarget={openPhpMethodTarget}
        />,
      );
    });
  }
});

function Harness({
  onReady,
  ...options
}: Parameters<typeof useSymfonyWorkspaceNavigation>[0] & {
  onReady(value: ReturnType<typeof useSymfonyWorkspaceNavigation>): void;
}) {
  onReady(useSymfonyWorkspaceNavigation(options));
  return null;
}

function route(overrides: Partial<SymfonyRoute> = {}): SymfonyRoute {
  return {
    controller: "App\\Controller\\HomeController::index",
    key: "route-home",
    methods: ["GET"],
    name: "app_home",
    path: "/",
    ...overrides,
  };
}

function service(overrides: Partial<SymfonyService> = {}): SymfonyService {
  return {
    alias: null,
    className: "App\\Clock",
    id: "App\\Clock",
    key: "service-clock",
    public: false,
    ...overrides,
  };
}
