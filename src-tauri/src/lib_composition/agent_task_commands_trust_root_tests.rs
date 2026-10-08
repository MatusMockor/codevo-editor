use super::*;

const TRUST_RECORD_ROOT: &str = "/trust-record/of-the-project";

fn nested_repository_authority(
    workspace: &TempWorkspace,
) -> (StartAgentTaskRequest, AgentTaskProjectAuthority) {
    let repository = workspace.root.join("packages/app");
    fs::create_dir_all(&repository).expect("create nested repository");
    let mut request = start_request(workspace, &repository, AgentTaskIsolation::InPlace);
    request.repository_root = repository.to_string_lossy().into_owned();
    let mut authority = test_authority(&request);
    authority.project_trust.root_path = TRUST_RECORD_ROOT.to_string();
    (request, authority)
}

fn cli_identity(workspace: &TempWorkspace) -> ExecutableIdentity {
    let cli = workspace.executable_cli();
    crate::agent_task_spawner::agent_provider::process::executable_identity(
        cli.to_str().expect("UTF-8 agent path"),
    )
    .expect("agent executable identity")
}

#[test]
fn a_task_is_registered_under_the_trust_record_that_admitted_it() {
    let workspace = TempWorkspace::create("task-trust-root");
    let (request, authority) = nested_repository_authority(&workspace);
    let effective_path =
        EffectiveExecutablePath::new(&request.project_root).expect("effective path");

    let prepared = prepare_agent_task_start(
        &request,
        authority,
        cli_identity(&workspace),
        effective_path,
        &test_attachment_store(&workspace),
        None,
    )
    .expect("prepare nested task");

    assert_eq!(prepared.request.trust_root, Path::new(TRUST_RECORD_ROOT));
    assert_eq!(
        prepared.request.repository_root,
        workspace.root.join("packages/app")
    );
}

#[test]
fn a_codex_host_records_the_trust_record_that_admitted_its_turn() {
    let workspace = TempWorkspace::create("host-trust-root");
    let (_, authority) = nested_repository_authority(&workspace);

    let plan = codex_task_composition::host_launch_plan(cli_identity(&workspace), &authority, &[])
        .expect("host launch plan");

    assert_eq!(plan.trust_root(), Path::new(TRUST_RECORD_ROOT));
    assert_eq!(plan.repository_root(), workspace.root.join("packages/app"));
}
