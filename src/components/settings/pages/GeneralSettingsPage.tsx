import type { SettingsPageProps } from "../settingsPageProps";
import { GeneralAppUpdateRows } from "./GeneralAppUpdateRows";
import { GeneralEditingRows } from "./GeneralEditingRows";
import { GeneralStatusBarRows } from "./GeneralStatusBarRows";
import { GeneralWorkspaceRows } from "./GeneralWorkspaceRows";

export function GeneralSettingsPage(props: SettingsPageProps) {
  return (
    <>
      <GeneralAppUpdateRows updater={props.env.appUpdater} />
      <GeneralWorkspaceRows {...props} />
      <GeneralEditingRows {...props} />
      <GeneralStatusBarRows {...props} />
    </>
  );
}
