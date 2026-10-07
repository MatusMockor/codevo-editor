use super::*;
fn question_session() -> Arc<agent_questions::AgentQuestionSession> {
    let session = Arc::new(agent_questions::AgentQuestionSession::new());
    let request=serde_json::from_value(serde_json::json!({"id":"question-1","taskId":"","provider":"claudeCode","questions":[{"id":"q","header":"","prompt":"Choose","options":[],"multiple":false,"allowCustom":true}],"status":"pending"})).unwrap();
    session.register(request, Arc::new(|_| Ok(()))).unwrap();
    session
}
#[test]
fn question_owner_is_exact_and_stop_expires_pending_before_process_reaping() {
    let fixture = fixture(Duration::from_secs(10));
    let root = Path::new("/repo-questions");
    let process = FakeProcess::new(None, Some(0));
    let questions = question_session();
    let mut child = FakeChildSpec::new(&process, 9981).build();
    child.questions = Some(questions.clone());
    fixture.signals.track(9981, &process);
    fixture.spawner.script(FakeSpawnOutcome::Child(child));
    dispatch(
        &fixture,
        "question-task",
        root,
        &root.join(".worktrees/question-task"),
    )
    .unwrap();
    assert_eq!(
        fixture
            .registry
            .list_questions("question-task", "ws-agent-tests", root)
            .unwrap()
            .len(),
        1
    );
    assert!(fixture
        .registry
        .list_questions("question-task", "foreign", root)
        .is_err());
    assert!(fixture
        .registry
        .list_questions("question-task", "ws-agent-tests", Path::new("/foreign"))
        .is_err());
    fixture
        .registry
        .stop_for_workspace("question-task", "ws-agent-tests")
        .unwrap();
    assert_eq!(
        questions.list("question-task")[0].status,
        agent_questions::AgentQuestionStatus::Expired
    );
    let response = agent_questions::AgentQuestionResponse {
        answers: vec![agent_questions::AgentQuestionAnswerItem {
            question_id: "q".into(),
            option_ids: vec![],
            text: "answer".into(),
        }],
    };
    assert!(fixture
        .registry
        .answer_question(
            "question-task",
            "ws-agent-tests",
            root,
            "question-1",
            response
        )
        .is_err());
}
fn question_response() -> agent_questions::AgentQuestionResponse {
    agent_questions::AgentQuestionResponse {
        answers: vec![agent_questions::AgentQuestionAnswerItem {
            question_id: "q".into(),
            option_ids: vec![],
            text: "answer".into(),
        }],
    }
}
fn assert_no_pending_requests(fixture: &Fixture, task_id: &str, root: &Path) {
    assert_eq!(
        fixture
            .registry
            .list_questions(task_id, "ws-agent-tests", root)
            .map(|requests| requests.len()),
        Ok(0)
    );
    assert_eq!(
        fixture
            .registry
            .list_approvals(task_id, "ws-agent-tests", root)
            .map(|requests| requests.len()),
        Ok(0)
    );
}
fn assert_answers_are_rejected(fixture: &Fixture, task_id: &str, root: &Path) {
    assert!(fixture
        .registry
        .answer_question(
            task_id,
            "ws-agent-tests",
            root,
            "question-1",
            question_response()
        )
        .is_err());
    assert!(fixture
        .registry
        .answer_approval(
            task_id,
            "ws-agent-tests",
            root,
            "approval-1",
            agent_questions::approvals::AgentApprovalDecision::AllowOnce
        )
        .is_err());
}
#[test]
fn listing_a_task_that_is_not_registered_yet_reports_no_pending_requests() {
    let fixture = fixture(Duration::from_secs(10));
    let root = Path::new("/repo-questions");
    assert_no_pending_requests(&fixture, "not-started-task", root);
    assert_answers_are_rejected(&fixture, "not-started-task", root);
}
#[test]
fn listing_a_finished_and_evicted_task_reports_no_pending_requests() {
    let fixture = fixture(Duration::from_secs(10));
    let root = Path::new("/repo-questions");
    let process = FakeProcess::new(Some(0), None);
    let mut child = FakeChildSpec::new(&process, 9982).build();
    child.questions = Some(question_session());
    fixture.signals.track(9982, &process);
    fixture.spawner.script(FakeSpawnOutcome::Child(child));
    dispatch(
        &fixture,
        "finished-task",
        root,
        &root.join(".worktrees/finished-task"),
    )
    .unwrap();
    assert!(wait_until(EVENT_DEADLINE, || {
        fixture.registry.live_worker_thread_count() == 0
    }));
    fixture.registry.acknowledge("finished-task").unwrap();
    assert!(fixture.registry.acknowledge("finished-task").is_err());
    assert_no_pending_requests(&fixture, "finished-task", root);
    assert_answers_are_rejected(&fixture, "finished-task", root);
}
#[test]
fn listing_a_registered_task_from_a_foreign_workspace_stays_an_error() {
    let fixture = fixture(Duration::from_secs(10));
    let root = Path::new("/repo-questions");
    let process = FakeProcess::new(None, Some(0));
    let mut child = FakeChildSpec::new(&process, 9983).build();
    child.questions = Some(question_session());
    fixture.signals.track(9983, &process);
    fixture.spawner.script(FakeSpawnOutcome::Child(child));
    dispatch(
        &fixture,
        "owned-task",
        root,
        &root.join(".worktrees/owned-task"),
    )
    .unwrap();
    assert!(fixture
        .registry
        .list_questions("owned-task", "foreign", root)
        .is_err());
    assert!(fixture
        .registry
        .list_approvals("owned-task", "foreign", root)
        .is_err());
    assert!(fixture
        .registry
        .list_approvals("owned-task", "ws-agent-tests", Path::new("/foreign"))
        .is_err());
    fixture
        .registry
        .stop_for_workspace("owned-task", "ws-agent-tests")
        .unwrap();
}
