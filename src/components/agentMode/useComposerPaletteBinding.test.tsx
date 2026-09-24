// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { workbenchComposerPaletteModels } from "../../application/commandPalette/commandPaletteProvider";
import { BUNDLED_CLAUDE_MODEL_MANIFEST } from "../../domain/claudeModelCatalog";
import { defaultAgentComposerLaunch } from "./agentComposerLaunch";
import { mountUi, type MountedUi } from "../../ui/foundation/foundationTestSupport";
import {
  useComposerPaletteBinding,
  type ComposerPaletteBindingOptions,
} from "./useComposerPaletteBinding";

let ui: MountedUi | null = null;
afterEach(() => {
  ui?.unmount();
  ui = null;
});

function Harness(props: ComposerPaletteBindingOptions) {
  useComposerPaletteBinding(props);
  return null;
}

describe("useComposerPaletteBinding", () => {
  it("publishes the current provider models with the current one marked and selects by key", () => {
    const selectModel = vi.fn();
    const launch = defaultAgentComposerLaunch("claudeCode");
    ui = mountUi();
    ui.render(
      <Harness
        catalog={BUNDLED_CLAUDE_MODEL_MANIFEST}
        disabled={false}
        launch={launch}
        providerEnabled={null}
        providerManagement={null}
        providerSwitchable={false}
        selectModel={selectModel}
      />,
    );
    const models = workbenchComposerPaletteModels.current();
    expect(models?.options.length).toBeGreaterThan(0);
    expect(models?.options.filter((option) => option.current)).toHaveLength(1);
    const target = models?.options.find((option) => !option.current);
    expect(target).toBeDefined();
    expect(models?.selectModel(target?.key ?? "")).toBe(true);
    expect(selectModel).toHaveBeenCalledTimes(1);
    expect(models?.selectModel("nope")).toBe(false);
  });

  it("does not publish while disabled", () => {
    ui = mountUi();
    ui.render(
      <Harness
        catalog={BUNDLED_CLAUDE_MODEL_MANIFEST}
        disabled
        launch={defaultAgentComposerLaunch("claudeCode")}
        providerEnabled={null}
        providerManagement={null}
        providerSwitchable={false}
        selectModel={vi.fn()}
      />,
    );
    expect(workbenchComposerPaletteModels.current()).toBeNull();
  });
});
