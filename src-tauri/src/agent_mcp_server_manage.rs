use crate::agent_mcp_server_login_protocol::{
    McpLoginEvents, McpLoginProviderStep, McpLoginRequest, McpLoginTiming,
};
use crate::agent_mcp_server_login_registry::{
    AgentMcpLoginRegistry, McpLoginOwner, McpLoginSession,
};
use crate::agent_mcp_server_manage_domain::{
    validate_change_request, validate_login_request, validate_login_start_request,
    AgentMcpServerAck, AgentMcpServerChange, AgentMcpServerChangeRequest,
    AgentMcpServerLoginDelivery, AgentMcpServerLoginRequest, AgentMcpServerLoginStartRequest,
    AgentMcpServerLoginStarted, AgentMcpServerLoginStatus, AgentMcpServerLoginStep,
};
use crate::agent_mcp_servers::{
    ensure_provider_generation, lease_failure, provider_generation, WorkspaceMcpServersAuthority,
};
use crate::agent_mcp_servers_domain::AGENT_MCP_SERVERS_BUSY_ERROR;
use crate::agent_task_spawner::agent_provider::process::mcp_manage_plan::AGENT_PROVIDER_MCP_CHANGE_TIMEOUT;
use crate::agent_task_spawner::agent_provider::runtime::AgentProviderRuntimeRegistry;
use crate::agent_task_spawner::AgentCliInvocation;
use crate::run_blocking_command;
use crate::trust::WorkspaceTrustService;
use crate::workspace_registry::WorkspaceRegistry;
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::Manager;

static MCP_CHANGE_ACTIVE: AtomicBool = AtomicBool::new(false);

struct McpChangePermit {
    active: &'static AtomicBool,
}

impl McpChangePermit {
    fn acquire(active: &'static AtomicBool) -> Result<Self, String> {
        active
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map(|_| Self { active })
            .map_err(|_| AGENT_MCP_SERVERS_BUSY_ERROR.to_string())
    }
}

impl Drop for McpChangePermit {
    fn drop(&mut self) {
        self.active.store(false, Ordering::Release);
    }
}

fn confirm_publication(
    providers: &AgentProviderRuntimeRegistry,
    registry: &WorkspaceRegistry,
    trust: &Mutex<WorkspaceTrustService>,
    authority: &WorkspaceMcpServersAuthority,
    provider: AgentCliInvocation,
    generation: u64,
) -> Result<(), String> {
    authority.revalidate_registration(registry, trust)?;
    ensure_provider_generation(providers, provider, generation)
}

fn apply_change(
    providers: &AgentProviderRuntimeRegistry,
    registry: &WorkspaceRegistry,
    trust: &Mutex<WorkspaceTrustService>,
    authority: &WorkspaceMcpServersAuthority,
    provider: AgentCliInvocation,
    change: &AgentMcpServerChange,
    timeout: Duration,
) -> Result<u64, String> {
    let generation = provider_generation(providers, provider)?;
    let lease = providers
        .acquire_catalog_probe(provider, generation)
        .map_err(|_| lease_failure(providers, provider))?;
    let trust_lease = authority.reserve_trust(trust)?;
    authority.revalidate(registry, trust)?;
    let changed = providers
        .change_mcp_server(
            &lease,
            &authority.repository_root,
            Arc::clone(&authority.repository_authority),
            change,
            timeout,
        )
        .map_err(|failure| failure.message().to_string());
    authority.revalidate(registry, trust)?;
    drop(trust_lease);
    ensure_provider_generation(providers, provider, generation)?;
    changed.map(|()| generation)
}

type WorkspaceAuthorityCheck =
    Arc<dyn Fn(&WorkspaceMcpServersAuthority) -> Result<(), String> + Send + Sync>;

struct LoginAuthorityWatch {
    owner: McpLoginOwner,
    interval: Duration,
    checked_at: Mutex<Instant>,
    lost: AtomicBool,
}

impl LoginAuthorityWatch {
    fn new(owner: McpLoginOwner, interval: Duration) -> Self {
        Self {
            owner,
            interval,
            checked_at: Mutex::new(Instant::now()),
            lost: AtomicBool::new(false),
        }
    }

    fn is_due(&self) -> bool {
        let Ok(mut checked_at) = self.checked_at.lock() else {
            return true;
        };
        if checked_at.elapsed() < self.interval {
            return false;
        }
        *checked_at = Instant::now();
        true
    }

    fn is_lost(&self) -> bool {
        if self.lost.load(Ordering::Acquire) {
            return true;
        }
        if !self.is_due() || (self.owner)().is_ok() {
            return false;
        }
        self.lost.store(true, Ordering::Release);
        true
    }
}

struct LoginStart<'a> {
    providers: &'a Arc<AgentProviderRuntimeRegistry>,
    registry: &'a WorkspaceRegistry,
    trust: &'a Mutex<WorkspaceTrustService>,
    logins: &'a AgentMcpLoginRegistry,
    workspace_is_current: WorkspaceAuthorityCheck,
}

struct StartedLogin {
    authority: Arc<WorkspaceMcpServersAuthority>,
    provider: AgentCliInvocation,
    generation: u64,
    session: Arc<McpLoginSession>,
    step: AgentMcpServerLoginStep,
}

impl StartedLogin {
    fn confirm(
        &self,
        providers: &AgentProviderRuntimeRegistry,
        registry: &WorkspaceRegistry,
        trust: &Mutex<WorkspaceTrustService>,
    ) -> Result<(), String> {
        confirm_publication(
            providers,
            registry,
            trust,
            &self.authority,
            self.provider,
            self.generation,
        )
    }

    fn reap(&self, logins: &AgentMcpLoginRegistry) {
        logins.discard(&self.session);
    }
}

fn published_step(
    session: &McpLoginSession,
    step: McpLoginProviderStep,
) -> AgentMcpServerLoginStep {
    match step {
        McpLoginProviderStep::Completed => AgentMcpServerLoginStep::Completed,
        McpLoginProviderStep::FinishInBrowser(authorization_url) => {
            AgentMcpServerLoginStep::FinishInBrowser { authorization_url }
        }
        McpLoginProviderStep::AwaitingCallback(authorization_url) => {
            AgentMcpServerLoginStep::AwaitingCallback {
                login_id: session.login_id().to_string(),
                authorization_url,
                delivery: AgentMcpServerLoginDelivery::Automatic,
            }
        }
    }
}

fn login_owner(
    context: &LoginStart<'_>,
    authority: &Arc<WorkspaceMcpServersAuthority>,
    provider: AgentCliInvocation,
    generation: u64,
) -> McpLoginOwner {
    let authority = Arc::clone(authority);
    let providers = Arc::clone(context.providers);
    let workspace_is_current = Arc::clone(&context.workspace_is_current);
    Arc::new(move || {
        workspace_is_current(&authority)?;
        ensure_provider_generation(&providers, provider, generation)
    })
}

fn start_login(
    context: &LoginStart<'_>,
    authority: WorkspaceMcpServersAuthority,
    provider: AgentCliInvocation,
    login: McpLoginRequest,
) -> Result<StartedLogin, String> {
    let authority = Arc::new(authority);
    let generation = provider_generation(context.providers, provider)?;
    let lease = context
        .providers
        .acquire_catalog_probe(provider, generation)
        .map_err(|_| lease_failure(context.providers, provider))?;
    let trust_lease = authority.reserve_trust(context.trust)?;
    authority.revalidate(context.registry, context.trust)?;
    let step_timeout = login.timing.step_timeout;
    let owner = login_owner(context, &authority, provider, generation);
    let watch = LoginAuthorityWatch::new(Arc::clone(&owner), login.timing.authority_check_interval);
    let providers = Arc::clone(context.providers);
    let session_authority = Arc::clone(&authority);
    let session = context
        .logins
        .begin(owner, move |session: Arc<McpLoginSession>| {
            let events: Arc<dyn McpLoginEvents> = Arc::clone(&session) as _;
            let succeeded = providers.run_mcp_login(
                &lease,
                &session_authority.repository_root,
                Arc::clone(&session_authority.repository_authority),
                &login,
                events,
                || session.is_cancelled() || watch.is_lost(),
            );
            succeeded && !session.is_cancelled() && session.owner_is_current().is_ok()
        })
        .map_err(|failure| failure.message().to_string())?;
    let step = session.wait_step(step_timeout);
    let authorized = authority
        .revalidate(context.registry, context.trust)
        .and_then(|()| ensure_provider_generation(context.providers, provider, generation));
    drop(trust_lease);
    let step = authorized.and_then(|()| step.map_err(|failure| failure.message().to_string()));
    if !matches!(step, Ok(McpLoginProviderStep::AwaitingCallback(_))) {
        context.logins.discard(&session);
    }
    let step = published_step(&session, step?);
    Ok(StartedLogin {
        authority,
        provider,
        generation,
        session,
        step,
    })
}

#[tauri::command]
pub async fn change_agent_mcp_server(
    app: tauri::AppHandle,
    request: AgentMcpServerChangeRequest,
) -> Result<AgentMcpServerAck, String> {
    validate_change_request(&request)?;
    let provider = request.provider;
    let providers = Arc::clone(app.state::<Arc<AgentProviderRuntimeRegistry>>().inner());
    let permit = McpChangePermit::acquire(&MCP_CHANGE_ACTIVE)?;
    let change_app = app.clone();
    let change_providers = Arc::clone(&providers);
    let (authority, generation) = run_blocking_command(move || {
        let _permit = permit;
        let registry = change_app.state::<WorkspaceRegistry>();
        let trust = change_app.state::<Mutex<WorkspaceTrustService>>();
        let authority = WorkspaceMcpServersAuthority::capture(
            registry.inner(),
            trust.inner(),
            &request.repository_root,
        )?;
        let generation = apply_change(
            &change_providers,
            registry.inner(),
            trust.inner(),
            &authority,
            provider,
            &request.change,
            AGENT_PROVIDER_MCP_CHANGE_TIMEOUT,
        )?;
        Ok((authority, generation))
    })
    .await?;
    confirm_publication(
        &providers,
        app.state::<WorkspaceRegistry>().inner(),
        app.state::<Mutex<WorkspaceTrustService>>().inner(),
        &authority,
        provider,
        generation,
    )?;
    Ok(AgentMcpServerAck::acknowledged())
}

#[tauri::command]
pub async fn start_agent_mcp_server_login(
    app: tauri::AppHandle,
    request: AgentMcpServerLoginStartRequest,
) -> Result<AgentMcpServerLoginStarted, String> {
    validate_login_start_request(&request)?;
    let providers = Arc::clone(app.state::<Arc<AgentProviderRuntimeRegistry>>().inner());
    let logins = Arc::clone(app.state::<Arc<AgentMcpLoginRegistry>>().inner());
    let start_app = app.clone();
    let start_providers = Arc::clone(&providers);
    let start_logins = Arc::clone(&logins);
    let started = run_blocking_command(move || {
        let registry = start_app.state::<WorkspaceRegistry>();
        let trust = start_app.state::<Mutex<WorkspaceTrustService>>();
        let authority = WorkspaceMcpServersAuthority::capture(
            registry.inner(),
            trust.inner(),
            &request.repository_root,
        )?;
        let watch_app = start_app.clone();
        let context = LoginStart {
            providers: &start_providers,
            registry: registry.inner(),
            trust: trust.inner(),
            logins: &start_logins,
            workspace_is_current: Arc::new(move |authority: &WorkspaceMcpServersAuthority| {
                authority.revalidate_registration(
                    watch_app.state::<WorkspaceRegistry>().inner(),
                    watch_app.state::<Mutex<WorkspaceTrustService>>().inner(),
                )
            }),
        };
        let login = McpLoginRequest {
            name: request.name,
            mode: request.mode,
            timing: McpLoginTiming::PRODUCTION,
        };
        start_login(&context, authority, request.provider, login)
    })
    .await?;
    let confirmed = started.confirm(
        &providers,
        app.state::<WorkspaceRegistry>().inner(),
        app.state::<Mutex<WorkspaceTrustService>>().inner(),
    );
    let Err(error) = confirmed else {
        return Ok(AgentMcpServerLoginStarted::new(started.step));
    };
    let _ = run_blocking_command(move || {
        started.reap(&logins);
        Ok(())
    })
    .await;
    Err(error)
}

#[tauri::command]
pub async fn get_agent_mcp_server_login(
    app: tauri::AppHandle,
    request: AgentMcpServerLoginRequest,
) -> Result<AgentMcpServerLoginStatus, String> {
    validate_login_request(&request)?;
    let logins = Arc::clone(app.state::<Arc<AgentMcpLoginRegistry>>().inner());
    run_blocking_command(move || {
        logins
            .state(&request.login_id)
            .map(AgentMcpServerLoginStatus::new)
    })
    .await
}

#[tauri::command]
pub async fn cancel_agent_mcp_server_login(
    app: tauri::AppHandle,
    request: AgentMcpServerLoginRequest,
) -> Result<AgentMcpServerAck, String> {
    validate_login_request(&request)?;
    let logins = Arc::clone(app.state::<Arc<AgentMcpLoginRegistry>>().inner());
    run_blocking_command(move || {
        logins.cancel(&request.login_id);
        Ok(AgentMcpServerAck::acknowledged())
    })
    .await
}

#[cfg(all(test, unix))]
#[path = "agent_mcp_server_manage_tests.rs"]
mod tests;
