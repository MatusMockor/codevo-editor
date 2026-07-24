use std::sync::{Condvar, Mutex};

/// Linearizes an adapter's potentially synchronous finish callback with its
/// session registration, preventing an early exit from racing registry state.
#[derive(Default)]
pub(super) struct DebugFinishGate {
    registered: Mutex<Option<bool>>,
    ready: Condvar,
}

impl DebugFinishGate {
    pub(super) fn complete(&self, registered: bool) {
        if let Ok(mut state) = self.registered.lock() {
            *state = Some(registered);
            self.ready.notify_all();
        }
    }

    pub(super) fn wait_until_registered(&self) -> bool {
        let Ok(state) = self.registered.lock() else {
            return false;
        };
        self.ready
            .wait_while(state, |state| state.is_none())
            .ok()
            .and_then(|state| *state)
            .unwrap_or(false)
    }
}
