use crate::terminal::{TerminalEventSink, TerminalOutputEvent, TerminalRuntimeStatus};
use std::{
    io::Read,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Condvar, Mutex,
    },
    thread::{self, JoinHandle},
};

pub(crate) struct TerminalStartGate {
    changed: Condvar,
    ready: Mutex<bool>,
}

impl TerminalStartGate {
    pub(crate) fn new() -> Self {
        Self {
            changed: Condvar::new(),
            ready: Mutex::new(false),
        }
    }

    pub(crate) fn release(&self) {
        if let Ok(mut ready) = self.ready.lock() {
            *ready = true;
            self.changed.notify_all();
        }
    }

    pub(crate) fn wait(&self, stop_requested: &AtomicBool) -> bool {
        let mut ready = match self.ready.lock() {
            Ok(ready) => ready,
            Err(_) => return false,
        };
        while !*ready && !stop_requested.load(Ordering::SeqCst) {
            ready = match self.changed.wait(ready) {
                Ok(ready) => ready,
                Err(_) => return false,
            };
        }
        *ready && !stop_requested.load(Ordering::SeqCst)
    }
}

pub(crate) fn spawn_terminal_reader(
    mut reader: Box<dyn Read + Send>,
    sink: Arc<dyn TerminalEventSink>,
    start_gate: Arc<TerminalStartGate>,
    stop_requested: Arc<AtomicBool>,
    session_id: u64,
) -> Result<JoinHandle<()>, String> {
    thread::Builder::new()
        .name("terminal-reader".to_string())
        .spawn(move || {
            if !start_gate.wait(&stop_requested) {
                return;
            }
            let mut buffer = [0_u8; 8192];
            loop {
                if stop_requested.load(Ordering::SeqCst) {
                    return;
                }
                match reader.read(&mut buffer) {
                    Ok(0) => return,
                    Ok(count) => sink.emit_output(TerminalOutputEvent {
                        data: String::from_utf8_lossy(&buffer[..count]).to_string(),
                        session_id,
                    }),
                    Err(error) => {
                        if !stop_requested.load(Ordering::SeqCst) {
                            sink.emit_status(TerminalRuntimeStatus::Crashed {
                                message: format!("Terminal output stream failed: {error}"),
                                session_id,
                            });
                        }
                        return;
                    }
                }
            }
        })
        .map_err(|error| format!("Failed to start terminal reader: {error}"))
}
