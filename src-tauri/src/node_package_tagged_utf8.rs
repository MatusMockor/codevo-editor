//! Incremental UTF-8 decoding for tagged task output.
//!
//! Raw terminal output deliberately bypasses this state. Each tagged stream retains only an
//! incomplete UTF-8 suffix between operating-system reads and flushes it exactly once at EOF.

use crate::incremental_utf8::IncrementalUtf8Decoder;
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
