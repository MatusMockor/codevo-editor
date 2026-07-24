use crate::{terminal_process_tree::ProcessTreeTerminator, terminal_session::TerminalChild};

/// Owns a spawned terminal child until another component has accepted full
/// responsibility for terminating and reaping it.
pub(crate) struct UnpublishedTerminalChild {
    child: Option<Box<dyn TerminalChild>>,
    terminator: ProcessTreeTerminator,
}

impl UnpublishedTerminalChild {
    pub(crate) fn new(child: Box<dyn TerminalChild>) -> Self {
        let process_id = child.process_id();
        let killer = child.clone_killer();
        Self {
            child: Some(child),
            terminator: ProcessTreeTerminator::new(process_id, killer),
        }
    }

    pub(crate) fn child(&self) -> &dyn TerminalChild {
        self.child.as_deref().expect("armed child guard")
    }

    pub(crate) fn take(mut self) -> Box<dyn TerminalChild> {
        self.child.take().expect("armed child guard")
    }
}

impl Drop for UnpublishedTerminalChild {
    fn drop(&mut self) {
        if let Some(child) = self.child.as_deref_mut() {
            self.terminator.terminate_unpublished(child);
        }
    }
}
