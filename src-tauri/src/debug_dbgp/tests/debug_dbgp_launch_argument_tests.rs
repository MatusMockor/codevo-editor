use super::*;

#[test]
fn builds_php_script_launch_arguments_with_xdebug_flags() {
    let arguments = build_php_launch_arguments(9007, "/workspace/php/bin/run.php");

    assert_eq!(
        arguments,
        vec![
            "-dxdebug.mode=debug".to_string(),
            "-dxdebug.start_with_request=yes".to_string(),
            "-dxdebug.client_host=127.0.0.1".to_string(),
            "-dxdebug.client_port=9007".to_string(),
            "/workspace/php/bin/run.php".to_string(),
        ]
    );
}
