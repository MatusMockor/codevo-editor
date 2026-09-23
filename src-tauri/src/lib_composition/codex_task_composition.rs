use super::codex_app_server_host::{CodexAppServerHostRegistry, CodexHostKey, CodexHostLaunchPlan};
use super::codex_app_server_protocol::{
    ApprovalPolicy, SandboxMode, SandboxPolicy, ThreadResumeParams, ThreadStartParams,
    TurnStartParams, UserInput,
};
use super::codex_app_server_turn::CodexAppServerTurnPlan;
use super::{AgentTaskProjectAuthority, StartAgentTaskRequest};
use crate::agent_task_spawner::agent_artifact_instructions::VISUAL_OUTPUT_INSTRUCTIONS;
use crate::agent_task_spawner::agent_launch::{AgentLaunchOptions, CodexExecutionMode};
use crate::agent_task_spawner::agent_provider::runtime::{
    AgentProviderHostLifecycle, CodexTransport, ProviderTurnLease,
};
use crate::agent_task_spawner::{AgentCliInvocation, AgentPromptTransport, AgentTaskSpawnPlan};
use std::sync::Arc;

pub(crate) struct CodexProviderHostLifecycle(pub Arc<CodexAppServerHostRegistry>);

impl AgentProviderHostLifecycle for CodexProviderHostLifecycle {
    fn retire_idle_hosts(&self, provider: AgentCliInvocation) -> Result<(), String> {
        if provider == AgentCliInvocation::CodexExec {
            return self.0.retire_all_idle_for_update();
        }
        Ok(())
    }
}

pub(super) fn prepare_transport(
    plan: AgentTaskSpawnPlan,
    request: &StartAgentTaskRequest,
    authority: &AgentTaskProjectAuthority,
    provider: &ProviderTurnLease,
    hosts: &Arc<CodexAppServerHostRegistry>,
    validate_authority: Arc<dyn Fn() -> Result<(), String> + Send + Sync>,
) -> Result<AgentTaskSpawnPlan, String> {
    if request.agent_cli_kind != AgentCliInvocation::CodexExec
        || provider.transport() == CodexTransport::Exec
    {
        return Ok(plan);
    }
    let AgentLaunchOptions::Codex { mode, .. } = request.launch else {
        return Err("Codex launch settings are invalid.".into());
    };
    let identity = plan.executable_identity().clone();
    let host_plan = CodexHostLaunchPlan::new(
        identity.clone(),
        &authority.repository_root,
        &[],
        provider.app_server_args(),
    )?
    .with_cwd_authority(Arc::clone(&authority.repository_authority))
    .with_env(plan.env().to_vec());
    let key = CodexHostKey::new(
        authority.repository_root.clone(),
        provider.generation(),
        identity,
    );
    let cwd = authority
        .cwd
        .to_str()
        .ok_or("Codex working directory is not valid UTF-8.")?
        .to_string();
    let model = request
        .launch
        .model_args()
        .get(1)
        .map(|model| (*model).to_string());
    let access = access_for(mode, &cwd);
    let (thread_start, thread_resume) = thread_params(
        &cwd,
        model.as_deref(),
        &access,
        request.resume_session_id.as_deref(),
    );
    let AgentPromptTransport::Argv(prompt) = plan.prompt() else {
        return Err("Codex prompt transport is invalid.".into());
    };
    let input = codex_input(prompt, plan.attachment_paths())?;
    let turn_start = TurnStartParams {
        thread_id: String::new(),
        input,
        cwd: Some(cwd),
        model,
        approval_policy: access.approval_policy,
        sandbox_policy: access.sandbox_policy,
        effort: None,
        client_user_message_id: Some(request.task_id.clone()),
        turn_trigger: None,
    };
    let host = hosts.host_for(key, &host_plan)?;
    Ok(plan.with_codex_app_server(CodexAppServerTurnPlan {
        host,
        thread_start,
        thread_resume,
        turn_start,
        validate_authority,
    }))
}

fn thread_params(
    cwd: &str,
    model: Option<&str>,
    access: &CodexAccess,
    resume_session_id: Option<&str>,
) -> (ThreadStartParams, Option<ThreadResumeParams>) {
    let start = ThreadStartParams {
        cwd: Some(cwd.to_string()),
        model: model.map(str::to_string),
        sandbox: access.sandbox,
        approval_policy: access.approval_policy,
        developer_instructions: Some(VISUAL_OUTPUT_INSTRUCTIONS.to_string()),
    };
    let resume = resume_session_id.map(|id| ThreadResumeParams {
        thread_id: id.to_string(),
        cwd: start.cwd.clone(),
        model: start.model.clone(),
        sandbox: start.sandbox,
        approval_policy: start.approval_policy,
        developer_instructions: start.developer_instructions.clone(),
        exclude_turns: true,
    });
    (start, resume)
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CodexAccess {
    sandbox: Option<SandboxMode>,
    sandbox_policy: Option<SandboxPolicy>,
    approval_policy: Option<ApprovalPolicy>,
}

fn access_for(mode: CodexExecutionMode, cwd: &str) -> CodexAccess {
    let workspace_write = |approval: ApprovalPolicy| CodexAccess {
        sandbox: Some(SandboxMode::WorkspaceWrite),
        sandbox_policy: Some(SandboxPolicy::WorkspaceWrite {
            network_access: false,
            writable_roots: vec![cwd.to_string()],
        }),
        approval_policy: Some(approval),
    };
    match mode {
        CodexExecutionMode::Default => CodexAccess {
            sandbox: None,
            sandbox_policy: None,
            approval_policy: None,
        },
        CodexExecutionMode::ReadOnly => CodexAccess {
            sandbox: Some(SandboxMode::ReadOnly),
            sandbox_policy: Some(SandboxPolicy::ReadOnly {
                network_access: false,
            }),
            approval_policy: Some(ApprovalPolicy::Never),
        },
        CodexExecutionMode::WorkspaceWrite => workspace_write(ApprovalPolicy::Untrusted),
        CodexExecutionMode::Auto => workspace_write(ApprovalPolicy::OnRequest),
        CodexExecutionMode::DangerFullAccess => CodexAccess {
            sandbox: Some(SandboxMode::DangerFullAccess),
            sandbox_policy: Some(SandboxPolicy::DangerFullAccess),
            approval_policy: Some(ApprovalPolicy::Never),
        },
    }
}

pub(super) fn codex_input(
    prompt: &str,
    images: &[std::path::PathBuf],
) -> Result<Vec<UserInput>, String> {
    let mut input = vec![UserInput::Text {
        text: prompt.to_string(),
    }];
    for image in images {
        let path = image
            .to_str()
            .ok_or("Codex image path is not valid UTF-8.")?;
        input.push(UserInput::LocalImage {
            path: path.to_string(),
        });
    }
    Ok(input)
}

#[cfg(test)]
#[path = "codex_task_composition_tests.rs"]
mod tests;
