use super::*;

#[test]
fn decoder_preserves_every_multibyte_split() {
    for text in ["á", "€", "😀"] {
        for split in 1..text.len() {
            let mut decoder = Utf8ChunkDecoder::default();
            let first = decoder.push(&text.as_bytes()[..split]);
            assert!(first.is_empty());
            assert_eq!(decoder.carry_len, split);
            assert_eq!(decoder.push(&text.as_bytes()[split..]), text);
            assert_eq!(decoder.finish(), None);
        }
    }
}

#[test]
fn decoder_preserves_single_byte_pushes() {
    for text in ["á", "€", "😀"] {
        let mut decoder = Utf8ChunkDecoder::default();
        let mut decoded = String::new();
        for byte in text.as_bytes() {
            decoded.push_str(&decoder.push(&[*byte]));
            assert!(decoder.carry_len <= 3);
        }
        assert_eq!(decoded, text);
        assert_eq!(decoder.finish(), None);
    }
}

#[test]
fn decoder_replaces_invalid_sequences_and_continues() {
    for bytes in [&b"before\xffafter"[..], &b"before\xe2\x82after"[..]] {
        let mut decoder = Utf8ChunkDecoder::default();
        assert_eq!(decoder.push(bytes), "before\u{fffd}after");
        assert_eq!(decoder.finish(), None);
    }
    let mut decoder = Utf8ChunkDecoder::default();
    assert_eq!(decoder.push(&[0x80]), "\u{fffd}");
    assert_eq!(decoder.push(b"valid"), "valid");
    assert_eq!(decoder.finish(), None);
    assert_eq!(decoder.push(&[0xe2, 0x82]), "");
    assert_eq!(decoder.push(b"valid"), "\u{fffd}valid");
}

#[test]
fn decoder_flushes_truncated_sequences_once() {
    for text in ["á", "€", "😀"] {
        for end in 1..text.len() {
            let mut decoder = Utf8ChunkDecoder::default();
            assert_eq!(decoder.push(&text.as_bytes()[..end]), "");
            assert_eq!(decoder.finish().as_deref(), Some("\u{fffd}"));
            assert_eq!(decoder.carry_len, 0);
            assert_eq!(decoder.finish(), None);
            assert_eq!(decoder.push(b"next"), "next");
        }
    }
}

#[test]
fn decoder_carry_stays_bounded_across_deterministic_splits() {
    let text = "Príliš žltý kôň úpěl ďábelské ódy. € 世界 😀🦀\n".repeat(2000);
    for seed in 1..=32_u64 {
        let mut random = seed;
        let mut decoder = Utf8ChunkDecoder::default();
        let mut rest = text.as_bytes();
        let mut decoded = String::new();
        while !rest.is_empty() {
            random = random.wrapping_mul(6364136223846793005).wrapping_add(1);
            let count =
                (1 + (random >> 32) as usize % MAX_AGENT_OUTPUT_CHUNK_BYTES).min(rest.len());
            decoded.push_str(&decoder.push(&rest[..count]));
            assert!(decoder.carry_len <= 3);
            rest = &rest[count..];
        }
        assert_eq!(decoder.finish(), None);
        assert_eq!(decoded, text);
    }
}

#[test]
fn decoder_ascii_and_character_boundary_passthrough() {
    let mut decoder = Utf8ChunkDecoder::default();
    for text in ["", "hello\n", "world\0", "á€😀", "žltý kôň"] {
        assert_eq!(decoder.push(text.as_bytes()), text);
        assert_eq!(decoder.carry_len, 0);
    }
    assert_eq!(decoder.finish(), None);
}

#[derive(Default)]
struct RecordingSink(Mutex<Vec<AgentTaskOutputEvent>>);

impl AgentTaskEventSink for RecordingSink {
    fn status(&self, _: AgentTaskStatusEvent) {}

    fn output(&self, event: AgentTaskOutputEvent) {
        self.0.lock().unwrap().push(event);
    }
}

fn output_fixture() -> (Arc<AgentTaskShared>, Arc<RecordingSink>) {
    let sink = Arc::new(RecordingSink::default());
    let mut state = AgentTaskRegistryState::default();
    state.entries.insert(
        "utf8".to_string(),
        AgentTaskEntry {
            completion_claimed: false,
            cwd_authority: None,
            admission: None,
            metadata: AgentTaskMetadata {
                task_id: "utf8".to_string(),
                thread_id: "thread".to_string(),
                workspace_id: "workspace".to_string(),
                repository_root: PathBuf::from("/test"),
                cwd: PathBuf::from("/test"),
                isolation: AgentTaskIsolation::InPlace,
                worktree_path: None,
            },
            phase: AgentTaskPhase::Running,
            acknowledged: true,
            flushing: false,
            queued: VecDeque::new(),
            status_sequence: 0,
            output_sequence: 0,
            output_incomplete_reported: false,
            outstanding_output: VecDeque::new(),
            last_acknowledged_output: 0,
            stdout_at_line_boundary: true,
            stderr_at_line_boundary: true,
            stop_requested: false,
            interrupt_requested: false,
            watchdog_timed_out: false,
            group: None,
            input: None,
            questions: None,
            watchdog: Arc::new(WatchdogGate::default()),
        },
    );
    (
        Arc::new(AgentTaskShared {
            sink: sink.clone(),
            signals: system_process_group_signals(),
            tuning: AgentTaskRuntimeTuning::default(),
            live_worker_threads: Arc::new(AtomicUsize::new(0)),
            output_emission_order: Mutex::new(()),
            state: Mutex::new(state),
            fail_next_waiter_start: AtomicBool::new(false),
        }),
        sink,
    )
}

struct SplitReader {
    bytes: VecDeque<Vec<u8>>,
    end: io::ErrorKind,
    cancellation: Option<Arc<AtomicBool>>,
}

impl Read for SplitReader {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        let Some(bytes) = self.bytes.pop_front() else {
            if self.end == io::ErrorKind::UnexpectedEof {
                return Ok(0);
            }
            return Err(self.end.into());
        };
        assert!(bytes.len() <= buffer.len());
        buffer[..bytes.len()].copy_from_slice(&bytes);
        if self.bytes.is_empty() {
            if let Some(cancellation) = &self.cancellation {
                cancellation.store(true, Ordering::SeqCst);
            }
        }
        Ok(bytes.len())
    }
}

pub(crate) fn pump_output_chunks(chunks: VecDeque<Vec<u8>>) -> Vec<AgentTaskOutputEvent> {
    let (shared, sink) = output_fixture();
    let reader = SplitReader {
        bytes: chunks,
        end: io::ErrorKind::UnexpectedEof,
        cancellation: None,
    };
    run_output_pump(
        &shared,
        "utf8",
        AgentTaskOutputStream::Stdout,
        Box::new(reader),
        &AtomicBool::new(false),
        None,
    );
    let events = sink.0.lock().unwrap().clone();
    events
}

#[test]
fn pump_preserves_long_slovak_and_emoji_output() {
    let text = format!(
        "{}{}",
        "a".repeat(MAX_AGENT_OUTPUT_CHUNK_BYTES - 1),
        "á€😀 Príliš žltý kôň úpěl ďábelské ódy. 世界\n".repeat(2000)
    );
    let (shared, sink) = output_fixture();
    for stream in [AgentTaskOutputStream::Stdout, AgentTaskOutputStream::Stderr] {
        let reader = SplitReader {
            bytes: text
                .as_bytes()
                .chunks(MAX_AGENT_OUTPUT_CHUNK_BYTES)
                .map(<[u8]>::to_vec)
                .collect(),
            end: io::ErrorKind::UnexpectedEof,
            cancellation: None,
        };
        run_output_pump(
            &shared,
            "utf8",
            stream,
            Box::new(reader),
            &AtomicBool::new(false),
            None,
        );
    }
    let events = sink.0.lock().unwrap();
    for stream in [AgentTaskOutputStream::Stdout, AgentTaskOutputStream::Stderr] {
        let mut output = String::new();
        let mut at_boundary = true;
        for event in events.iter().filter(|event| event.stream == stream) {
            assert!(!event.chunk.is_empty());
            assert!(event.chunk.len() <= MAX_AGENT_OUTPUT_CHUNK_BYTES);
            assert!(std::str::from_utf8(event.chunk.as_bytes()).is_ok());
            assert!(!event.truncated);
            assert_eq!(event.starts_at_line_boundary, at_boundary);
            at_boundary = event.chunk.ends_with('\n');
            output.push_str(&event.chunk);
        }
        assert_eq!(output, text);
    }
    for (index, event) in events.iter().enumerate() {
        assert_eq!(event.sequence, index as u64 + 1);
    }
}

#[test]
fn pump_flushes_carry_before_eof_error_and_cancellation() {
    for end in [io::ErrorKind::UnexpectedEof, io::ErrorKind::BrokenPipe] {
        for cancelled in [false, true] {
            let (shared, sink) = output_fixture();
            let cancellation = Arc::new(AtomicBool::new(false));
            let reader = SplitReader {
                bytes: VecDeque::from([b"line\n\xf0\x9f\x98".to_vec()]),
                end,
                cancellation: cancelled.then(|| Arc::clone(&cancellation)),
            };
            run_output_pump(
                &shared,
                "utf8",
                AgentTaskOutputStream::Stdout,
                Box::new(reader),
                &cancellation,
                None,
            );
            let events = sink.0.lock().unwrap();
            assert_eq!(events[0].chunk, "line\n");
            assert_eq!(events[1].chunk, "\u{fffd}");
            assert!(events[1].starts_at_line_boundary);
            assert!(!events[1].truncated);
            let error_marker = end == io::ErrorKind::BrokenPipe && !cancelled;
            assert_eq!(events.len(), 2 + usize::from(error_marker));
            if error_marker {
                assert!(events[2].truncated);
                assert!(events[2].chunk.is_empty());
                assert!(!events[2].starts_at_line_boundary);
            }
            for (index, event) in events.iter().enumerate() {
                assert_eq!(event.sequence, index as u64 + 1);
            }
        }
    }
}

#[test]
fn pump_sanitizes_nul_and_bounds_invalid_byte_expansion() {
    let (shared, sink) = output_fixture();
    let reader = SplitReader {
        bytes: VecDeque::from([vec![0xff; MAX_AGENT_OUTPUT_CHUNK_BYTES], b"\0tail".to_vec()]),
        end: io::ErrorKind::UnexpectedEof,
        cancellation: None,
    };
    run_output_pump(
        &shared,
        "utf8",
        AgentTaskOutputStream::Stdout,
        Box::new(reader),
        &AtomicBool::new(false),
        None,
    );
    let events = sink.0.lock().unwrap();
    assert!(events
        .iter()
        .all(|event| !event.chunk.is_empty() && event.chunk.len() <= MAX_AGENT_OUTPUT_CHUNK_BYTES));
    let output: String = events.iter().map(|event| event.chunk.as_str()).collect();
    assert_eq!(
        output,
        format!(
            "{}tail",
            "\u{fffd}".repeat(MAX_AGENT_OUTPUT_CHUNK_BYTES + 1)
        )
    );
}
