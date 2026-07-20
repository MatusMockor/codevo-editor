import { describe, expect, it, vi } from "vitest";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import { createPhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import { phpFrameworkMemberCompletionContributions } from "./phpFrameworkMemberCompletionContributions";
import { phpFrameworkMemberCompletionContributionRegistrations } from "./phpFrameworkMemberCompletionContributions";
import { phpLaravelFrameworkPlugin } from "./phpLaravelFrameworkPlugin";
import type { PhpMemberCompletionContribution } from "./phpMemberCompletionContribution";

describe("phpFrameworkMemberCompletionContributions", () => {
  it("selects only active per-project contributions in priority order", () => {
    const runtime = createPhpFrameworkRuntimeContext(
      createPhpFrameworkIntelligence({
        matchedProviderIds: ["active"],
        profile: "generic",
        providers: [{ id: "active", appliesTo: () => true }],
      }),
    );
    const contributions = [
      registration("low", "active", 10),
      registration("foreign", "other", 100),
      registration("high", "active", 20),
    ];

    expect(
      phpFrameworkMemberCompletionContributions(runtime, contributions).map(
        ({ id }) => id,
      ),
    ).toEqual(["high", "low"]);
  });

  it("does not leak contributions into a generic workspace", () => {
    const runtime = createPhpFrameworkRuntimeContext(
      createPhpFrameworkIntelligence({
        matchedProviderIds: [],
        profile: "generic",
        providers: [],
      }),
    );

    expect(
      phpFrameworkMemberCompletionContributions(runtime, [
        registration("laravel", "laravel", 10),
      ]),
    ).toEqual([]);
  });

  it("derives shipped member contributions from plugin descriptors", () => {
    expect(
      phpFrameworkMemberCompletionContributionRegistrations([
        phpLaravelFrameworkPlugin,
      ]).map(({ id, providerId }) => ({ id, providerId })),
    ).toEqual([
      { id: "laravel.member-completions", providerId: "laravel" },
    ]);
  });

  it("adapts an active custom provider member completion callback", () => {
    const memberCompletionsFromSource = vi.fn(() => [
      {
        declaringClassName: "App\\Report",
        name: "fromCustomProvider",
        parameters: "",
        returnType: "void",
      },
    ]);
    const runtime = createPhpFrameworkRuntimeContext(
      createPhpFrameworkIntelligence({
        matchedProviderIds: ["custom"],
        profile: "generic",
        providers: [
          {
            id: "custom",
            completions: { memberCompletionsFromSource },
          },
        ],
      }),
    );
    const [contribution] = phpFrameworkMemberCompletionContributions(runtime);

    expect(
      contribution?.collect({
        declaringClassName: "App\\Report",
        source: "<?php class Report {}",
        workspaceSources: ["<?php custom source"],
      }),
    ).toEqual([
      expect.objectContaining({ name: "fromCustomProvider" }),
    ]);
    expect(memberCompletionsFromSource).toHaveBeenCalledWith({
      declaringClassName: "App\\Report",
      source: "<?php class Report {}",
      sourceContext: { workspaceSources: ["<?php custom source"] },
    });
  });

  it("does not adapt a legacy callback when the provider has plugin contributions", () => {
    const memberCompletionsFromSource = vi.fn(() => []);
    const runtime = createPhpFrameworkRuntimeContext(
      createPhpFrameworkIntelligence({
        matchedProviderIds: ["laravel"],
        profile: "laravel",
        providers: [
          {
            id: "laravel",
            completions: { memberCompletionsFromSource },
          },
        ],
      }),
    );

    expect(
      phpFrameworkMemberCompletionContributions(runtime).map(({ id }) => id),
    ).toEqual(["laravel.member-completions"]);
  });
});

function registration(
  id: string,
  providerId: string,
  priority: number,
) {
  return {
    contribution: {
      id,
      priority,
      collect: () => [],
    } satisfies PhpMemberCompletionContribution,
    id,
    providerId,
  };
}
