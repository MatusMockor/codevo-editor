use std::path::PathBuf;
use std::sync::Arc;

#[derive(Clone, Debug)]
pub(crate) enum NodeLaunchProgram {
    Node,
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    ExactNode {
        canonical_path: PathBuf,
        executable: Arc<std::fs::File>,
    },
    #[cfg_attr(target_os = "linux", allow(dead_code))]
    TrustedLiveNode {
        canonical_path: PathBuf,
        fingerprint: NodeExecutableFingerprint,
    },
    WorkspaceTool(PathBuf),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct NodeExecutableFingerprint {
    pub(crate) device: u64,
    pub(crate) inode: u64,
    pub(crate) length: u64,
    pub(crate) modified_seconds: i64,
    pub(crate) modified_nanoseconds: i64,
    pub(crate) sha256: [u8; 32],
}

impl PartialEq for NodeLaunchProgram {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Node, Self::Node) => true,
            (
                Self::ExactNode {
                    canonical_path: left,
                    executable: left_executable,
                },
                Self::ExactNode {
                    canonical_path: right,
                    executable: right_executable,
                },
            ) => left == right && Arc::ptr_eq(left_executable, right_executable),
            (
                Self::TrustedLiveNode {
                    canonical_path: left_path,
                    fingerprint: left_fingerprint,
                },
                Self::TrustedLiveNode {
                    canonical_path: right_path,
                    fingerprint: right_fingerprint,
                },
            ) => left_path == right_path && left_fingerprint == right_fingerprint,
            (Self::WorkspaceTool(left), Self::WorkspaceTool(right)) => left == right,
            _ => false,
        }
    }
}

impl Eq for NodeLaunchProgram {}
