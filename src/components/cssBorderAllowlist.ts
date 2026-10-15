export type BorderRuleEntry = {
  readonly sheet: string;
  readonly selector: string;
};

export const SEPARATOR_INSET_CONSUMERS: readonly BorderRuleEntry[] = [];

export const LEGACY_BORDER_RATCHET: readonly BorderRuleEntry[] = [];

export const PENDING_SCOPE: readonly BorderRuleEntry[] = [];
