use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    env, fs,
    net::{IpAddr, SocketAddr, ToSocketAddrs, UdpSocket},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::Duration,
};
use tauri::{AppHandle, Manager, WebviewWindow};

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

#[derive(Serialize)]
struct DisplayInfo {
    index: usize,
    name: String,
    width: u32,
    height: u32,
    scale_factor: f64,
}

#[derive(Clone, Copy)]
enum MoonlightSetting {
    Integer(u32),
    Boolean(bool),
}

impl MoonlightSetting {
    fn ini_value(self) -> String {
        match self {
            Self::Integer(value) => value.to_string(),
            Self::Boolean(value) => value.to_string(),
        }
    }
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
    let ffmpeg = windows_ffmpeg_path()?;
    let output = Command::new(ffmpeg)
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

fn flatpak_running(application: &str) -> bool {
    Command::new("flatpak")
        .args(["ps", "--columns=application"])
        .output()
        .is_ok_and(|output| {
            output.status.success()
                && String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .any(|line| line.trim() == application)
        })
}

fn ffmpeg_has_opus() -> bool {
    let Some(ffmpeg) = ffmpeg_path() else {
        return false;
    };
    let Ok(output) = Command::new(ffmpeg)
        .args(["-hide_banner", "-encoders"])
        .output()
    else {
        return false;
    };
    output.status.success()
        && (String::from_utf8_lossy(&output.stdout).contains("libopus")
            || String::from_utf8_lossy(&output.stderr).contains("libopus"))
}

fn windows_path(variable: &str, relative: &[&str]) -> Option<PathBuf> {
    let mut path = PathBuf::from(env::var_os(variable)?);
    for component in relative {
        path.push(component);
    }
    path.is_file().then_some(path)
}

fn windows_ffmpeg_path() -> Option<PathBuf> {
    if !cfg!(target_os = "windows") {
        return None;
    }
    command_output("where", &["ffmpeg.exe"])
        .and_then(|output| output.lines().next().map(PathBuf::from))
        .filter(|path| path.is_file())
        .or_else(|| {
            windows_path(
                "LOCALAPPDATA",
                &["Microsoft", "WinGet", "Links", "ffmpeg.exe"],
            )
        })
        .or_else(|| windows_path("ProgramData", &["chocolatey", "bin", "ffmpeg.exe"]))
}

fn ffmpeg_path() -> Option<PathBuf> {
    if cfg!(target_os = "windows") {
        windows_ffmpeg_path()
    } else {
        command_exists("ffmpeg").then(|| PathBuf::from("ffmpeg"))
    }
}

fn windows_kdeconnect_path() -> Option<PathBuf> {
    if !cfg!(target_os = "windows") {
        return None;
    }
    command_output("where", &["kdeconnect-cli.exe"])
        .and_then(|output| output.lines().next().map(PathBuf::from))
        .filter(|path| path.is_file())
        .or_else(|| {
            windows_path(
                "ProgramFiles",
                &["KDE Connect", "bin", "kdeconnect-cli.exe"],
            )
        })
}

fn macos_brew_path() -> Option<PathBuf> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    command_output("sh", &["-lc", "command -v brew"])
        .map(PathBuf::from)
        .filter(|path| path.is_file())
        .or_else(|| {
            ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"]
                .into_iter()
                .map(PathBuf::from)
                .find(|path| path.is_file())
        })
}

fn macos_moonlight_path() -> Option<PathBuf> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    let mut candidates = vec![PathBuf::from("/Applications/Moonlight.app")];
    if let Some(home) = env::var_os("HOME") {
        candidates.push(PathBuf::from(home).join("Applications/Moonlight.app"));
    }
    candidates.into_iter().find(|path| path.is_dir())
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

fn moonlight_default_bitrate_kbps(width: u32, height: u32, fps: u32) -> u32 {
    let table = [
        (640_u64 * 360, 1.0),
        (854_u64 * 480, 2.0),
        (1280_u64 * 720, 5.0),
        (1920_u64 * 1080, 10.0),
        (2560_u64 * 1440, 20.0),
        (3840_u64 * 2160, 40.0),
    ];
    let pixels = u64::from(width) * u64::from(height);
    let mut resolution_factor = table.last().expect("tabella bitrate vuota").1;
    for (index, &(limit, factor)) in table.iter().enumerate() {
        if pixels == limit {
            resolution_factor = factor;
            break;
        }
        if pixels < limit {
            resolution_factor = if index == 0 {
                factor
            } else {
                let (previous_limit, previous_factor) = table[index - 1];
                let ratio = (pixels - previous_limit) as f64 / (limit - previous_limit) as f64;
                previous_factor + ratio * (factor - previous_factor)
            };
            break;
        }
    }
    let frame_factor = if fps <= 60 {
        f64::from(fps) / 30.0
    } else {
        (f64::from(fps) / 60.0).sqrt() * 2.0
    };
    (resolution_factor * frame_factor).round() as u32 * 1000
}

fn moonlight_gaming_settings(width: u32, height: u32) -> BTreeMap<&'static str, MoonlightSetting> {
    let window_mode = if cfg!(target_os = "windows") { 0 } else { 1 };
    BTreeMap::from([
        ("audiocfg", MoonlightSetting::Integer(0)),
        ("autoadjustbitrate", MoonlightSetting::Boolean(true)),
        (
            "bitrate",
            MoonlightSetting::Integer(moonlight_default_bitrate_kbps(width, height, 60)),
        ),
        ("capturesyskeys", MoonlightSetting::Integer(1)),
        ("fps", MoonlightSetting::Integer(60)),
        ("framepacing", MoonlightSetting::Boolean(true)),
        ("gameopts", MoonlightSetting::Boolean(true)),
        ("hdr", MoonlightSetting::Boolean(false)),
        ("height", MoonlightSetting::Integer(height)),
        ("hostaudio", MoonlightSetting::Boolean(false)),
        ("keepawake", MoonlightSetting::Boolean(true)),
        ("mdns", MoonlightSetting::Boolean(true)),
        ("multicontroller", MoonlightSetting::Boolean(true)),
        ("showperfoverlay", MoonlightSetting::Boolean(false)),
        ("unlockbitrate", MoonlightSetting::Boolean(false)),
        ("videocfg", MoonlightSetting::Integer(0)),
        ("videodec", MoonlightSetting::Integer(0)),
        ("vsync", MoonlightSetting::Boolean(true)),
        ("width", MoonlightSetting::Integer(width)),
        ("windowmode", MoonlightSetting::Integer(window_mode)),
        ("yuv444", MoonlightSetting::Boolean(false)),
    ])
}

fn update_ini_general(contents: &str, settings: &BTreeMap<&str, MoonlightSetting>) -> String {
    let mut pending = settings.clone();
    let mut output = Vec::new();
    let mut in_general = false;
    let mut found_general = false;

    let append_pending = |output: &mut Vec<String>,
                          pending: &mut BTreeMap<&str, MoonlightSetting>| {
        for (key, value) in std::mem::take(pending) {
            output.push(format!("{key}={}", value.ini_value()));
        }
    };

    for line in contents.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            if in_general {
                append_pending(&mut output, &mut pending);
            }
            in_general = trimmed == "[General]";
            found_general |= in_general;
            output.push(line.to_string());
            continue;
        }
        if in_general {
            if let Some((key, _)) = line.split_once('=') {
                if let Some(value) = pending.remove(key.trim()) {
                    output.push(format!("{}={}", key.trim(), value.ini_value()));
                    continue;
                }
            }
        }
        output.push(line.to_string());
    }
    if in_general {
        append_pending(&mut output, &mut pending);
    } else if !found_general {
        if output.last().is_some_and(|line| !line.is_empty()) {
            output.push(String::new());
        }
        output.push("[General]".into());
        append_pending(&mut output, &mut pending);
    }
    format!("{}\n", output.join("\n"))
}

fn ensure_command_success(command: &mut Command, context: &str) -> AppResult<()> {
    let output = command
        .output()
        .map_err(|error| format!("{context}: {error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        let detail = String::from_utf8_lossy(&output.stderr);
        Err(format!("{context}: {}", detail.trim()))
    }
}

fn stop_moonlight() -> AppResult<()> {
    if cfg!(target_os = "linux") {
        if flatpak_running("com.moonlight_stream.Moonlight") {
            ensure_command_success(
                Command::new("flatpak").args(["kill", "com.moonlight_stream.Moonlight"]),
                "Impossibile chiudere Moonlight Flatpak",
            )?;
        }
    } else if cfg!(target_os = "windows") {
        let running = command_output("tasklist", &["/FI", "IMAGENAME eq Moonlight.exe", "/NH"])
            .is_some_and(|output| output.to_ascii_lowercase().contains("moonlight.exe"));
        if running {
            ensure_command_success(
                Command::new("taskkill").args(["/IM", "Moonlight.exe"]),
                "Impossibile chiudere Moonlight",
            )?;
        }
    } else if cfg!(target_os = "macos")
        && Command::new("pgrep")
            .args(["-x", "Moonlight"])
            .status()
            .is_ok_and(|status| status.success())
    {
        ensure_command_success(
            Command::new("osascript").args(["-e", "tell application \"Moonlight\" to quit"]),
            "Impossibile chiudere Moonlight",
        )?;
    }
    thread::sleep(Duration::from_millis(350));
    Ok(())
}

fn write_moonlight_settings(settings: &BTreeMap<&str, MoonlightSetting>) -> AppResult<()> {
    if cfg!(target_os = "windows") {
        let key = r"HKCU\Software\Moonlight Game Streaming Project\Moonlight";
        for (name, value) in settings {
            let data = match value {
                MoonlightSetting::Integer(value) => value.to_string(),
                MoonlightSetting::Boolean(value) => u8::from(*value).to_string(),
            };
            ensure_command_success(
                Command::new("reg").args([
                    "add",
                    key,
                    "/v",
                    name,
                    "/t",
                    "REG_DWORD",
                    "/d",
                    &data,
                    "/f",
                ]),
                &format!("Impossibile salvare la preferenza Moonlight {name}"),
            )?;
        }
    } else if cfg!(target_os = "macos") {
        for (name, value) in settings {
            let (kind, data) = match value {
                MoonlightSetting::Integer(value) => ("-int", value.to_string()),
                MoonlightSetting::Boolean(value) => ("-bool", value.to_string()),
            };
            ensure_command_success(
                Command::new("defaults").args([
                    "write",
                    "com.moonlight-stream.Moonlight",
                    name,
                    kind,
                    &data,
                ]),
                &format!("Impossibile salvare la preferenza Moonlight {name}"),
            )?;
        }
    } else {
        let home = env::var_os("HOME").ok_or_else(|| "HOME non disponibile".to_string())?;
        let path = PathBuf::from(home)
            .join(".var/app/com.moonlight_stream.Moonlight/config/Moonlight Game Streaming Project/Moonlight.conf");
        let contents = fs::read_to_string(&path).map_err(|_| {
            "Profilo Moonlight mancante: avvia Moonlight una volta, chiudilo e riprova".to_string()
        })?;
        let backup = path.with_extension("conf.omarchy-control.bak");
        if !backup.exists() {
            fs::copy(&path, &backup)
                .map_err(|error| format!("Backup Moonlight fallito: {error}"))?;
        }
        fs::write(&path, update_ini_general(&contents, settings))
            .map_err(|error| format!("Scrittura preferenze Moonlight fallita: {error}"))?;
    }
    Ok(())
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
        let ffmpeg_available = ffmpeg_path().is_some();
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
                if ffmpeg_available {
                    "FFmpeg presente ma senza libopus: aggiorna la distribuzione gia installata"
                } else {
                    "FFmpeg con encoder libopus richiesto per il tunnel microfono"
                },
                (!ffmpeg_available).then_some("winget install --id Gyan.FFmpeg -e"),
            ),
            dependency(
                "kdeconnect",
                "KDE Connect",
                windows_kdeconnect_path().is_some(),
                "Clipboard bidirezionale disponibile",
                "Opzionale: abilita clipboard e file",
                Some("winget install --id KDE.KDEConnect -e"),
            ),
        ]
    } else if cfg!(target_os = "macos") {
        let brew = macos_brew_path();
        let brew_ready = brew.is_some();
        let moonlight_ready = macos_moonlight_path().is_some();
        let moonlight_install = brew
            .as_ref()
            .map(|path| format!("'{}' install --cask moonlight", path.display()));
        let mut result = Vec::new();
        if !moonlight_ready && !brew_ready {
            result.push(dependency(
                "homebrew",
                "Homebrew",
                false,
                "Gestore pacchetti disponibile",
                "Richiesto per installare Moonlight dalla GUI",
                Some("open https://brew.sh"),
            ));
        }
        result.extend([
            dependency(
                "moonlight",
                "Moonlight",
                moonlight_ready,
                "Moonlight.app disponibile",
                if brew_ready {
                    "Moonlight.app non installata"
                } else {
                    "Installa prima Homebrew"
                },
                moonlight_install.as_deref(),
            ),
            dependency(
                "ssh",
                "OpenSSH Client",
                command_exists("ssh"),
                "Client SSH disponibile",
                "SSH non rilevato",
                None,
            ),
        ]);
        result
    } else {
        let ffmpeg_available = command_exists("ffmpeg");
        vec![
            dependency("moonlight", "Moonlight", flatpak_installed("com.moonlight_stream.Moonlight"), "Flatpak installato", "Client streaming non installato", Some("flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo && flatpak install --user -y flathub com.moonlight_stream.Moonlight")),
            dependency("ssh", "OpenSSH Client", command_exists("ssh") && command_exists("scp"), "SSH e SCP disponibili", "Richiesto per configurare Omarchy", Some("sudo dnf install -y openssh-clients")),
            dependency(
                "ffmpeg",
                "FFmpeg + Opus",
                ffmpeg_has_opus(),
                "Trasporto audio Opus disponibile",
                if ffmpeg_available {
                    "FFmpeg presente ma senza libopus: scegli una build compatibile con i repository gia configurati"
                } else {
                    "FFmpeg con encoder libopus richiesto per il tunnel microfono"
                },
                (!ffmpeg_available).then_some("sudo dnf install -y ffmpeg-free"),
            ),
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

fn receiver_key_path() -> Option<PathBuf> {
    if cfg!(target_os = "windows") {
        env::var_os("USERPROFILE")
            .map(PathBuf::from)
            .map(|home| home.join(".ssh").join("voxtype-omarchy_ed25519"))
    } else if cfg!(target_os = "linux") {
        env::var_os("HOME").map(PathBuf::from).map(|home| {
            home.join(".config")
                .join("omarchy")
                .join("voxtype-omarchy_ed25519")
        })
    } else {
        None
    }
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
    // Once installed, the restricted key is the receiver's canonical health
    // channel. Do not replace a working key check with a password merely
    // because the password field still contains its temporary value.
    let dedicated_key = receiver_key_path().filter(|path| path.is_file());
    if let Some(key) = dedicated_key.as_ref() {
        command
            .arg("-i")
            .arg(key)
            .args(["-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes"]);
    } else if let Some(secret) = password {
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
    let remote_check = if dedicated_key.is_some() {
        "voxtype-remote-mic-status"
    } else {
        "test -x ~/.local/bin/voxtype-remote-mic-ssh-dispatch && test -f ~/.config/systemd/user/voxtype-remote-mic-rtp.service"
    };
    let result = command.arg(target).arg(remote_check).output();
    match result {
        Ok(output) if output.status.success() => Check {
            state: "ready",
            detail: "Connessione SSH e receiver verificati".into(),
            install_command: None,
        },
        Ok(output)
            if (password.is_some() || dedicated_key.is_some())
                && output.status.code() == Some(1) =>
        {
            Check {
            state: "missing",
            detail: "SSH sbloccato; receiver non ancora installato. Esegui Configura client."
                .into(),
            install_command: None,
            }
        }
        Ok(output) if dedicated_key.is_some() && output.status.code() == Some(126) => Check {
            state: "missing",
            detail: "Receiver raggiungibile ma protocollo di stato obsoleto. Riesegui Configura client per sincronizzarlo."
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

fn open_macos_terminal(command_line: &str) -> AppResult<()> {
    let escaped = command_line.replace('\\', "\\\\").replace('"', "\\\"");
    let script =
        format!("tell application \"Terminal\"\nactivate\ndo script \"{escaped}\"\nend tell");
    Command::new("osascript")
        .args(["-e", &script])
        .spawn()
        .map_err(|error| format!("Impossibile aprire Terminale: {error}"))?;
    Ok(())
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
fn launch_moonlight() -> AppResult<String> {
    if cfg!(target_os = "linux") && flatpak_running("com.moonlight_stream.Moonlight") {
        return Ok("Moonlight e gia aperto; non avvio una seconda istanza".into());
    }
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
    Ok("Moonlight avviato".into())
}

#[tauri::command]
fn list_displays(window: WebviewWindow) -> AppResult<Vec<DisplayInfo>> {
    let monitors = window
        .available_monitors()
        .map_err(|error| format!("Impossibile rilevare gli schermi: {error}"))?;
    Ok(monitors
        .into_iter()
        .enumerate()
        .map(|(index, monitor)| DisplayInfo {
            index,
            name: monitor
                .name()
                .cloned()
                .unwrap_or_else(|| format!("Schermo {}", index + 1)),
            width: monitor.size().width,
            height: monitor.size().height,
            scale_factor: monitor.scale_factor(),
        })
        .collect())
}

#[tauri::command]
fn configure_moonlight_gaming(
    window: WebviewWindow,
    display_index: usize,
    quality_mode: String,
) -> AppResult<String> {
    let monitors = window
        .available_monitors()
        .map_err(|error| format!("Impossibile rilevare gli schermi: {error}"))?;
    let monitor = monitors.get(display_index).ok_or_else(|| {
        "Lo schermo selezionato non e piu disponibile: aggiorna l'elenco".to_string()
    })?;
    let (width, height, profile) = match quality_mode.as_str() {
        "performance" => (1920, 1080, "Prestazioni 1080p"),
        "native" => (
            monitor.size().width.min(3840),
            monitor.size().height.min(2160),
            "Qualita nativa",
        ),
        _ => return Err("Profilo gaming non valido".into()),
    };
    if width < 640 || height < 480 {
        return Err(format!("Risoluzione schermo non valida: {width}x{height}"));
    }
    let bitrate = moonlight_default_bitrate_kbps(width, height, 60);
    stop_moonlight()?;
    write_moonlight_settings(&moonlight_gaming_settings(width, height))?;
    launch_moonlight()?;
    Ok(format!(
        "Moonlight: {profile}, {width}x{height}@60 e {:.0} Mbps automatici; modalita schermo intero, V-Sync e frame pacing attivi, HDR e YUV 4:4:4 disattivati",
        f64::from(bitrate) / 1000.0
    ))
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
    } else if cfg!(target_os = "macos") {
        open_macos_terminal(&install)?;
    } else {
        return Err(format!(
            "Piattaforma non supportata. Esegui manualmente: {install}"
        ));
    }
    Ok(format!("Installer di {} aperto nel terminale", entry.name))
}

#[tauri::command]
async fn run_setup_in_terminal(
    app: AppHandle,
    ssh_password: Option<String>,
    setup_scope: Option<String>,
) -> AppResult<String> {
    let path = config_path(&app)?;
    let config = detect_config(parse_config(&path));
    validate_config(&config)?;
    let password = effective_password(&app, ssh_password)?;
    let setup_scope = setup_scope.unwrap_or_else(|| "client".into());
    if !matches!(setup_scope.as_str(), "client" | "guest") {
        return Err("Ambito setup non valido".into());
    }
    let configure_askpass = |command: &mut Command| -> AppResult<()> {
        if let Some(secret) = password.as_deref() {
            prepare_askpass(command, secret)?;
            command
                .env("OMARCHY_SUDO_PASSWORD", secret)
                .env("OMARCHY_LOCAL_SUDO_PASSWORD", secret);
        }
        Ok(())
    };
    if cfg!(target_os = "windows") {
        if setup_scope == "guest" {
            return Err("La sincronizzazione remota Omarchy e disponibile dalla GUI Fedora".into());
        }
        let script = asset(&app, "clients/omarchy-client-setup.ps1")?;
        let instruction = format!(
            "$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User'); try {{ & {} -ConfigPath {} -Module All -InstallKey }} finally {{ Remove-Item Env:OMARCHY_SSH_PASSWORD,Env:OMARCHY_SUDO_PASSWORD,Env:OMARCHY_ASKPASS_MODE -ErrorAction SilentlyContinue }}",
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
        if password.is_none() {
            return Err("Inserisci una volta la password temporanea SSH + sudo: il setup Fedora viene eseguito direttamente e non apre altri prompt".into());
        }
        let script = asset(&app, "clients/omarchy-client-setup-fedora.sh")?;
        let module = if setup_scope == "guest" {
            "guest"
        } else {
            "onboard"
        };
        let mut command = Command::new("bash");
        command
            .arg(script)
            .arg("--config")
            .arg(path)
            .arg("--module")
            .arg(module);
        configure_askpass(&mut command)?;
        let output = tauri::async_runtime::spawn_blocking(move || command.output())
            .await
            .map_err(|error| format!("Esecuzione setup Fedora interrotta: {error}"))?
            .map_err(|error| format!("Impossibile avviare il setup Fedora: {error}"))?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        if !output.status.success() {
            let detail = format!("{stdout}\n{stderr}");
            let detail = detail.trim();
            return Err(if detail.is_empty() {
                format!("Setup {setup_scope} fallito con stato {}", output.status)
            } else {
                format!("Setup {setup_scope} fallito:\n{detail}")
            });
        }
        Ok(format!(
            "Setup {setup_scope} completato con una sola credenziale temporanea; password non salvata"
        ))
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
            list_displays,
            configure_moonlight_gaming,
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

    #[test]
    fn ready_dependencies_never_offer_an_install_action() {
        for dependency in dependencies() {
            if dependency.state == "ready" {
                assert!(
                    dependency.install_command.is_none(),
                    "{} is ready but still offers an installer",
                    dependency.name
                );
            }
        }
    }

    #[test]
    fn moonlight_profile_uses_upstream_default_bitrates() {
        assert_eq!(moonlight_default_bitrate_kbps(1920, 1080, 60), 20_000);
        assert_eq!(moonlight_default_bitrate_kbps(3840, 2160, 60), 80_000);
    }

    #[test]
    fn moonlight_ini_update_preserves_hosts_and_replaces_general_values() {
        let settings = BTreeMap::from([
            ("width", MoonlightSetting::Integer(3840)),
            ("vsync", MoonlightSetting::Boolean(true)),
        ]);
        let updated = update_ini_general(
            "[General]\nwidth=1280\n\n[hosts]\n1\\hostname=omarchy\n",
            &settings,
        );
        assert!(updated.contains("width=3840\n"));
        assert!(updated.contains("vsync=true\n"));
        assert!(updated.contains("[hosts]\n1\\hostname=omarchy\n"));
    }
}
