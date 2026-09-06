import { checkoutDisplayLabel } from "./agentCheckoutSearch";
import { Fragment } from "react";
import { Check, TriangleAlert } from "lucide-react";
import { agentPickerGroupHeading, type AgentPickerOption } from "./agentPickerOption";
import type { AgentPickerConfirmation } from "./AgentPickerMenu";

interface AgentPickerRowsProps {
  readonly options: ReadonlyArray<AgentPickerOption>;
  readonly activeIndex: number;
  readonly value: string;
  readonly listId: string;
  readonly menuLayout: "default" | "checkout";
  readonly confirmation: AgentPickerConfirmation | null;
  onChoose(option: AgentPickerOption): void;
  onActiveIndex(index: number): void;
}

export function AgentPickerRows({
  options,
  activeIndex,
  value,
  listId,
  menuLayout,
  confirmation,
  onChoose,
  onActiveIndex,
}: AgentPickerRowsProps) {
  return (
    <>
      {options.map((option, index) => (
        <Fragment key={option.value}>
          {agentPickerGroupHeading(options, index) !== null && (
            <div className="agent-picker__group" role="presentation">
              {agentPickerGroupHeading(options, index)}
            </div>
          )}
          <div
            aria-selected={option.selected || option.value === value}
            className={optionClassName(option, index === activeIndex)}
            data-index={index}
            data-value={option.value}
            id={`${listId}-${index}`}
            onClick={() => onChoose(option)}
            onMouseEnter={() => onActiveIndex(index)}
            role="option"
            tabIndex={-1}
          >
            <span
              className={`agent-picker__mark${option.icon !== null ? " agent-picker__mark--icon" : ""}`}
              aria-hidden="true"
            >
              {option.icon ??
                (menuLayout !== "checkout" && option.value === value && <Check size={12} />)}
            </span>
            <span className="agent-picker__text">
              <span className="agent-picker__label">
                {option.tone === "danger" && (
                  <TriangleAlert aria-hidden="true" className="agent-picker__warn" size={11} />
                )}
                {menuLayout === "checkout" ? checkoutDisplayLabel(option.label) : option.label}
                {option.detail !== null && (
                  <span className="agent-picker__detail agent-num">{option.detail}</span>
                )}
              </span>
              {option.description !== null && (
                <span className="agent-picker__description">{option.description}</span>
              )}
            </span>
            {menuLayout === "checkout" && (option.selected || option.value === value) && (
              <Check aria-hidden="true" className="agent-picker__selection" size={14} />
            )}
          </div>
          {confirmation !== null &&
            option.value === value &&
            option.value === confirmation.value && (
              <label className="agent-picker__confirmation" htmlFor={confirmation.id}>
                <input
                  checked={confirmation.checked}
                  disabled={confirmation.disabled}
                  id={confirmation.id}
                  onChange={(event) => confirmation.onChange(event.target.checked)}
                  type="checkbox"
                />
                <span className="agent-picker__confirmation-copy">
                  <span className="agent-picker__confirmation-label">{confirmation.label}</span>
                  {confirmation.description !== null && (
                    <span className="agent-picker__confirmation-description">
                      {confirmation.description}
                    </span>
                  )}
                </span>
              </label>
            )}
        </Fragment>
      ))}
    </>
  );
}

function optionClassName(option: AgentPickerOption, active: boolean): string {
  const classes = ["agent-picker__option"];
  if (active) classes.push("agent-picker__option--active");
  if (option.tone !== null) classes.push(`agent-picker__option--${option.tone}`);
  return classes.join(" ");
}
