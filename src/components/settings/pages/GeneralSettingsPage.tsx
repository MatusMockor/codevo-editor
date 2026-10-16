import type { SettingsPageProps } from "../settingsPageProps";
import { GeneralAppUpdateRows } from "./GeneralAppUpdateRows";
import { GeneralStatusBarRows } from "./GeneralStatusBarRows";
import { GeneralTextAndCodeRows } from "./GeneralTextAndCodeRows";
import { GeneralThemeSection } from "./GeneralThemeSection";
import { GeneralWorkspaceRows } from "./GeneralWorkspaceRows";

export function GeneralSettingsPage(props: SettingsPageProps) {
  return (
    <>
      <GeneralThemeSection {...props} />
      <GeneralTextAndCodeRows {...props} />
      <GeneralAppUpdateRows updater={props.env.appUpdater} />
      <GeneralWorkspaceRows {...props} />
      <GeneralStatusBarRows {...props} />
    </>
  );
}
