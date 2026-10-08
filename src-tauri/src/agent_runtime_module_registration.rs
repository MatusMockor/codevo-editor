// Agent runtime modules remain in the crate namespace.
pub mod agent_cli_discovery;
mod agent_command_catalog;
mod agent_command_catalog_domain;
mod agent_command_catalog_protocol;
mod agent_command_catalog_service;
mod agent_mcp_servers;
mod agent_mcp_servers_domain;
mod agent_mcp_servers_protocol;
pub mod agent_questions;
mod agent_subagent_lifecycle;
pub mod agent_task_admission;
pub mod agent_task_spawner;
pub mod agent_task_supervisor;
mod agent_trust_revocation;
mod claude_model_manifest;
mod claude_model_manifest_domain;
mod codex_model_catalog;
mod codex_model_catalog_domain;

mod agent_turn_changes;
mod agent_workspace_probe_authority;
#[path = "lib_composition/agent_turn_changes_commands.rs"]
mod agent_turn_changes_commands;
