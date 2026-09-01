use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    env, fs,
    net::{IpAddr, SocketAddr, ToSocketAddrs, UdpSocket},
    path::{Path, PathBuf},
    process::{Command, Stdio},
};
use tauri::{AppHandle, Manager};

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
struct SetupConfig {
    vm_host: String,
    vm_address: String,
    user: String,
    client_address: String,
    rtp_port: String,
    microphone: String,
    fedora_source: String,
}

#[derive(Serialize)]
struct Check {
    state: &'static str,
    detail: String,
    install_command: Option<String>,
}

#[derive(Serialize)]
struct Checks {
    moonlight: Check,
    ssh: Check,
    guest_receiver: Check,
    setup: Check,
}

#[derive(Serialize)]
struct Dependency {
    id: &'static str,
    name: &'static str,
    state: &'static str,
    detail: String,
    install_command: Option<String>,
}

#[derive(Serialize)]
struct Dashboard {
    platform: String,
    config_path: String,
    config: SetupConfig,
    checks: Checks,
    dependencies: Vec<Dependency>,
    ssh_password_source: Option<&'static str>,
}

#[derive(Serialize)]
struct SaveResult {
    path: String,
    config: SetupConfig,
}

type AppResult<T> = Result<T, String>;

fn platform_name() -> String {
    if cfg!(target_os = "windows") {
        "Windows".into()
    } else if cfg!(target_os = "macos") {
        "macOS".into()
    } else if cfg!(target_os = "linux") {
        let values = parse_values(Path::new("/etc/os-release"));
        values
            .get("PRETTY_NAME")
            .cloned()
            .unwrap_or_else(|| "Linux".into())
    } else {
        "Unsupported".into()
    }
}

fn config_path(app: &AppHandle) -> AppResult<PathBuf> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join("omarchy.env"))
}

fn parse_values(path: &Path) -> BTreeMap<String, String> {
    fs::read_to_string(path)
        .ok()
        .map(|contents| {
            contents
                .lines()
                .filter(|line| !line.trim_start().starts_with('#'))
                .filter_map(|line| line.split_once('='))
                .map(|(key, value)| {
                    (
                        key.trim().to_string(),
                        value.trim().trim_matches(['\'', '"']).to_string(),
                    )
                })
                .collect()
        })
        .unwrap_or_default()
}

fn parse_config(path: &Path) -> SetupConfig {
    let values = parse_values(path);
    SetupConfig {
        vm_host: values.get("OMARCHY_VM_HOST").cloned().unwrap_or_default(),
        vm_address: values
            .get("OMARCHY_VM_ADDRESS")
            .cloned()
            .unwrap_or_default(),
        user: values.get("OMARCHY_USER").cloned().unwrap_or_default(),
        client_address: values
            .get("OMARCHY_CLIENT_ADDRESS")
            .cloned()
            .unwrap_or_default(),
        rtp_port: values
            .get("OMARCHY_RTP_PORT")
            .cloned()
            .unwrap_or_else(|| "40100".into()),
        microphone: values
            .get("OMARCHY_MIC_DEVICE")
            .cloned()
            .unwrap_or_default(),
        fedora_source: values
            .get("OMARCHY_FEDORA_MIC_SOURCE")
            .cloned()
            .unwrap_or_else(|| "@DEFAULT_SOURCE@".into()),
    }
}

fn env_value(key: &str) -> Option<String> {
    env::var(key).ok().filter(|value| !value.trim().is_empty())
}

fn current_user() -> String {
    env_value("OMARCHY_USER")
        .or_else(|| env_value("USER"))
        .or_else(|| env_value("USERNAME"))
        .unwrap_or_default()
}

fn resolve_address(host: &str) -> Option<IpAddr> {
    (host, 22)
        .to_socket_addrs()
        .ok()?
        .map(|address| address.ip())
        .find(|address| address.is_ipv4() && !address.is_loopback())
}

fn local_address_for(remote: Option<IpAddr>) -> Option<IpAddr> {
    let remote = SocketAddr::new(remote.unwrap_or(IpAddr::from([1, 1, 1, 1])), 9);
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect(remote).ok()?;
    let address = socket.local_addr().ok()?.ip();
    (!address.is_loopback() && !address.is_unspecified()).then_some(address)
}

fn command_output(command: &str, arguments: &[&str]) -> Option<String> {
    let output = Command::new(command).args(arguments).output().ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn directshow_microphones(output: &str) -> Vec<String> {
    let mut devices: Vec<String> = output
        .lines()
        .filter(|line| line.contains("(audio)"))
        .filter_map(|line| {
            let start = line.find('"')? + 1;
            let end = line[start..].find('"')? + start;
            Some(line[start..end].to_string())
        })
        .collect();
    devices.sort();
    devices.dedup();
    devices
}

fn detect_windows_microphone() -> Option<String> {
    if !cfg!(target_os = "windows") || !command_exists("ffmpeg") {
        return None;
    }
    let output = Command::new("ffmpeg")
        .args([
            "-hide_banner",
            "-list_devices",
            "true",
            "-f",
            "dshow",
            "-i",
            "dummy",
        ])
        .output()
        .ok()?;
    let devices = directshow_microphones(&String::from_utf8_lossy(&output.stderr));
    (devices.len() == 1).then(|| devices[0].clone())
}

fn detect_config(mut config: SetupConfig) -> SetupConfig {
    if config.vm_host.is_empty() {
        config.vm_host = env_value("OMARCHY_VM_HOST").unwrap_or_else(|| "omarchy.local".into());
    }
    if config.user.is_empty() {
        config.user = current_user();
    }
    if config.rtp_port.is_empty() {
        config.rtp_port = env_value("OMARCHY_RTP_PORT").unwrap_or_else(|| "40100".into());
    }
    if config.fedora_source.is_empty() {
        config.fedora_source = if cfg!(target_os = "linux") {
            command_output("pactl", &["get-default-source"])
                .unwrap_or_else(|| "@DEFAULT_SOURCE@".into())
        } else {
            "@DEFAULT_SOURCE@".into()
        };
    }
    if config.microphone.is_empty() {
        config.microphone = detect_windows_microphone().unwrap_or_default();
    }

    let resolved = resolve_address(&config.vm_host);
    if config.vm_address.is_empty() {
        config.vm_address = env_value("OMARCHY_VM_ADDRESS")
            .or_else(|| resolved.map(|address| address.to_string()))
            .unwrap_or_default();
    }
    if config.client_address.is_empty() {
        let route_target = config.vm_address.parse().ok().or(resolved);
        config.client_address = env_value("OMARCHY_CLIENT_ADDRESS")
            .or_else(|| local_address_for(route_target).map(|address| address.to_string()))
            .unwrap_or_default();
    }
    config
}

fn validate_config(config: &SetupConfig) -> AppResult<()> {
    for (name, value) in [
        ("Host SSH della VM", &config.vm_host),
        ("IP LAN della VM", &config.vm_address),
        ("Utente della VM", &config.user),
        ("IP del client", &config.client_address),
    ] {
        if value.trim().is_empty() || value.contains(['\n', '\r', '\0']) {
            return Err(format!("{name} mancante o non valido"));
        }
    }
    config
        .vm_address
        .parse::<IpAddr>()
        .map_err(|_| "IP LAN della VM non valido".to_string())?;
    config
        .client_address
        .parse::<IpAddr>()
        .map_err(|_| "IP del client non valido".to_string())?;
    let port = config
        .rtp_port
        .parse::<u16>()
        .map_err(|_| "Porta RTP non valida".to_string())?;
    if port == 0 {
        return Err("Porta RTP non valida".into());
    }
    if cfg!(target_os = "windows") && config.microphone.trim().is_empty() {
        return Err("Microfono Windows mancante: seleziona il dispositivo di input".into());
    }
    for (name, value) in [
        ("Microfono Windows", &config.microphone),
        ("Sorgente PipeWire Fedora", &config.fedora_source),
    ] {
        if value.contains(['\n', '\r', '\0']) {
            return Err(format!("{name} non valido"));
        }
    }
    if !config
        .user
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-'))
    {
        return Err("Utente VM non valido per SSH".into());
    }
    if !config
        .vm_host
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '.' | ':' | '-'))
    {
        return Err("Host VM non valido per SSH".into());
    }
    Ok(())
}

fn quote_env(value: &str) -> String {
    if value.chars().all(|character| {
        character.is_ascii_alphanumeric()
            || matches!(
                character,
                '_' | '-' | '.' | ':' | '/' | '@' | ' ' | '(' | ')'
            )
    }) {
        value.to_string()
    } else {
        format!("'{}'", value.replace('\'', "'\"'\"'"))
    }
}

fn config_contents(config: &SetupConfig, preserved_password: Option<&str>) -> String {
    let mut contents: String = [
        ("OMARCHY_USER", &config.user),
        ("OMARCHY_VM_HOST", &config.vm_host),
        ("OMARCHY_VM_ADDRESS", &config.vm_address),
        ("OMARCHY_CLIENT_ADDRESS", &config.client_address),
        ("OMARCHY_RTP_PORT", &config.rtp_port),
        ("OMARCHY_MIC_DEVICE", &config.microphone),
        ("OMARCHY_FEDORA_MIC_SOURCE", &config.fedora_source),
    ]
    .into_iter()
    .map(|(key, value)| format!("{key}={}\n", quote_env(value)))
    .collect();
    if let Some(password) = preserved_password.filter(|value| !value.is_empty()) {
        contents.push_str(&format!(
            "# Credenziale esplicitamente gestita dall'utente; la GUI non la modifica.\nOMARCHY_SSH_PASSWORD={}\n",
            quote_env(password)
        ));
    }
    contents
}

fn command_exists(command: &str) -> bool {
    if cfg!(target_os = "windows") {
        Command::new("where")
            .arg(command)
            .output()
            .is_ok_and(|output| output.status.success())
    } else {
        Command::new("sh")
            .args(["-lc", &format!("command -v {command}")])
            .output()
            .is_ok_and(|output| output.status.success())
    }
}

fn flatpak_installed(application: &str) -> bool {
    command_exists("flatpak")
        && Command::new("flatpak")
            .args(["info", application])
            .output()
            .is_ok_and(|output| output.status.success())
}

fn ffmpeg_has_opus() -> bool {
    let Ok(output) = Command::new("ffmpeg")
        .args(["-hide_banner", "-encoders"])
        .output()
    else {
        return false;
    };
    output.status.success()
        && (String::from_utf8_lossy(&output.stdout).contains("libopus")
            || String::from_utf8_lossy(&output.stderr).contains("libopus"))
}

fn windows_moonlight_path() -> Option<PathBuf> {
    if !cfg!(target_os = "windows") {
        return None;
    }
    let mut candidates = Vec::new();
    if let Some(path) = env::var_os("LOCALAPPDATA") {
        candidates.push(
            PathBuf::from(path)
                .join("Programs")
                .join("Moonlight Game Streaming")
                .join("Moonlight.exe"),
        );
    }
    for variable in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(path) = env::var_os(variable) {
            candidates.push(
                PathBuf::from(path)
                    .join("Moonlight Game Streaming")
                    .join("Moonlight.exe"),
            );
        }
    }
    candidates.into_iter().find(|path| path.is_file())
}

fn dependency(
    id: &'static str,
    name: &'static str,
    ready: bool,
    ready_detail: &str,
    missing_detail: &str,
    install_command: Option<&str>,
) -> Dependency {
    Dependency {
        id,
        name,
        state: if ready { "ready" } else { "missing" },
        detail: if ready { ready_detail } else { missing_detail }.into(),
        install_command: (!ready)
            .then(|| install_command.map(str::to_string))
            .flatten(),
    }
}

fn dependencies() -> Vec<Dependency> {
    if cfg!(target_os = "windows") {
        vec![
            dependency(
                "moonlight",
                "Moonlight",
                command_exists("moonlight")
                    || command_exists("moonlight.exe")
                    || windows_moonlight_path().is_some(),
                "Client disponibile",
                "Client non rilevato nel PATH",
                Some("winget install --id MoonlightGameStreamingProject.Moonlight -e"),
            ),
            dependency(
                "ssh",
                "OpenSSH Client",
                command_exists("ssh"),
                "Client SSH disponibile",
                "SSH richiesto per configurare il receiver",
                Some("Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0"),
            ),
            dependency(
                "ffmpeg",
                "FFmpeg",
                ffmpeg_has_opus(),
                "Acquisizione audio Opus disponibile",
                "FFmpeg con encoder libopus richiesto per il tunnel microfono",
                Some("winget install --id Gyan.FFmpeg -e"),
            ),
            dependency(
                "kdeconnect",
                "KDE Connect",
                command_exists("kdeconnect-cli"),
                "Clipboard bidirezionale disponibile",
                "Opzionale: abilita clipboard e file",
                Some("winget install --id KDE.KDEConnect -e"),
            ),
        ]
    } else if cfg!(target_os = "macos") {
        vec![
            dependency(
                "moonlight",
                "Moonlight",
                Path::new("/Applications/Moonlight.app").exists(),
                "Moonlight.app disponibile",
                "Moonlight.app non installata",
                Some("brew install --cask moonlight"),
            ),
            dependency(
                "ssh",
                "OpenSSH Client",
                command_exists("ssh"),
                "Client SSH disponibile",
                "SSH non rilevato",
                None,
            ),
        ]
    } else {
        vec![
            dependency("moonlight", "Moonlight", flatpak_installed("com.moonlight_stream.Moonlight"), "Flatpak installato", "Client streaming non installato", Some("flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo && flatpak install --user -y flathub com.moonlight_stream.Moonlight")),
            dependency("ssh", "OpenSSH Client", command_exists("ssh") && command_exists("scp"), "SSH e SCP disponibili", "Richiesto per configurare Omarchy", Some("sudo dnf install -y openssh-clients")),
            dependency("ffmpeg", "FFmpeg + Opus", ffmpeg_has_opus(), "Trasporto audio Opus disponibile", "FFmpeg con encoder libopus richiesto per il tunnel microfono", Some("sudo dnf install -y ffmpeg-free")),
            dependency("pipewire", "PipeWire tools", command_exists("pactl"), "Sorgente microfono rilevabile", "pactl non disponibile", Some("sudo dnf install -y pulseaudio-utils pipewire-pulseaudio")),
            dependency("kdeconnect", "KDE Connect", command_exists("kdeconnect-cli"), "Clipboard bidirezionale disponibile", "Opzionale: abilita clipboard e file", Some("sudo dnf install -y kde-connect")),
        ]
    }
}

fn dependency_check(dependency: &Dependency) -> Check {
    Check {
        state: dependency.state,
        detail: dependency.detail.clone(),
        install_command: dependency.install_command.clone(),
    }
}

fn secret_from_config(path: &Path) -> Option<String> {
    parse_values(path)
        .get("OMARCHY_SSH_PASSWORD")
        .cloned()
        .filter(|value| !value.is_empty())
}

fn configured_password_source(path: &Path) -> Option<&'static str> {
    if env_value("OMARCHY_SSH_PASSWORD").is_some() {
        Some("environment")
    } else if secret_from_config(path).is_some() {
        Some("config")
    } else {
        None
    }
}

fn effective_password(app: &AppHandle, provided: Option<String>) -> AppResult<Option<String>> {
    if let Some(password) = provided.filter(|value| !value.is_empty()) {
        return Ok(Some(password));
    }
    if let Some(password) = env_value("OMARCHY_SSH_PASSWORD") {
        return Ok(Some(password));
    }
    Ok(secret_from_config(&config_path(app)?))
}

fn prepare_askpass(command: &mut Command, password: &str) -> AppResult<()> {
    let executable = env::current_exe().map_err(|error| error.to_string())?;
    command
        .env("SSH_ASKPASS", executable)
        .env("SSH_ASKPASS_REQUIRE", "force")
        .env("OMARCHY_ASKPASS_MODE", "1")
        .env("OMARCHY_SSH_PASSWORD", password)
        .stdin(Stdio::null());
    if env::var_os("DISPLAY").is_none() {
        command.env("DISPLAY", ":0");
    }
    Ok(())
}

fn receiver_check(config: &SetupConfig, password: Option<&str>) -> Check {
    if config.vm_host.is_empty() || config.user.is_empty() {
        return Check {
            state: "unknown",
            detail: "Host e utente VM non disponibili".into(),
            install_command: None,
        };
    }
    if !command_exists("ssh") {
        return Check {
            state: "blocked",
            detail: "Installa OpenSSH Client prima della verifica".into(),
            install_command: None,
        };
    }
    let target = format!("{}@{}", config.user, config.vm_host);
    let mut command = Command::new("ssh");
    command.args([
        "-o",
        "StrictHostKeyChecking=accept-new",
        "-o",
        "ConnectTimeout=5",
        "-o",
        "NumberOfPasswordPrompts=1",
    ]);
    if let Some(secret) = password {
        if let Err(error) = prepare_askpass(&mut command, secret) {
            return Check {
                state: "blocked",
                detail: error,
                install_command: None,
            };
        }
    } else {
        command.args(["-o", "BatchMode=yes"]);
    }
    let result = command
        .arg(target)
        .arg("test -x ~/.local/bin/voxtype-remote-mic-ssh-dispatch && test -f ~/.config/systemd/user/voxtype-remote-mic-rtp.service")
        .output();
    match result {
        Ok(output) if output.status.success() => Check {
            state: "ready",
            detail: "Connessione SSH e receiver verificati".into(),
            install_command: None,
        },
        Ok(output) if password.is_some() && output.status.code() == Some(1) => Check {
            state: "missing",
            detail: "SSH sbloccato; receiver non ancora installato. Esegui Configura client."
                .into(),
            install_command: None,
        },
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let detail = if stderr.contains("Permission denied") {
                "Autenticazione richiesta: inserisci la password SSH o configura OMARCHY_SSH_PASSWORD".into()
            } else if stderr.trim().is_empty() {
                "Receiver assente oppure host non raggiungibile".into()
            } else {
                stderr
                    .lines()
                    .last()
                    .unwrap_or("Verifica SSH fallita")
                    .trim()
                    .to_string()
            };
            Check {
                state: "blocked",
                detail,
                install_command: None,
            }
        }
        Err(error) => Check {
            state: "blocked",
            detail: format!("Verifica SSH fallita: {error}"),
            install_command: None,
        },
    }
}

fn asset(app: &AppHandle, relative: &str) -> AppResult<PathBuf> {
    if let Ok(directory) = app.path().resource_dir() {
        let candidate = directory.join(relative);
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repository = manifest
        .ancestors()
        .nth(3)
        .ok_or("repository root non trovato")?;
    let candidate = repository.join(relative);
    candidate
        .is_file()
        .then_some(candidate)
        .ok_or_else(|| format!("asset applicazione mancante: {relative}"))
}

fn shell_quote(value: &Path) -> String {
    format!("'{}'", value.display().to_string().replace('\'', "'\"'\"'"))
}

fn powershell_quote(value: &Path) -> String {
    format!("'{}'", value.display().to_string().replace('\'', "''"))
}

fn open_linux_terminal(command_line: &str) -> AppResult<()> {
    let terminals: [(&str, &[&str]); 4] = [
        ("kgx", &["--", "bash", "-lc"]),
        ("gnome-terminal", &["--", "bash", "-lc"]),
        ("konsole", &["-e", "bash", "-lc"]),
        ("xterm", &["-e", "bash", "-lc"]),
    ];
    for (terminal, arguments) in terminals {
        if command_exists(terminal) {
            Command::new(terminal)
                .args(arguments)
                .arg(command_line)
                .spawn()
                .map_err(|error| format!("Impossibile aprire {terminal}: {error}"))?;
            return Ok(());
        }
    }
    Err("Nessun terminale grafico trovato (kgx, gnome-terminal, konsole, xterm)".into())
}

#[tauri::command]
fn inspect_setup(app: AppHandle) -> AppResult<Dashboard> {
    let path = config_path(&app)?;
    let config = detect_config(parse_config(&path));
    let dependency_list = dependencies();
    let moonlight = dependency_list
        .iter()
        .find(|dependency| dependency.id == "moonlight")
        .map(dependency_check)
        .unwrap();
    let ssh = dependency_list
        .iter()
        .find(|dependency| dependency.id == "ssh")
        .map(dependency_check)
        .unwrap();
    let setup = if cfg!(target_os = "macos") {
        Check {
            state: "blocked",
            detail: "Launcher disponibile; tunnel microfono macOS non ancora implementato".into(),
            install_command: None,
        }
    } else {
        Check {
            state: "ready",
            detail: "Automazione client inclusa nel pacchetto".into(),
            install_command: None,
        }
    };
    Ok(Dashboard {
        platform: platform_name(),
        config_path: path.display().to_string(),
        checks: Checks {
            moonlight,
            ssh,
            guest_receiver: receiver_check(&config, None),
            setup,
        },
        dependencies: dependency_list,
        ssh_password_source: configured_password_source(&path),
        config,
    })
}

#[tauri::command]
fn discover_config(config: SetupConfig) -> SetupConfig {
    detect_config(config)
}

#[tauri::command]
fn check_receiver(
    app: AppHandle,
    config: SetupConfig,
    ssh_password: Option<String>,
) -> AppResult<Check> {
    let config = detect_config(config);
    let password = effective_password(&app, ssh_password)?;
    Ok(receiver_check(&config, password.as_deref()))
}

#[tauri::command]
fn save_config(app: AppHandle, config: SetupConfig) -> AppResult<SaveResult> {
    let config = detect_config(config);
    validate_config(&config)?;
    let path = config_path(&app)?;
    let preserved_password = secret_from_config(&path);
    fs::write(
        &path,
        config_contents(&config, preserved_password.as_deref()),
    )
    .map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
            .map_err(|error| error.to_string())?;
    }
    Ok(SaveResult {
        path: path.display().to_string(),
        config,
    })
}

#[tauri::command]
fn launch_moonlight() -> AppResult<()> {
    if cfg!(target_os = "windows") {
        if let Some(path) = windows_moonlight_path() {
            Command::new(path).spawn()
        } else {
            Command::new("cmd")
                .args(["/C", "start", "", "moonlight"])
                .spawn()
        }
    } else if cfg!(target_os = "macos") {
        Command::new("open").args(["-a", "Moonlight"]).spawn()
    } else {
        Command::new("flatpak")
            .args(["run", "com.moonlight_stream.Moonlight"])
            .spawn()
    }
    .map_err(|error| format!("Impossibile avviare Moonlight: {error}"))?;
    Ok(())
}

#[tauri::command]
fn install_dependency(dependency_id: String) -> AppResult<String> {
    let entry = dependencies()
        .into_iter()
        .find(|dependency| dependency.id == dependency_id)
        .ok_or_else(|| "Dipendenza sconosciuta".to_string())?;
    if entry.state == "ready" {
        return Ok(format!("{} e' gia disponibile", entry.name));
    }
    let install = entry
        .install_command
        .ok_or_else(|| format!("Nessun installer automatico disponibile per {}", entry.name))?;
    if cfg!(target_os = "windows") {
        Command::new("powershell.exe")
            .args(["-NoExit", "-Command", &install])
            .spawn()
            .map_err(|error| format!("Impossibile aprire PowerShell: {error}"))?;
    } else if cfg!(target_os = "linux") {
        let instruction = format!(
            "{install}; status=$?; echo; read -r -p 'Premi Invio per chiudere…'; exit $status"
        );
        open_linux_terminal(&instruction)?;
    } else {
        return Err(format!("Apri Terminale ed esegui: {install}"));
    }
    Ok(format!("Installer di {} aperto nel terminale", entry.name))
}

#[tauri::command]
fn run_setup_in_terminal(app: AppHandle, ssh_password: Option<String>) -> AppResult<String> {
    let path = config_path(&app)?;
    let config = detect_config(parse_config(&path));
    validate_config(&config)?;
    let password = effective_password(&app, ssh_password)?;
    let configure_askpass = |command: &mut Command| -> AppResult<()> {
        if let Some(secret) = password.as_deref() {
            prepare_askpass(command, secret)?;
            command.env("OMARCHY_SUDO_PASSWORD", secret);
        }
        Ok(())
    };
    if cfg!(target_os = "windows") {
        let script = asset(&app, "clients/omarchy-client-setup.ps1")?;
        let instruction = format!(
            "try {{ & {} -ConfigPath {} -Module All -InstallKey }} finally {{ Remove-Item Env:OMARCHY_SSH_PASSWORD,Env:OMARCHY_SUDO_PASSWORD,Env:OMARCHY_ASKPASS_MODE -ErrorAction SilentlyContinue }}",
            powershell_quote(&script),
            powershell_quote(&path)
        );
        let mut command = Command::new("powershell.exe");
        command
            .args(["-NoExit", "-ExecutionPolicy", "Bypass", "-Command"])
            .arg(instruction);
        configure_askpass(&mut command)?;
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0000_0010);
        }
        command
            .spawn()
            .map_err(|error| format!("Impossibile aprire PowerShell: {error}"))?;
        Ok("PowerShell aperto. La password SSH resta soltanto nella memoria del processo; eventuale sudo viene mostrato nel terminale.".into())
    } else if cfg!(target_os = "linux") {
        let script = asset(&app, "clients/omarchy-client-setup-fedora.sh")?;
        let instruction = format!(
            "{} --config {} --module onboard; status=$?; unset OMARCHY_SSH_PASSWORD OMARCHY_SUDO_PASSWORD OMARCHY_ASKPASS_MODE; echo; read -r -p 'Premi Invio per chiudere…'; exit $status",
            shell_quote(&script),
            shell_quote(&path)
        );
        let terminals: [(&str, &[&str]); 4] = [
            ("kgx", &["--", "bash", "-lc"]),
            ("gnome-terminal", &["--", "bash", "-lc"]),
            ("konsole", &["-e", "bash", "-lc"]),
            ("xterm", &["-e", "bash", "-lc"]),
        ];
        for (terminal, arguments) in terminals {
            if command_exists(terminal) {
                let mut command = Command::new(terminal);
                command.args(arguments).arg(&instruction);
                configure_askpass(&mut command)?;
                command
                    .spawn()
                    .map_err(|error| format!("Impossibile aprire {terminal}: {error}"))?;
                return Ok(if password.is_some() {
                    "Wizard Fedora aperto con credenziale SSH temporanea; non viene scritta nel file locale.".into()
                } else {
                    "Wizard Fedora aperto; SSH o sudo possono chiedere la password nel terminale."
                        .into()
                });
            }
        }
        Err("Nessun terminale grafico trovato (kgx, gnome-terminal, konsole, xterm)".into())
    } else {
        Err("macOS non ha ancora l'adapter RTP microfono in questa release".into())
    }
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            inspect_setup,
            discover_config,
            check_receiver,
            save_config,
            launch_moonlight,
            install_dependency,
            run_setup_in_terminal
        ])
        .run(tauri::generate_context!())
        .expect("errore durante l'avvio di Omarchy Control");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_defaults_without_overwriting_manual_values() {
        let config = SetupConfig {
            vm_host: "192.0.2.10".into(),
            vm_address: "192.0.2.10".into(),
            user: "manual-user".into(),
            client_address: "192.0.2.20".into(),
            rtp_port: "40200".into(),
            microphone: "manual mic".into(),
            fedora_source: "manual-source".into(),
        };
        let detected = detect_config(config.clone());
        assert_eq!(detected.vm_host, config.vm_host);
        assert_eq!(detected.client_address, config.client_address);
        assert_eq!(detected.rtp_port, "40200");
    }

    #[test]
    fn generated_config_never_adds_a_password() {
        let config = SetupConfig {
            vm_host: "omarchy.local".into(),
            vm_address: "192.0.2.10".into(),
            user: "demo".into(),
            client_address: "192.0.2.20".into(),
            rtp_port: "40100".into(),
            ..Default::default()
        };
        assert!(!config_contents(&config, None).contains("SSH_PASSWORD"));
    }

    #[test]
    fn parses_and_deduplicates_directshow_microphones() {
        let sample = r#"
[dshow @ 0001] "Microphone Array (Realtek Audio)" (audio)
[dshow @ 0001]   Alternative name "@device_cm_foo"
[dshow @ 0001] "USB Microphone" (audio)
[dshow @ 0001] "USB Microphone" (audio)
"#;
        assert_eq!(
            directshow_microphones(sample),
            vec!["Microphone Array (Realtek Audio)", "USB Microphone"]
        );
    }
}
