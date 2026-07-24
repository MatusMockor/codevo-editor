// React uses this flag to verify that state updates in tests are coordinated
// through `act`. Keeping it in Vitest's shared setup makes the environment
// consistent for every React test, including updates scheduled during imports.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
