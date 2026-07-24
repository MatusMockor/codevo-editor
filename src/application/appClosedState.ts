import type { GitChangeStatus } from "../domain/git";

export const EMPTY_FILE_STATUSES_BY_PATH: Record<string, GitChangeStatus> = {};

export const CLOSED_PHP_CHANGE_SIGNATURE = {
  addRow: () => undefined,
  apply: async () => undefined,
  close: () => undefined,
  open: async () => undefined,
  state: {
    affectedFiles: [],
    error: null,
    isApplying: false,
    isLoading: false,
    isOpen: false,
    invalidRowId: null,
    preview: null,
    rows: [],
  },
  updateRows: () => undefined,
};
