#[derive(Debug, Default)]
pub(crate) struct TerminalLineEndingTranslator {
    last_byte_was_carriage_return: bool,
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
        String::from_utf8_lossy(&self.translate(chunk)).into_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::TerminalLineEndingTranslator;

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
    fn translated_chunk_is_bounded_to_twice_the_input_bytes() {
        let chunk = vec![b'\n'; 8 * 1_024];
        let translated = TerminalLineEndingTranslator::default().translate(&chunk);
        assert_eq!(translated.len(), chunk.len() * 2);
        assert!(translated.chunks(2).all(|pair| pair == b"\r\n"));
    }
}
