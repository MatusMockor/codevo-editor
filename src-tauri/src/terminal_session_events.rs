use crate::incremental_utf8::IncrementalUtf8Decoder;
use crate::terminal::{TerminalEventSink, TerminalRuntimeStatus};
use crate::terminal_line_endings::emit_terminal_text;
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
            let mut decoder = IncrementalUtf8Decoder::default();
            loop {
                if stop_requested.load(Ordering::SeqCst) {
                    return;
                }
                match reader.read(&mut buffer) {
                    Ok(0) => {
                        emit_terminal_text(&*sink, decoder.finish(), session_id);
                        return;
                    }
                    Ok(count) => {
                        emit_terminal_text(&*sink, decoder.push(&buffer[..count]), session_id);
                    }
                    Err(error) => {
                        emit_terminal_text(&*sink, decoder.finish(), session_id);
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terminal::TerminalOutputEvent;
    use std::{collections::VecDeque, io};

    struct ChunkedReader(VecDeque<Vec<u8>>);

    impl Read for ChunkedReader {
        fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
            let Some(chunk) = self.0.pop_front() else {
                return Ok(0);
            };
            buffer[..chunk.len()].copy_from_slice(&chunk);
            Ok(chunk.len())
        }
    }

    #[derive(Default)]
    struct RecordingSink(Mutex<Vec<String>>);

    impl TerminalEventSink for RecordingSink {
        fn emit_output(&self, event: TerminalOutputEvent) {
            self.0.lock().unwrap().push(event.data);
        }

        fn emit_status(&self, _status: TerminalRuntimeStatus) {}
    }

    fn read_all(chunks: VecDeque<Vec<u8>>) -> Vec<String> {
        let sink = Arc::new(RecordingSink::default());
        let gate = Arc::new(TerminalStartGate::new());
        gate.release();
        let handle = spawn_terminal_reader(
            Box::new(ChunkedReader(chunks)),
            Arc::clone(&sink) as Arc<dyn TerminalEventSink>,
            gate,
            Arc::new(AtomicBool::new(false)),
            7,
        )
        .unwrap();
        handle.join().unwrap();
        let events = sink.0.lock().unwrap().clone();
        events
    }

    #[test]
    fn multibyte_text_split_at_every_boundary_is_emitted_losslessly() {
        let text = "ASCII žltý kôň 🦀 koniec";
        for split in 0..=text.len() {
            let bytes = text.as_bytes();
            let chunks = [bytes[..split].to_vec(), bytes[split..].to_vec()]
                .into_iter()
                .filter(|chunk| !chunk.is_empty())
                .collect::<VecDeque<_>>();
            let events = read_all(chunks);

            assert_eq!(events.concat(), text, "split at byte {split}");
            assert!(
                events.iter().all(|event| !event.is_empty()),
                "split at byte {split}"
            );
        }
    }

    #[test]
    fn invalid_and_truncated_bytes_are_replaced_instead_of_buffered() {
        let events = read_all(VecDeque::from([b"a\xffb".to_vec(), b"\xf0\x9f".to_vec()]));
        assert_eq!(events.concat(), "a\u{fffd}b\u{fffd}");
    }
}
