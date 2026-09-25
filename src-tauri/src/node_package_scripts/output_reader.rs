use super::NodePackageTaskOutputObserver;
use crate::{
    node_package_problem_matcher::NodePackageTaskOutputStream,
    terminal::TerminalEventSink,
    terminal_line_endings::{emit_terminal_text, TerminalLineEndingTranslator, TerminalRead},
};
use std::{io::Read, sync::Arc, thread};

pub(super) fn spawn_output_reader<R: Read + Send + 'static>(
    mut reader: R,
    sink: Arc<dyn TerminalEventSink>,
    observer: Arc<dyn NodePackageTaskOutputObserver>,
    session_id: u64,
    stream: NodePackageTaskOutputStream,
) -> thread::JoinHandle<Result<(), String>> {
    thread::spawn(move || {
        let result = (|| {
            let mut buffer = [0_u8; 8192];
            let mut line_endings = TerminalLineEndingTranslator::default();
            loop {
                match line_endings.read_terminal_text(&mut reader, &mut buffer) {
                    TerminalRead::Chunk { text, len } => {
                        emit_terminal_text(sink.as_ref(), text, session_id);
                        observer.observe(stream, &buffer[..len]);
                    }
                    TerminalRead::End { text } => {
                        emit_terminal_text(sink.as_ref(), text, session_id);
                        return Ok(());
                    }
                    TerminalRead::Failed { text, error } => {
                        emit_terminal_text(sink.as_ref(), text, session_id);
                        return Err(format!(
                            "Failed to read package script {}: {error}",
                            stream_name(stream)
                        ));
                    }
                }
            }
        })();
        observer.finish(stream);
        result
    })
}

fn stream_name(stream: NodePackageTaskOutputStream) -> &'static str {
    match stream {
        NodePackageTaskOutputStream::Stdout => "stdout",
        NodePackageTaskOutputStream::Stderr => "stderr",
    }
}

pub(super) fn join_output_reader(
    reader: Option<thread::JoinHandle<Result<(), String>>>,
) -> Result<(), String> {
    let Some(reader) = reader else {
        return Ok(());
    };
    reader
        .join()
        .map_err(|_| "Package script output reader panicked.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terminal::{TerminalOutputEvent, TerminalRuntimeStatus};
    use std::{fs::File, io::Cursor, path::Path, sync::Mutex};

    #[derive(Default)]
    struct RecordingSink(Mutex<Vec<u8>>);

    impl TerminalEventSink for RecordingSink {
        fn emit_output(&self, event: TerminalOutputEvent) {
            self.0
                .lock()
                .expect("terminal bytes")
                .extend_from_slice(event.data.as_bytes());
        }

        fn emit_status(&self, _status: TerminalRuntimeStatus) {}
    }

    #[derive(Default)]
    struct RecordingObserver(Mutex<Vec<u8>>);

    impl NodePackageTaskOutputObserver for RecordingObserver {
        fn prepare(
            &self,
            _workspace_root: &File,
            _workspace_path: &Path,
            _package_directory: &File,
            _package_path: &Path,
        ) -> Result<(), String> {
            Ok(())
        }

        fn observe(&self, _stream: NodePackageTaskOutputStream, bytes: &[u8]) {
            self.0
                .lock()
                .expect("observer bytes")
                .extend_from_slice(bytes);
        }

        fn finish(&self, _stream: NodePackageTaskOutputStream) {}

        fn finish_task(&self, _preserve_problems: bool) {}
    }

    struct ChunkedReader(Vec<Vec<u8>>);

    impl Read for ChunkedReader {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            if self.0.is_empty() {
                return Ok(0);
            }
            let chunk = self.0.remove(0);
            buffer[..chunk.len()].copy_from_slice(&chunk);
            Ok(chunk.len())
        }
    }

    #[test]
    fn multibyte_character_split_between_reads_reaches_terminal_intact() {
        let raw = "ok 🚀 kôň\n".as_bytes();
        let chunks = vec![raw[..4].to_vec(), raw[4..11].to_vec(), raw[11..].to_vec()];
        let sink = Arc::new(RecordingSink::default());
        let observer = Arc::new(RecordingObserver::default());

        let reader = spawn_output_reader(
            ChunkedReader(chunks),
            Arc::clone(&sink) as Arc<dyn TerminalEventSink>,
            Arc::clone(&observer) as Arc<dyn NodePackageTaskOutputObserver>,
            3,
            NodePackageTaskOutputStream::Stdout,
        );
        join_output_reader(Some(reader)).expect("reader finishes");

        assert_eq!(
            *sink.0.lock().expect("terminal bytes"),
            "ok 🚀 kôň\r\n".as_bytes()
        );
    }

    struct FailingAfterReader(Vec<Vec<u8>>);

    impl Read for FailingAfterReader {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            if self.0.is_empty() {
                return Err(std::io::Error::other("pipe broke"));
            }
            let chunk = self.0.remove(0);
            buffer[..chunk.len()].copy_from_slice(&chunk);
            Ok(chunk.len())
        }
    }

    #[test]
    fn pending_multibyte_tail_is_flushed_before_a_read_error_propagates() {
        let sink = Arc::new(RecordingSink::default());
        let observer = Arc::new(RecordingObserver::default());

        let reader = spawn_output_reader(
            FailingAfterReader(vec![vec![b'x', 0xE2, 0x9C]]),
            Arc::clone(&sink) as Arc<dyn TerminalEventSink>,
            Arc::clone(&observer) as Arc<dyn NodePackageTaskOutputObserver>,
            3,
            NodePackageTaskOutputStream::Stdout,
        );
        let error = join_output_reader(Some(reader)).expect_err("read error propagates");

        assert!(error.contains("pipe broke"), "{error}");
        assert_eq!(
            *sink.0.lock().expect("terminal bytes"),
            "x\u{FFFD}".as_bytes()
        );
    }

    #[test]
    fn truncated_multibyte_character_is_flushed_at_end_of_stream() {
        let sink = Arc::new(RecordingSink::default());
        let observer = Arc::new(RecordingObserver::default());

        let reader = spawn_output_reader(
            ChunkedReader(vec![vec![b'x', 0xE2, 0x9C]]),
            Arc::clone(&sink) as Arc<dyn TerminalEventSink>,
            Arc::clone(&observer) as Arc<dyn NodePackageTaskOutputObserver>,
            3,
            NodePackageTaskOutputStream::Stdout,
        );
        join_output_reader(Some(reader)).expect("reader finishes");

        assert_eq!(
            *sink.0.lock().expect("terminal bytes"),
            "x\u{FFFD}".as_bytes()
        );
    }

    #[test]
    fn piped_script_output_reaches_terminal_as_crlf_while_observer_keeps_raw_bytes() {
        let raw = "src/a.ts(1,2): error TS1: ž\nnext\r\nlast\n".as_bytes();
        let sink = Arc::new(RecordingSink::default());
        let observer = Arc::new(RecordingObserver::default());

        let reader = spawn_output_reader(
            Cursor::new(raw.to_vec()),
            Arc::clone(&sink) as Arc<dyn TerminalEventSink>,
            Arc::clone(&observer) as Arc<dyn NodePackageTaskOutputObserver>,
            3,
            NodePackageTaskOutputStream::Stdout,
        );
        join_output_reader(Some(reader)).expect("reader finishes");

        assert_eq!(
            *sink.0.lock().expect("terminal bytes"),
            "src/a.ts(1,2): error TS1: ž\r\nnext\r\nlast\r\n".as_bytes()
        );
        assert_eq!(*observer.0.lock().expect("observer bytes"), raw);
    }
}
