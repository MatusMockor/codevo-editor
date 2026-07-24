//! Incremental UTF-8 decoding for tagged task output.
//!
//! Raw terminal output deliberately bypasses this state. Each tagged stream retains only an
//! incomplete UTF-8 suffix between operating-system reads and flushes it exactly once at EOF.

use crate::node_package_problem_matcher::NodePackageTaskOutputStream;

#[derive(Default)]
pub(crate) struct TaggedOutputDecoders {
    stderr: IncrementalUtf8Decoder,
    stdout: IncrementalUtf8Decoder,
}

impl TaggedOutputDecoders {
    fn decoder(&mut self, stream: NodePackageTaskOutputStream) -> &mut IncrementalUtf8Decoder {
        match stream {
            NodePackageTaskOutputStream::Stdout => &mut self.stdout,
            NodePackageTaskOutputStream::Stderr => &mut self.stderr,
        }
    }

    pub(crate) fn push(&mut self, stream: NodePackageTaskOutputStream, bytes: &[u8]) -> String {
        self.decoder(stream).push(bytes)
    }

    pub(crate) fn finish(&mut self, stream: NodePackageTaskOutputStream) -> String {
        self.decoder(stream).finish()
    }
}

#[derive(Default)]
struct IncrementalUtf8Decoder {
    pending: Vec<u8>,
}

impl IncrementalUtf8Decoder {
    fn push(&mut self, bytes: &[u8]) -> String {
        let mut input = std::mem::take(&mut self.pending);
        input.extend_from_slice(bytes);
        let mut output = String::new();
        let mut remaining = input.as_slice();
        while !remaining.is_empty() {
            match std::str::from_utf8(remaining) {
                Ok(valid) => {
                    output.push_str(valid);
                    break;
                }
                Err(error) => {
                    let valid_up_to = error.valid_up_to();
                    if valid_up_to > 0 {
                        output.push_str(
                            std::str::from_utf8(&remaining[..valid_up_to])
                                .expect("Utf8Error valid prefix"),
                        );
                    }
                    remaining = &remaining[valid_up_to..];
                    let Some(error_len) = error.error_len() else {
                        self.pending.extend_from_slice(remaining);
                        break;
                    };
                    output.push('\u{fffd}');
                    remaining = &remaining[error_len..];
                }
            }
        }
        output
    }

    fn finish(&mut self) -> String {
        String::from_utf8_lossy(&std::mem::take(&mut self.pending)).into_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_multibyte_text_is_lossless_for_every_boundary() {
        let value = "ASCII žltý 🦀 koniec";
        for split in 0..=value.len() {
            let mut decoder = IncrementalUtf8Decoder::default();
            let decoded = format!(
                "{}{}{}",
                decoder.push(&value.as_bytes()[..split]),
                decoder.push(&value.as_bytes()[split..]),
                decoder.finish(),
            );
            assert_eq!(decoded, value, "split at byte {split}");
        }
    }

    #[test]
    fn streams_are_independent_and_incomplete_eof_is_flushed_once() {
        let mut decoders = TaggedOutputDecoders::default();
        assert_eq!(
            decoders.push(NodePackageTaskOutputStream::Stdout, &[0xc5]),
            ""
        );
        assert_eq!(
            decoders.push(NodePackageTaskOutputStream::Stderr, b"err"),
            "err"
        );
        assert_eq!(
            decoders.push(NodePackageTaskOutputStream::Stdout, &[0xbe]),
            "ž"
        );
        assert_eq!(
            decoders.push(NodePackageTaskOutputStream::Stderr, &[0xf0]),
            ""
        );
        assert_eq!(decoders.finish(NodePackageTaskOutputStream::Stderr), "�");
        assert_eq!(decoders.finish(NodePackageTaskOutputStream::Stderr), "");
    }

    #[test]
    fn invalid_sequences_match_standard_lossy_decoding_without_buffer_growth() {
        let bytes = b"a\xffb\xf0\x9f\xA6\x80c";
        let mut decoder = IncrementalUtf8Decoder::default();
        let mut decoded = String::new();
        for byte in bytes {
            decoded.push_str(&decoder.push(std::slice::from_ref(byte)));
        }
        decoded.push_str(&decoder.finish());
        assert_eq!(decoded, String::from_utf8_lossy(bytes));
        assert!(decoder.pending.is_empty());
    }
}
