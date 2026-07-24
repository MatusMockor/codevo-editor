# Codevo portable-pty patch

This directory vendors `portable-pty` 0.9.0 under its upstream MIT license.
The Codevo patch is intentionally limited to descriptor-bound Unix working
directories:

- `CommandBuilder::cwd_fd` owns an already-open directory;
- Unix spawn calls `fchdir` before `close_random_fds`;
- pathname-based `current_dir` and executable lookup are skipped while the
  descriptor is authoritative.

Windows code paths are unchanged. The application-level adversarial test in
`terminal_session_ownership_tests.rs` renames the retained directory, replaces
its old pathname, and proves that the child still reads from the retained
directory object.
