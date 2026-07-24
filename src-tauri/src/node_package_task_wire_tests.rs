use super::*;

#[test]
fn output_and_problem_events_have_exact_owner_sequence_wire() {
    let workspace_id: WorkspaceId = serde_json::from_value(serde_json::json!("ws-a")).unwrap();
    let owner = NodePackageTaskOwner {
        run_id: "wire-run".into(),
        workspace_id,
        session_id: 7,
        manifest_relative_path: "package.json".into(),
        script_name: "test".into(),
    };
    let output = NodePackageTaskOutputEvent {
        owner: owner.clone(),
        sequence: 2,
        stream: "stderr",
        data: "failure\n".into(),
        truncated: false,
    };
    assert_eq!(
        serde_json::to_value(output).unwrap(),
        serde_json::json!({
            "owner": {
                "runId":"wire-run", "workspaceId":"ws-a", "sessionId":7,
                "manifestRelativePath":"package.json", "scriptName":"test"
            },
            "sequence":2, "stream":"stderr", "data":"failure\n", "truncated":false
        })
    );
    let problems = NodePackageTaskProblemsEvent {
        owner,
        sequence: 3,
        state: NodePackageTaskProblemsState::Append {
            problems: vec![NodePackageTaskProblemWire {
                file_path: "/workspace/src/main.ts".into(),
                line_number: 4,
                column: 2,
                severity: "error",
                message: "bad type".into(),
                code: Some("TS2322".into()),
                source: "TypeScript",
            }],
            total: 1,
            truncated: false,
        },
    };
    assert_eq!(
        serde_json::to_value(problems).unwrap(),
        serde_json::json!({
            "kind":"append",
            "owner": {
                "runId":"wire-run", "workspaceId":"ws-a", "sessionId":7,
                "manifestRelativePath":"package.json", "scriptName":"test"
            },
            "sequence":3,
            "problems":[{
                "filePath":"/workspace/src/main.ts", "lineNumber":4, "column":2,
                "severity":"error", "message":"bad type", "code":"TS2322",
                "source":"TypeScript"
            }],
            "total":1, "truncated":false
        })
    );
}
