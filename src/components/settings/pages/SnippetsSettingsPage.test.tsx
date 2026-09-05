// @vitest-environment jsdom

import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultAppSettings,
  defaultWorkspaceSettings,
  type AppSettings,
} from "../../../domain/settings";
import { snippetLanguageOptions } from "../../../domain/snippetLanguageOptions";
import type { UserSnippet } from "../../../domain/snippets";
import type {
  SettingsDraftActions,
  SettingsEnvironment,
  SettingsSaveInput,
} from "../settingsPageProps";
import { SnippetsSettingsPage } from "./SnippetsSettingsPage";

const env: SettingsEnvironment = {
  appUpdater: null,
  gitDetectedRepositoryMappings: [],
  hasWorkspace: true,
  phpTools: null,
  providerManagement: null,
  providerSignIn: null,
  systemFontGateway: { listMonospaceFontFamilies: async () => [] },
  workspaceDescriptor: null,
  workspaceRoot: "/workspace",
  onCopyInstallCommand: () => undefined,
  onOpenJavaScriptTypeScriptServiceLog: async () => undefined,
  onOpenNodeLaunchConfigurations: () => undefined,
  onRestartJavaScriptTypeScriptService: async () => undefined,
};

const helper: UserSnippet = {
  prefix: "myhelper",
  body: "helper($0);",
  description: "Call helper",
  languages: ["php"],
};

interface HarnessProps {
  readonly appSettings: AppSettings;
  onSave(input: SettingsSaveInput): void;
}

function Harness({ appSettings, onSave }: HarnessProps) {
  const [settings, setSettings] = useState(appSettings);
  const settingsRef = useRef(settings);
  const workspaceSettings = defaultWorkspaceSettings();
  const actions: SettingsDraftActions = {
    publishAppSettings: (next) => {
      settingsRef.current = next;
      setSettings(next);
    },
    save: (input) =>
      onSave({
        appSettings: input.appSettings ?? settingsRef.current,
        trusted: true,
        workspaceSettings,
      }),
    updateAppSettings: (next) => {
      settingsRef.current = next;
      setSettings(next);
      onSave({ appSettings: next, trusted: true, workspaceSettings });
    },
    updateIgnorePatternsText: () => undefined,
    updateTrusted: () => undefined,
    updateWorkspaceSettings: () => undefined,
  };

  return (
    <SnippetsSettingsPage
      actions={actions}
      draft={{
        appSettings: settings,
        ignorePatternsText: "",
        trusted: true,
        workspaceSettings,
      }}
      env={env}
    />
  );
}

describe("SnippetsSettingsPage", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it("offers Latte and NEON alongside the existing snippet languages", () => {
    const ids = snippetLanguageOptions.map((option) => option.id);

    expect(ids).toContain("php");
    expect(ids).toContain("blade");
    expect(ids).toContain("latte");
    expect(ids).toContain("neon");
  });

  it("shows an empty state without user snippets", async () => {
    await render([]);

    expect(host.textContent).toContain("No user snippets yet");
  });

  it("adds a user snippet", async () => {
    const onSave = vi.fn();

    await render([], onSave);

    await click(addSnippetButton());

    expect(lastSnippets(onSave)).toHaveLength(1);
  });

  it("edits and persists an existing user snippet", async () => {
    const onSave = vi.fn();

    await render([helper], onSave);

    const prefix = fieldWithLabel("Snippet 1 prefix");
    expect(prefix.value).toBe("myhelper");

    await type(prefix, "newprefix");
    expect(lastSnippets(onSave)[0]?.prefix).toBe("newprefix");

    await type(fieldWithLabel("Snippet 1 description"), "Calls the helper");
    expect(lastSnippets(onSave)[0]?.description).toBe("Calls the helper");

    await type(bodyWithLabel("Snippet 1 body"), "helper($1);$0");
    expect(lastSnippets(onSave)[0]?.body).toBe("helper($1);$0");
  });

  it("toggles the languages a snippet is offered in", async () => {
    const onSave = vi.fn();

    await render([helper], onSave);

    await click(languageChip("Blade"));
    expect(lastSnippets(onSave)[0]?.languages).toEqual(["php", "blade"]);

    await click(languageChip("PHP"));
    expect(lastSnippets(onSave)[0]?.languages).toEqual(["blade"]);
  });

  it("deletes a user snippet", async () => {
    const onSave = vi.fn();

    await render([helper], onSave);

    await click(deleteSnippetButton());

    expect(lastSnippets(onSave)).toEqual([]);
  });

  async function render(
    userSnippets: UserSnippet[],
    onSave: (input: SettingsSaveInput) => void = () => undefined,
  ): Promise<void> {
    await act(async () => {
      root.render(
        <Harness appSettings={{ ...defaultAppSettings(), userSnippets }} onSave={onSave} />,
      );
      await Promise.resolve();
    });
  }

  function fieldWithLabel(label: string): HTMLInputElement {
    const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);

    expect(input).not.toBeNull();

    return input as HTMLInputElement;
  }

  function bodyWithLabel(label: string): HTMLTextAreaElement {
    const input = host.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`);

    expect(input).not.toBeNull();

    return input as HTMLTextAreaElement;
  }

  function languageChip(label: string): HTMLButtonElement {
    const chip = [...host.querySelectorAll<HTMLButtonElement>(".settings-chip")].find(
      (candidate) => candidate.textContent?.trim() === label,
    );

    expect(chip).toBeTruthy();

    return chip as HTMLButtonElement;
  }

  function addSnippetButton(): HTMLButtonElement {
    return buttonWithText("Add snippet");
  }

  function deleteSnippetButton(): HTMLButtonElement {
    return buttonWithText("Delete snippet");
  }

  function buttonWithText(text: string): HTMLButtonElement {
    const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find((candidate) =>
      candidate.textContent?.includes(text),
    );

    expect(button).toBeTruthy();

    return button as HTMLButtonElement;
  }

  async function click(element: HTMLElement): Promise<void> {
    await act(async () => {
      element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
  }

  async function type(
    element: HTMLInputElement | HTMLTextAreaElement,
    value: string,
  ): Promise<void> {
    await act(async () => {
      const prototype =
        element instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
  }
});

function lastSnippets(onSave: { mock: { calls: unknown[][] } }): ReadonlyArray<UserSnippet> {
  const calls = onSave.mock.calls;
  const last = calls[calls.length - 1]?.[0] as SettingsSaveInput | undefined;

  expect(last).toBeTruthy();

  return (last as SettingsSaveInput).appSettings.userSnippets;
}
