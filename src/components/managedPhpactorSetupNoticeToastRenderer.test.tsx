// @vitest-environment jsdom

import { isValidElement } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  managedPhpactorSetupNoticeGroupKey,
  managedPhpactorSetupNoticeToastRenderer,
} from "./managedPhpactorSetupNoticeToastRenderer";
import type { NoticeToastRendererContext } from "./useNoticeToastRenderers";

function context(overrides: Partial<NoticeToastRendererContext> = {}): NoticeToastRendererContext {
  return {
    intelligenceMode: "fullSmart",
    isInstallingManagedPhpactor: false,
    onInstallManagedPhpactor: vi.fn(),
    onOpenLanguageServerSetup: vi.fn(),
    onOpenRuntimePanel: vi.fn(),
    workspaceRoot: "/workspace",
    workspaceTrusted: true,
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
