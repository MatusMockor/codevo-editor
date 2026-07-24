use std::io::Read;

pub(crate) const CAPTURED_STREAM_BYTES_LIMIT: usize = 64 * 1024;

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub(crate) struct BoundedCapturedStream {
    pub(crate) raw_tail: Vec<u8>,
    pub(crate) text: String,
    pub(crate) truncated: bool,
    pub(crate) read_error: Option<String>,
}

pub(crate) fn read_bounded_captured_stream(
    mut reader: impl Read,
    limit: usize,
) -> BoundedCapturedStream {
    let mut tail = Vec::with_capacity(limit);
    let mut chunk = [0_u8; 8 * 1024];
    let mut truncated = false;
    let mut read_error = None;
    loop {
        match reader.read(&mut chunk) {
            Ok(0) => break,
            Ok(count) => {
                tail.extend_from_slice(&chunk[..count]);
                if tail.len() > limit {
                    truncated = true;
                    tail.drain(..tail.len() - limit);
                }
            }
            Err(error) => {
                read_error = Some(error.to_string());
                break;
            }
        }
    }

    let lossy = String::from_utf8_lossy(&tail);
    let (text, recapped) = utf8_suffix(&lossy, limit);
    BoundedCapturedStream {
        raw_tail: tail,
        text,
        truncated: truncated || recapped || read_error.is_some(),
        read_error,
    }
}

fn utf8_suffix(value: &str, limit: usize) -> (String, bool) {
    if value.len() <= limit {
        return (value.to_string(), false);
    }
    let mut start = value.len() - limit;
    while !value.is_char_boundary(start) {
        start += 1;
    }
    (value[start..].to_string(), true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{self, Cursor};

    #[test]
    fn retains_exact_boundary_without_truncation_and_tail_after_overflow() {
        let exact = read_bounded_captured_stream(Cursor::new(vec![b'a'; 8]), 8);
        assert_eq!(exact.text, "aaaaaaaa");
        assert_eq!(exact.raw_tail, b"aaaaaaaa");
        assert!(!exact.truncated);
        assert_eq!(exact.read_error, None);

        let overflow = read_bounded_captured_stream(Cursor::new(b"0123456789"), 8);
        assert_eq!(overflow.text, "23456789");
        assert_eq!(overflow.raw_tail, b"23456789");
        assert!(overflow.truncated);
        assert_eq!(overflow.read_error, None);
    }

    #[test]
    fn production_cap_is_closed_at_exactly_sixty_four_kibibytes() {
        let exact = read_bounded_captured_stream(
            Cursor::new(vec![b'x'; CAPTURED_STREAM_BYTES_LIMIT]),
            CAPTURED_STREAM_BYTES_LIMIT,
        );
        assert_eq!(exact.raw_tail.len(), CAPTURED_STREAM_BYTES_LIMIT);
        assert_eq!(exact.text.len(), CAPTURED_STREAM_BYTES_LIMIT);
        assert!(!exact.truncated);

        let overflow = read_bounded_captured_stream(
            Cursor::new(vec![b'y'; CAPTURED_STREAM_BYTES_LIMIT + 1]),
            CAPTURED_STREAM_BYTES_LIMIT,
        );
        assert_eq!(overflow.raw_tail.len(), CAPTURED_STREAM_BYTES_LIMIT);
        assert_eq!(overflow.text.len(), CAPTURED_STREAM_BYTES_LIMIT);
        assert!(overflow.truncated);
    }

    #[test]
    fn lossy_utf8_is_recapped_to_a_valid_bounded_suffix() {
        let captured = read_bounded_captured_stream(Cursor::new([0xff; 8]), 8);
        assert_eq!(captured.text, "��");
        assert_eq!(captured.text.len(), 6);
        assert!(captured.truncated);
        assert_eq!(captured.read_error, None);
    }

    #[test]
    fn split_and_incomplete_unicode_are_decoded_from_the_raw_tail() {
        let value = "prefix-žltý-🦀";
        for split in 0..=value.len() {
            let reader = SplitReader::new(value.as_bytes(), split);
            let captured = read_bounded_captured_stream(reader, CAPTURED_STREAM_BYTES_LIMIT);
            assert_eq!(captured.text, value, "split at byte {split}");
            assert!(!captured.truncated);
            assert_eq!(captured.read_error, None);
        }

        let incomplete = read_bounded_captured_stream(Cursor::new([b'a', 0xf0, 0x9f, 0xa6]), 16);
        assert_eq!(incomplete.text, "a�");
        assert!(!incomplete.truncated);
    }

    #[test]
    fn unicode_tail_never_splits_a_scalar() {
        let captured = read_bounded_captured_stream(Cursor::new("až🦀".as_bytes()), 5);
        assert_eq!(captured.text, "🦀");
        assert!(captured.truncated);
        assert!(captured.text.len() <= 5);
    }

    #[test]
    fn preserves_partial_tail_and_records_read_error() {
        let captured = read_bounded_captured_stream(
            ErrorReader {
                delivered: false,
                bytes: b"partial",
            },
            CAPTURED_STREAM_BYTES_LIMIT,
        );
        assert_eq!(captured.text, "partial");
        assert!(captured.truncated);
        assert_eq!(
            captured.read_error.as_deref(),
            Some("synthetic read failure")
        );
    }

    struct SplitReader<'a> {
        bytes: &'a [u8],
        position: usize,
        split: usize,
    }

    impl<'a> SplitReader<'a> {
        fn new(bytes: &'a [u8], split: usize) -> Self {
            Self {
                bytes,
                position: 0,
                split,
            }
        }
    }

    impl Read for SplitReader<'_> {
        fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
            if self.position == self.bytes.len() {
                return Ok(0);
            }
            let boundary = if self.position < self.split {
                self.split
            } else {
                self.bytes.len()
            };
            let count = (boundary - self.position).min(buffer.len());
            buffer[..count].copy_from_slice(&self.bytes[self.position..self.position + count]);
            self.position += count;
            Ok(count)
        }
    }

    struct ErrorReader<'a> {
        bytes: &'a [u8],
        delivered: bool,
    }

    impl Read for ErrorReader<'_> {
        fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
            if self.delivered {
                return Err(io::Error::other("synthetic read failure"));
            }
            self.delivered = true;
            buffer[..self.bytes.len()].copy_from_slice(self.bytes);
            Ok(self.bytes.len())
        }
    }
}
