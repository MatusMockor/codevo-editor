use super::NodePackageTaskOutputObserver;
use crate::{
    node_package_problem_matcher::NodePackageTaskOutputStream,
    terminal::{TerminalEventSink, TerminalOutputEvent},
    terminal_line_endings::TerminalLineEndingTranslator,
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
                let count = reader.read(&mut buffer).map_err(|error| {
                    format!(
                        "Failed to read package script {}: {error}",
                        stream_name(stream)
                    )
                })?;
                if count == 0 {
                    return Ok(());
                }
                sink.emit_output(TerminalOutputEvent {
                    data: line_endings.translate_to_terminal_text(&buffer[..count]),
                    session_id,
                });
                observer.observe(stream, &buffer[..count]);
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
    use crate::terminal::TerminalRuntimeStatus;
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
