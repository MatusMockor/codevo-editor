fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        cc::Build::new()
            .file("native/node_attach_socket_owner_macos.c")
            .warnings(true)
            .compile("codevo_node_attach_socket_owner");
        println!("cargo:rerun-if-changed=native/node_attach_socket_owner_macos.c");
    }
    tauri_build::build()
}
