use super::*;
use crate::agent_task_supervisor::utf8_tests::pump_output_chunks;
use std::collections::VecDeque;

#[test]
fn session_channel_chunks_preserve_long_slovak_and_emoji_output() {
    let text = format!(
        "{}{}",
        "a".repeat(SESSION_OUTPUT_CHUNK_BYTES - 1),
        "á€😀 Príliš žltý kôň úpěl ďábelské ódy. 世界\n".repeat(2000)
    );
    for read_size in [1, 3, 7, SESSION_OUTPUT_CHUNK_BYTES, text.len()] {
        let (sender, receiver) = sync_channel(TURN_CHANNEL_CAPACITY);
        let mut chunks = VecDeque::new();
        for read in text.as_bytes().chunks(read_size) {
            send_output_chunks(read, |chunk| {
                assert!(!chunk.is_empty());
                assert!(chunk.len() <= SESSION_OUTPUT_CHUNK_BYTES);
                if std::str::from_utf8(read).is_ok() {
                    assert!(std::str::from_utf8(&chunk).is_ok());
                }
                sender.try_send(chunk).unwrap();
                chunks.push_back(receiver.try_recv().unwrap());
                true
            });
        }
        assert_eq!(
            chunks.iter().flatten().copied().collect::<Vec<_>>(),
            text.as_bytes()
        );
        let events = pump_output_chunks(chunks);
        let output: String = events.iter().map(|event| event.chunk.as_str()).collect();
        assert_eq!(output, text);
        for (index, event) in events.iter().enumerate() {
            assert_eq!(event.sequence, index as u64 + 1);
            assert!(!event.chunk.is_empty());
            assert!(event.chunk.len() <= SESSION_OUTPUT_CHUNK_BYTES);
            assert!(std::str::from_utf8(event.chunk.as_bytes()).is_ok());
            assert!(!event.truncated);
        }
    }
}

#[test]
fn session_raw_fragments_preserve_invalid_and_truncated_bytes_until_pump_decoding() {
    let fragments = [
        b"valid\xff\xf0\x9f".as_slice(),
        b"\x98\x80\xe2\x82".as_slice(),
    ];
    let mut chunks = VecDeque::new();
    for fragment in fragments {
        send_output_chunks(fragment, |chunk| {
            chunks.push_back(chunk);
            true
        });
    }
    assert_eq!(
        chunks.iter().flatten().copied().collect::<Vec<_>>(),
        fragments.concat()
    );
    let events = pump_output_chunks(chunks);
    let output: String = events.iter().map(|event| event.chunk.as_str()).collect();
    assert_eq!(output, "valid\u{fffd}😀\u{fffd}");
}

#[test]
fn session_channel_ascii_and_character_boundary_passthrough() {
    let mut chunks = Vec::new();
    for text in ["", "ASCII\n", "žltý kôň 😀"] {
        send_output_chunks(text.as_bytes(), |chunk| {
            chunks.push(chunk);
            true
        });
    }
    assert_eq!(chunks, ["ASCII\n".as_bytes(), "žltý kôň 😀".as_bytes()]);
}

#[test]
fn session_channel_stops_on_failed_delivery() {
    for byte in [b'a', 0xff] {
        let mut delivered = 0;
        send_output_chunks(&vec![byte; SESSION_OUTPUT_CHUNK_BYTES * 2], |chunk| {
            assert!(chunk.len() <= SESSION_OUTPUT_CHUNK_BYTES);
            delivered += 1;
            false
        });
        assert_eq!(delivered, 1);
    }
}
