pub struct ResultLineDetector {
    at_line_start: bool,
    matched: usize,
    fired: bool,
}

impl Default for ResultLineDetector {
    fn default() -> Self {
        Self::new()
    }
}

impl ResultLineDetector {
    pub const PREFIX: &'static [u8] = b"{\"type\":\"result\"";

    pub fn new() -> Self {
        Self {
            at_line_start: true,
            matched: 0,
            fired: false,
        }
    }

    pub fn feed(&mut self, chunk: &[u8]) -> bool {
        if self.fired {
            return false;
        }
        for byte in chunk {
            if !self.consume(*byte) {
                continue;
            }
            self.fired = true;
            return true;
        }
        false
    }

    fn consume(&mut self, byte: u8) -> bool {
        if self.matched == Self::PREFIX.len() {
            if byte == b',' || byte == b'}' {
                return true;
            }
            self.restart(byte);
            return false;
        }
        if !self.at_line_start {
            self.at_line_start = byte == b'\n';
            return false;
        }
        if byte == Self::PREFIX[self.matched] {
            self.matched += 1;
            return false;
        }
        self.restart(byte);
        false
    }

    fn restart(&mut self, byte: u8) {
        self.matched = 0;
        self.at_line_start = byte == b'\n';
    }
}

#[cfg(test)]
#[path = "agent_task_result_detector_tests.rs"]
mod tests;
