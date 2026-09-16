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
