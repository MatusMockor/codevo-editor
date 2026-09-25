use crate::terminal::{TerminalEventSink, TerminalOutputEvent};
use std::io::Read;

const MAX_PENDING_UTF8_BYTES: usize = 3;

#[derive(Debug)]
pub(crate) enum TerminalRead {
    Chunk { text: String, len: usize },
    End { text: String },
    Failed { text: String, error: std::io::Error },
}

#[derive(Debug, Default)]
pub(crate) struct TerminalLineEndingTranslator {
    last_byte_was_carriage_return: bool,
    pending_utf8: Vec<u8>,
}

impl TerminalLineEndingTranslator {
    pub(crate) fn translate(&mut self, chunk: &[u8]) -> Vec<u8> {
        let line_feeds = chunk.iter().filter(|byte| **byte == b'\n').count();
        let mut translated = Vec::with_capacity(chunk.len() + line_feeds);
        for &byte in chunk {
            if byte == b'\n' && !self.last_byte_was_carriage_return {
                translated.push(b'\r');
            }
            translated.push(byte);
            self.last_byte_was_carriage_return = byte == b'\r';
        }
        translated
    }

    pub(crate) fn translate_to_terminal_text(&mut self, chunk: &[u8]) -> String {
        let mut bytes = std::mem::take(&mut self.pending_utf8);
        bytes.extend_from_slice(&self.translate(chunk));
        let complete = bytes.len() - incomplete_utf8_tail_len(&bytes);
        self.pending_utf8 = bytes.split_off(complete);
        String::from_utf8_lossy(&bytes).into_owned()
    }

    pub(crate) fn read_terminal_text<R: Read + ?Sized>(
        &mut self,
        reader: &mut R,
        buffer: &mut [u8],
    ) -> TerminalRead {
        match reader.read(buffer) {
            Ok(0) => TerminalRead::End {
                text: self.finish_terminal_text(),
            },
            Ok(len) => TerminalRead::Chunk {
                text: self.translate_to_terminal_text(&buffer[..len]),
                len,
            },
            Err(error) => TerminalRead::Failed {
                text: self.finish_terminal_text(),
                error,
            },
        }
    }

    pub(crate) fn finish_terminal_text(&mut self) -> String {
        let pending = std::mem::take(&mut self.pending_utf8);
        String::from_utf8_lossy(&pending).into_owned()
    }

    #[cfg(test)]
    fn pending_utf8_len(&self) -> usize {
        self.pending_utf8.len()
    }
}

pub(crate) fn emit_terminal_text(sink: &dyn TerminalEventSink, data: String, session_id: u64) {
    if data.is_empty() {
        return;
    }
    sink.emit_output(TerminalOutputEvent { data, session_id });
}

fn incomplete_utf8_tail_len(bytes: &[u8]) -> usize {
    let start = bytes.len().saturating_sub(MAX_PENDING_UTF8_BYTES);
    let Some(lead) = (start..bytes.len())
        .rev()
        .find(|&index| bytes[index] & 0xC0 != 0x80)
    else {
        return 0;
    };
    let tail = &bytes[lead..];
    match std::str::from_utf8(tail) {
        Err(error) if error.valid_up_to() == 0 && error.error_len().is_none() => tail.len(),
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::{TerminalLineEndingTranslator, TerminalRead};

    fn translate_chunks(chunks: &[&[u8]]) -> Vec<Vec<u8>> {
        let mut translator = TerminalLineEndingTranslator::default();
        chunks
            .iter()
            .map(|chunk| translator.translate(chunk))
            .collect()
    }

    #[test]
    fn lone_line_feed_becomes_carriage_return_line_feed() {
        assert_eq!(translate_chunks(&[b"a\nb\n"]), [b"a\r\nb\r\n".to_vec()]);
    }

    #[test]
    fn existing_carriage_return_line_feed_is_never_doubled() {
        assert_eq!(translate_chunks(&[b"a\r\nb\r\n"]), [b"a\r\nb\r\n".to_vec()]);
    }

    #[test]
    fn carriage_return_at_chunk_end_pairs_with_line_feed_at_next_chunk_start() {
        assert_eq!(
            translate_chunks(&[b"a\r", b"\nb"]),
            [b"a\r".to_vec(), b"\nb".to_vec()]
        );
    }

    #[test]
    fn line_feed_after_a_chunk_ending_without_carriage_return_is_translated() {
        assert_eq!(
            translate_chunks(&[b"a", b"\nb"]),
            [b"a".to_vec(), b"\r\nb".to_vec()]
        );
    }

    #[test]
    fn lone_carriage_return_is_preserved_for_progress_redraws() {
        assert_eq!(
            translate_chunks(&[b"10%\r20%\r", b"30%"]),
            [b"10%\r20%\r".to_vec(), b"30%".to_vec()]
        );
    }

    #[test]
    fn empty_chunks_emit_nothing_and_keep_pending_carriage_return_state() {
        assert_eq!(
            translate_chunks(&[b"", b"a\r", b"", b"\n", b""]),
            [
                Vec::new(),
                b"a\r".to_vec(),
                Vec::new(),
                b"\n".to_vec(),
                Vec::new()
            ]
        );
    }

    #[test]
    fn multibyte_utf8_around_line_feeds_stays_intact() {
        let mut translator = TerminalLineEndingTranslator::default();
        assert_eq!(
            translator.translate_to_terminal_text("žluť\n✓ 🚀\r\nkôň\n".as_bytes()),
            "žluť\r\n✓ 🚀\r\nkôň\r\n"
        );
    }

    #[test]
    fn multibyte_character_split_across_chunks_is_decoded_once_complete() {
        let bytes = "a🚀b✓".as_bytes();
        let mut translator = TerminalLineEndingTranslator::default();
        let texts: Vec<String> = [&bytes[..2], &bytes[2..4], &bytes[4..7], &bytes[7..]]
            .iter()
            .map(|chunk| translator.translate_to_terminal_text(chunk))
            .collect();
        assert_eq!(texts, ["a", "", "🚀b", "✓"]);
        assert_eq!(translator.finish_terminal_text(), "");
    }

    #[test]
    fn line_feed_after_split_multibyte_character_is_translated() {
        let bytes = "ž\n".as_bytes();
        let mut translator = TerminalLineEndingTranslator::default();
        assert_eq!(translator.translate_to_terminal_text(&bytes[..1]), "");
        assert_eq!(translator.translate_to_terminal_text(&bytes[1..]), "ž\r\n");
    }

    #[test]
    fn pending_utf8_tail_never_exceeds_three_bytes() {
        let mut translator = TerminalLineEndingTranslator::default();
        assert_eq!(
            translator.translate_to_terminal_text(&[0xF0, 0x9F, 0x9A]),
            ""
        );
        assert_eq!(translator.pending_utf8_len(), 3);
        assert_eq!(translator.translate_to_terminal_text(&[0xF0]), "\u{FFFD}");
        assert_eq!(translator.pending_utf8_len(), 1);
    }

    #[test]
    fn invalid_bytes_are_replaced_immediately_instead_of_held() {
        let mut translator = TerminalLineEndingTranslator::default();
        assert_eq!(
            translator.translate_to_terminal_text(&[b'a', 0xFF]),
            "a\u{FFFD}"
        );
        assert_eq!(
            translator.translate_to_terminal_text(&[0xE0, 0x80]),
            "\u{FFFD}\u{FFFD}"
        );
        assert_eq!(translator.pending_utf8_len(), 0);
    }

    #[test]
    fn incomplete_tail_is_flushed_as_replacement_on_end_of_stream() {
        let mut translator = TerminalLineEndingTranslator::default();
        assert_eq!(
            translator.translate_to_terminal_text(&[b'x', 0xE2, 0x9C]),
            "x"
        );
        assert_eq!(translator.finish_terminal_text(), "\u{FFFD}");
        assert_eq!(translator.finish_terminal_text(), "");
    }

    #[test]
    fn translated_chunk_is_bounded_to_twice_the_input_bytes() {
        let chunk = vec![b'\n'; 8 * 1_024];
        let translated = TerminalLineEndingTranslator::default().translate(&chunk);
        assert_eq!(translated.len(), chunk.len() * 2);
        assert!(translated.chunks(2).all(|pair| pair == b"\r\n"));
    }

    struct FailingAfterReader(Vec<Vec<u8>>);

    impl std::io::Read for FailingAfterReader {
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
    fn read_error_flushes_the_pending_utf8_tail_with_the_error() {
        let mut translator = TerminalLineEndingTranslator::default();
        let mut reader = FailingAfterReader(vec![vec![b'x', 0xE2, 0x9C]]);
        let mut buffer = [0_u8; 16];

        let TerminalRead::Chunk { text, len } =
            translator.read_terminal_text(&mut reader, &mut buffer)
        else {
            panic!("expected a chunk");
        };
        assert_eq!((text.as_str(), len), ("x", 3));
        let TerminalRead::Failed { text, error } =
            translator.read_terminal_text(&mut reader, &mut buffer)
        else {
            panic!("expected a read failure");
        };
        assert_eq!(text, "\u{FFFD}");
        assert_eq!(error.to_string(), "pipe broke");
        assert_eq!(translator.pending_utf8_len(), 0);
    }

    #[test]
    fn end_of_stream_flushes_the_pending_utf8_tail() {
        let mut translator = TerminalLineEndingTranslator::default();
        let mut reader = std::io::Cursor::new(vec![b'x', 0xE2, 0x9C]);
        let mut buffer = [0_u8; 16];

        assert!(matches!(
            translator.read_terminal_text(&mut reader, &mut buffer),
            TerminalRead::Chunk { len: 3, .. }
        ));
        let TerminalRead::End { text } = translator.read_terminal_text(&mut reader, &mut buffer)
        else {
            panic!("expected end of stream");
        };
        assert_eq!(text, "\u{FFFD}");
    }
}
