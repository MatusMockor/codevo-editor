import { useId, type ReactNode } from "react";
import { settingsRowDescriptor, type SettingsRowId } from "../settingsRegistry";
import { useSettingsRowTarget } from "../settingsTargetContext";
import { SettingsRowLabelContext } from "./settingsRowLabel";

export interface SettingsRowProps {
  readonly children: ReactNode;
  readonly layout?: "inline" | "stacked";
  readonly meta?: ReactNode;
  readonly rowId: SettingsRowId;
}

export function SettingsRow({ children, layout = "inline", meta, rowId }: SettingsRowProps) {
  const descriptor = settingsRowDescriptor(rowId);
  const elementRef = useSettingsRowTarget(rowId);
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descriptionId = descriptor.description === null ? null : `${baseId}-description`;

  return (
    <div
      className="settings-row"
      data-layout={layout}
      data-settings-row={rowId}
      ref={elementRef}
      tabIndex={-1}
    >
      <div className="settings-row__text">
        <div className="settings-row__head">
          <h3 className="settings-row__title" id={titleId}>
            {descriptor.title}
          </h3>
          {meta}
        </div>
        {descriptionId === null ? null : (
          <p className="settings-row__description" id={descriptionId}>
            {descriptor.description}
          </p>
        )}
      </div>
      <div className="settings-row__control">
        <SettingsRowLabelContext.Provider value={{ titleId, descriptionId }}>
          {children}
        </SettingsRowLabelContext.Provider>
      </div>
    </div>
  );
}
