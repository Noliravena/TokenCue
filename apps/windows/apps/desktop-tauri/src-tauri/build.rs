fn main() {
    // The Windows application icon lives outside this Cargo package. Without
    // an explicit dependency Cargo can reuse a stale resource.lib after the
    // ICO changes, leaving installed shortcuts on the previous icon.
    println!("cargo:rerun-if-changed=../../../rust/icons/icon.ico");
    tauri_build::build()
}
