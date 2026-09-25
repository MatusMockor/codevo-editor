import type { SettingsPageProps } from "../settingsPageProps";
import { GeneralAppUpdateRows } from "./GeneralAppUpdateRows";
import { GeneralEditingRows } from "./GeneralEditingRows";
import { GeneralStatusBarRows } from "./GeneralStatusBarRows";
import { GeneralTextEditorRows } from "./GeneralTextEditorRows";
import { GeneralThemeSection } from "./GeneralThemeSection";
import { GeneralWorkspaceRows } from "./GeneralWorkspaceRows";

export function GeneralSettingsPage(props: SettingsPageProps) {
  return (
    <>
      <GeneralThemeSection {...props} />
      <GeneralTextEditorRows {...props} />
      <GeneralAppUpdateRows updater={props.env.appUpdater} />
      <GeneralWorkspaceRows {...props} />
      <GeneralEditingRows {...props} />
      <GeneralStatusBarRows {...props} />
    </>
  );
}
