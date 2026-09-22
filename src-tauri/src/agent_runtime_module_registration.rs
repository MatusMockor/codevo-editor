// Agent runtime modules remain in the crate namespace.
pub mod agent_cli_discovery;
pub mod agent_questions;
mod claude_model_manifest;
mod claude_model_manifest_domain;
mod agent_subagent_lifecycle;
pub mod agent_task_admission;
pub mod agent_task_spawner;
pub mod agent_task_supervisor;

mod agent_turn_changes;
#[path = "lib_composition/agent_turn_changes_commands.rs"]
mod agent_turn_changes_commands;
