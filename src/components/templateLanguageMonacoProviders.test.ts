import { describe, expect, it, vi } from "vitest";
import { registerTemplateLanguageMonacoProviders } from "./templateLanguageMonacoProviders";
import { registerBladeTemplateMonacoProviders } from "./bladeTemplateMonacoProviders";
import { registerLatteTemplateMonacoProviders } from "./latteTemplateMonacoProviders";
import { registerNeonTemplateMonacoProviders } from "./neonTemplateMonacoProviders";

const templateProviderCalls = vi.hoisted(() => ({
  order: [] as string[],
}));

vi.mock("./bladeTemplateMonacoProviders", () => ({
  registerBladeTemplateMonacoProviders: vi.fn(() => {
    templateProviderCalls.order.push("register:blade");

    return {
      dispose: () => {
        templateProviderCalls.order.push("dispose:blade");
      },
    };
  }),
  toMonacoBladeCompletion: vi.fn(),
}));

vi.mock("./latteTemplateMonacoProviders", () => ({
  registerLatteTemplateMonacoProviders: vi.fn(() => {
    templateProviderCalls.order.push("register:latte");

    return {
      dispose: () => {
        templateProviderCalls.order.push("dispose:latte");
      },
    };
  }),
  toMonacoLatteCompletion: vi.fn(),
}));

vi.mock("./neonTemplateMonacoProviders", () => ({
  registerNeonTemplateMonacoProviders: vi.fn(() => {
    templateProviderCalls.order.push("register:neon");

    return {
      dispose: () => {
        templateProviderCalls.order.push("dispose:neon");
      },
    };
  }),
  toMonacoNeonCompletion: vi.fn(),
}));

describe("template language Monaco providers", () => {
  it("registers and disposes template providers in stable order", () => {
    templateProviderCalls.order = [];

    const disposable = registerTemplateLanguageMonacoProviders(
      {} as never,
      {} as never,
      {} as never,
    );

    expect(templateProviderCalls.order).toEqual([
      "register:blade",
      "register:latte",
      "register:neon",
    ]);

    disposable.dispose();

    expect(templateProviderCalls.order).toEqual([
      "register:blade",
      "register:latte",
      "register:neon",
      "dispose:blade",
      "dispose:latte",
      "dispose:neon",
    ]);
  });

  it("forwards monaco, context, and handlers to every registration", () => {
    templateProviderCalls.order = [];
    const monaco = { marker: "monaco" } as never;
    const context = { marker: "context" } as never;
    const handlers = { marker: "handlers" } as never;

    registerTemplateLanguageMonacoProviders(monaco, context, handlers);

    expect(vi.mocked(registerBladeTemplateMonacoProviders)).toHaveBeenCalledWith(
      monaco,
      context,
      handlers,
    );
    expect(vi.mocked(registerLatteTemplateMonacoProviders)).toHaveBeenCalledWith(
      monaco,
      context,
      handlers,
    );
    expect(vi.mocked(registerNeonTemplateMonacoProviders)).toHaveBeenCalledWith(
      monaco,
      context,
    );
  });
});
