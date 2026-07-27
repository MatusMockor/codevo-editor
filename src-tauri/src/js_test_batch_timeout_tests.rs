fn assert_process_reaped(pid: i32) {
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        if unsafe { libc::kill(pid, 0) } == -1
            && std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH)
        {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "process {pid} remained alive after its batch process group was reaped"
        );
        thread::sleep(Duration::from_millis(10));
    }
}

struct TriggeredBatchTimeout(AtomicBool);

impl BatchTimeoutPolicy for TriggeredBatchTimeout {
    fn expired(&self, _started_at: Instant) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

#[test]
fn timeout_reaps_two_complete_process_groups_clears_registry_and_publishes_no_partial_results() {
    let root = temp_root("timeout-reap");
    let markers = root.join("markers");
    fs::create_dir_all(&markers).expect("create markers");
    for package in ["a", "b"] {
        let parent_pid = markers.join(format!("{package}-parent-pid"));
        let child_pid = markers.join(format!("{package}-child-pid"));
        let ready = markers.join(format!("{package}-ready"));
        install_package(
            &root,
            &format!("packages/{package}"),
            JsTestBatchRunner::Vitest,
            &format!(
                "printf '%s' $$ > '{}.tmp'\nmv '{}.tmp' '{}'\nsleep 30 &\nchild=$!\nprintf '%s' \"$child\" > '{}.tmp'\nmv '{}.tmp' '{}'\ntouch '{}'\nwait \"$child\"",
                parent_pid.display(),
                parent_pid.display(),
                parent_pid.display(),
                child_pid.display(),
                child_pid.display(),
                child_pid.display(),
                ready.display()
            ),
        );
    }
    let prepared = prepare_registered_js_test_batch(
        registered(&root),
        &app_data(&root),
        vec!["packages/a".into(), "packages/b".into()],
    )
    .expect("prepare");
    let workspace_id: WorkspaceId =
        serde_json::from_value(serde_json::json!("timeout-workspace")).unwrap();
    let registry = JsTestBatchRegistry::new();
    let reservation = registry
        .reserve("timeout-run", &workspace_id)
        .expect("reserve");
    let timeout = Arc::new(TriggeredBatchTimeout(AtomicBool::new(false)));
    let worker_timeout: Arc<dyn BatchTimeoutPolicy> = timeout.clone();
    let worker = thread::spawn(move || {
        let outcome = execute_prepared_js_test_batch_with_timeout_policy(
            prepared,
            reservation.cancellation(),
            worker_timeout,
        );
        drop(reservation);
        outcome
    });
    let readiness_deadline = Instant::now() + Duration::from_secs(2);
    while ["a", "b"]
        .iter()
        .any(|package| !markers.join(format!("{package}-ready")).exists())
        && Instant::now() < readiness_deadline
    {
        thread::sleep(Duration::from_millis(10));
    }
    let both_ready = ["a", "b"]
        .iter()
        .all(|package| markers.join(format!("{package}-ready")).exists());
    timeout.0.store(true, Ordering::SeqCst);
    let outcome = worker.join().expect("join timed out batch");
    if !both_ready {
        cleanup(root);
        panic!("both process groups and their nested children must be alive before timeout");
    }

    let JsTestBatchOutcome::Error {
        message,
        authorities,
        ..
    } = outcome
    else {
        panic!("timeout must atomically fail the complete batch");
    };
    assert!(message.contains("timed out"), "unexpected error: {message}");
    assert_eq!(authorities.len(), 2);
    assert!(registry.is_empty(), "reservation must be released");
    for package in ["a", "b"] {
        for role in ["parent", "child"] {
            let pid_path = markers.join(format!("{package}-{role}-pid"));
            let pid =
                test_support::wait_for_parseable_pid(&pid_path, &format!("{package} {role} pid"));
            assert_process_reaped(pid);
        }
    }
    cleanup(root);
}
