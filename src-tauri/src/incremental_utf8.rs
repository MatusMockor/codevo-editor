#[derive(Default)]
pub(crate) struct IncrementalUtf8Decoder {
    pending: Vec<u8>,
}

impl IncrementalUtf8Decoder {
    pub(crate) fn push(&mut self, bytes: &[u8]) -> String {
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

    pub(crate) fn finish(&mut self) -> String {
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

    #[test]
    fn pending_bytes_never_exceed_an_incomplete_scalar() {
        let mut decoder = IncrementalUtf8Decoder::default();
        assert_eq!(decoder.push(&[0xf0, 0x9f, 0xa6]), "");
        assert_eq!(decoder.pending.len(), 3);
        assert_eq!(decoder.push(&[0xf0]), "\u{fffd}");
        assert_eq!(decoder.pending.len(), 1);
        assert_eq!(decoder.push(&[0x9f, 0xa6, 0x80]), "🦀");
        assert!(decoder.pending.is_empty());
    }
}
