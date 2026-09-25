use super::{repository_head, resolve_worktree_start_point};
use serde::Deserialize;
use std::path::Path;

pub(crate) const MAX_AGENT_BRANCH_REF_BYTES: usize = 256;
const LOCAL_BRANCH_PREFIX: &str = "refs/heads/";
const REMOTE_BRANCH_PREFIX: &str = "refs/remotes/";
const FORBIDDEN_REF_CHARACTERS: [char; 7] = ['~', '^', ':', '?', '*', '[', '\\'];
pub(crate) const INVALID_START_POINT_ERROR: &str =
    "Agent worktrees can start only from a local or remote branch.";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AgentBranchRef(String);

impl AgentBranchRef {
    pub fn parse(candidate: &str) -> Result<Self, String> {
        if candidate.len() > MAX_AGENT_BRANCH_REF_BYTES {
            return Err(INVALID_START_POINT_ERROR.to_string());
        }
        let name = candidate
            .strip_prefix(LOCAL_BRANCH_PREFIX)
            .or_else(|| candidate.strip_prefix(REMOTE_BRANCH_PREFIX))
            .ok_or_else(|| INVALID_START_POINT_ERROR.to_string())?;
        if !valid_ref_name(name) {
            return Err(INVALID_START_POINT_ERROR.to_string());
        }
        Ok(Self(candidate.to_string()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum WorktreeStartPoint {
    Head,
    Ref(AgentBranchRef),
}

#[derive(Debug, Deserialize)]
#[serde(try_from = "RawStartPointWire")]
pub(crate) enum WorktreeStartPointWire {
    Head,
    Ref(String),
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
enum StartPointKind {
    Head,
    Ref,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawStartPointWire {
    kind: StartPointKind,
    #[serde(rename = "ref")]
    reference: Option<String>,
}

impl TryFrom<RawStartPointWire> for WorktreeStartPointWire {
    type Error = String;

    fn try_from(raw: RawStartPointWire) -> Result<Self, Self::Error> {
        match (raw.kind, raw.reference) {
            (StartPointKind::Head, None) => Ok(WorktreeStartPointWire::Head),
            (StartPointKind::Ref, Some(reference)) => Ok(WorktreeStartPointWire::Ref(reference)),
            _ => Err("Invalid worktree start point.".to_string()),
        }
    }
}

impl TryFrom<WorktreeStartPointWire> for WorktreeStartPoint {
    type Error = String;

    fn try_from(wire: WorktreeStartPointWire) -> Result<Self, Self::Error> {
        match wire {
            WorktreeStartPointWire::Head => Ok(WorktreeStartPoint::Head),
            WorktreeStartPointWire::Ref(reference) => {
                AgentBranchRef::parse(&reference).map(WorktreeStartPoint::Ref)
            }
        }
    }
}

pub(crate) fn starting_commit(root: &Path, start: &WorktreeStartPoint) -> Result<String, String> {
    match start {
        WorktreeStartPoint::Head => repository_head(root),
        WorktreeStartPoint::Ref(reference) => {
            resolve_worktree_start_point(root, reference.as_str())
        }
    }
}

fn valid_ref_name(name: &str) -> bool {
    if name.is_empty() || name == "@" || name.contains("..") || name.contains("@{") {
        return false;
    }
    if !name.chars().all(allowed_ref_character) {
        return false;
    }
    name.split('/').all(valid_ref_segment)
}

fn valid_ref_segment(segment: &str) -> bool {
    !(segment.is_empty()
        || segment == "HEAD"
        || segment.starts_with('.')
        || segment.starts_with('-')
        || segment.ends_with('.')
        || segment.ends_with(".lock"))
}

fn allowed_ref_character(character: char) -> bool {
    !(character.is_control()
        || character.is_whitespace()
        || FORBIDDEN_REF_CHARACTERS.contains(&character))
}

#[cfg(test)]
#[path = "git_worktree_start_point_tests.rs"]
mod tests;
