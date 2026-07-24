use super::set_expression_target::StaticMemberSegment;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(in crate::debug_cdp) struct SetExpressionReference {
    pub(in crate::debug_cdp) frame_id: u64,
    pub(in crate::debug_cdp) pause_generation: u64,
    pub(in crate::debug_cdp) expression: String,
    pub(in crate::debug_cdp) target: SetExpressionTarget,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(in crate::debug_cdp) enum SetExpressionTarget {
    ScopeSlot {
        variables_reference: u64,
        name: String,
    },
    StaticProperty {
        root: StaticMemberRootAuthority,
        segments: Vec<StaticMemberSegment>,
        expected_object_ids: Vec<String>,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(in crate::debug_cdp) enum StaticMemberRootAuthority {
    Binding {
        root_scope_reference: u64,
        root_name: String,
    },
    This,
}
