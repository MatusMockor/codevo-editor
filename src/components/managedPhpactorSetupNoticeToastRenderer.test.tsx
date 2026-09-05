// @vitest-environment jsdom

import { isValidElement } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  managedPhpactorSetupNoticeGroupKey,
  managedPhpactorSetupNoticeToastRenderer,
} from "./managedPhpactorSetupNoticeToastRenderer";
import { unconfiguredAgentProviderManagement } from "../test/agentProviderManagementFixture";
import type { NoticeToastRendererFactoryContext } from "./useNoticeToastRenderers";

function context(
  overrides: Partial<NoticeToastRendererFactoryContext> = {},
): NoticeToastRendererFactoryContext {
  const providerManagement = unconfiguredAgentProviderManagement();
  return {
    intelligenceMode: "fullSmart",
    isInstallingManagedPhpactor: false,
    onInstallManagedPhpactor: vi.fn(),
    onOpenLanguageServerSetup: vi.fn(),
    onOpenRuntimePanel: vi.fn(),
    workspaceRoot: "/workspace",
    workspaceTrusted: true,
    appUpdate: null,
    appUpdater: {
      check: vi.fn(async () => undefined),
      dismiss: vi.fn(),
      download: vi.fn(async () => undefined),
      installAndRestart: vi.fn(async () => undefined),
      skipVersion: vi.fn(async () => undefined),
    },
    copyText: vi.fn(),
    onDismissUpdateRefusal: vi.fn(),
    onOpenAgentSettings: vi.fn(),
    onUpdateRefused: vi.fn(),
    providerManagement,
    readProviderManagement: () => providerManagement,
    providerUpdate: null,
    ...overrides,
  };
}

describe("managed Phpactor setup notice toast renderer", () => {
  it("keeps eligibility in the UI composition layer", () => {
    expect(
      managedPhpactorSetupNoticeToastRenderer(context({ workspaceTrusted: false })),
    ).toBeNull();
    expect(
      managedPhpactorSetupNoticeToastRenderer(context({ intelligenceMode: "basic" })),
    ).toBeNull();
    expect(managedPhpactorSetupNoticeToastRenderer(context({ workspaceRoot: null }))).toBeNull();

    const entry = managedPhpactorSetupNoticeToastRenderer(context());
    expect(entry?.[0]).toBe("phpactor-setup:/workspace");
    expect(
      isValidElement(
        entry?.[1](
          { id: "notice", message: "setup", severity: "warning", source: "PHP" },
          { dismiss: vi.fn() },
        ),
      ),
    ).toBe(true);
  });

  it("creates no group without a workspace scope", () => {
    expect(managedPhpactorSetupNoticeGroupKey(null)).toBeNull();
    expect(managedPhpactorSetupNoticeGroupKey("/workspace")).toBe("phpactor-setup:/workspace");
  });
});
