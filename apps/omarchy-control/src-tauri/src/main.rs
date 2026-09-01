fn main() {
    if std::env::var_os("OMARCHY_ASKPASS_MODE").is_some() {
        if let Ok(secret) = std::env::var("OMARCHY_SSH_PASSWORD") {
            print!("{secret}");
        }
        return;
    }
    omarchy_control_lib::run();
}
