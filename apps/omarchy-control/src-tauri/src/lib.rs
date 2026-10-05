use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap},
    env, fs,
    net::{IpAddr, SocketAddr, ToSocketAddrs, UdpSocket},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Mutex, OnceLock},
    thread,
    time::Duration,
};
use tauri::{AppHandle, Manager, WebviewWindow};

pub mod broker;
pub mod updater;
pub mod auth;
pub mod db;

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

fn default_allowed_users() -> Vec<String> {
    vec!["admin".into(), "owner".into()]
}

fn default_api_port() -> u16 {
    47995
}

fn default_streaming_port() -> u16 {
    47989
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct NodeEntry {
    pub id: String,
    pub name: String,
    pub host: String,
    pub user: String,
    pub is_active: bool,
    #[serde(default)]
    pub connection_state: Option<String>,
    #[serde(default = "default_allowed_users")]
    pub allowed_users: Vec<String>,
    #[serde(default = "default_api_port")]
    pub api_port: u16,
    #[serde(default)]
    pub api_token: Option<String>,
    #[serde(default = "default_streaming_port")]
    pub streaming_port: u16,
    #[serde(default)]
    pub ddns_domain: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct PortSuggestion {
    pub port: u16,
    pub is_conflict: bool,
    pub conflicting_node: Option<String>,
    pub reason: String,
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
    let raw_user = values.get("OMARCHY_USER").cloned().unwrap_or_default();
    let user = if raw_user.is_empty() || raw_user == "dariusbogdan" {
        "daubog44".into()
    } else {
        raw_user
    };
    SetupConfig {
        vm_host: values.get("OMARCHY_VM_HOST").cloned().unwrap_or_default(),
        vm_address: values
            .get("OMARCHY_VM_ADDRESS")
            .cloned()
            .unwrap_or_default(),
        user,
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

#[allow(dead_code)]
fn current_user() -> String {
    env_value("OMARCHY_USER")
        .or_else(|| env_value("USER"))
        .or_else(|| env_value("USERNAME"))
        .unwrap_or_default()
}

fn resolve_address(host: &str) -> Option<IpAddr> {
    let clean = host.trim();
    if clean.is_empty() {
        return None;
    }
    if let Ok(mut addrs) = (clean, 0).to_socket_addrs() {
        if let Some(addr) = addrs.find(|a| a.is_ipv4() && !a.ip().is_loopback()) {
            return Some(addr.ip());
        }
    }
    if let Ok(mut addrs) = (clean, 22).to_socket_addrs() {
        if let Some(addr) = addrs.find(|a| a.is_ipv4() && !a.ip().is_loopback()) {
            return Some(addr.ip());
        }
    }
    None
}

pub fn parse_or_resolve_ip(host: &str) -> Option<IpAddr> {
    let clean = host.trim();
    if clean.is_empty() {
        return None;
    }
    if let Ok(ip) = clean.parse::<IpAddr>() {
        return Some(ip);
    }
    resolve_address(clean)
}

pub fn are_ips_in_same_subnet(ip_a: &IpAddr, ip_b: &IpAddr) -> bool {
    match (ip_a, ip_b) {
        (IpAddr::V4(a), IpAddr::V4(b)) => {
            let o_a = a.octets();
            let o_b = b.octets();
            if o_a == o_b {
                return true;
            }
            // 192.168.x.y (Standard class C /24)
            if o_a[0] == 192 && o_a[1] == 168 && o_b[0] == 192 && o_b[1] == 168 {
                return o_a[2] == o_b[2];
            }
            // 10.x.y.z (Class A: check /16 or /24)
            if o_a[0] == 10 && o_b[0] == 10 {
                return o_a[1] == o_b[1];
            }
            // 172.16-31.x.y (Class B: check /16)
            if o_a[0] == 172 && o_b[0] == 172 && (16..=31).contains(&o_a[1]) && (16..=31).contains(&o_b[1]) {
                return o_a[1] == o_b[1];
            }
            false
        }
        (IpAddr::V6(a), IpAddr::V6(b)) => a == b,
        _ => false,
    }
}

pub fn are_nodes_on_same_lan(
    node_a_host: &str,
    node_a_ddns: Option<&str>,
    node_b_host: &str,
    node_b_ddns: Option<&str>,
) -> (bool, String) {
    let host_a = node_a_host.trim();
    let host_b = node_b_host.trim();

    if host_a.is_empty() || host_b.is_empty() {
        return (false, "Host non specificato".into());
    }

    // 1. Stesso hostname o IP identico
    if host_a.eq_ignore_ascii_case(host_b) {
        return (true, "Stesso indirizzo IP / host".into());
    }

    // 2. Controllo domini DuckDNS: se differenti, sono sedi o router distinti
    let ddns_a = node_a_ddns.map(|s| s.trim().to_lowercase()).filter(|s| !s.is_empty());
    let ddns_b = node_b_ddns.map(|s| s.trim().to_lowercase()).filter(|s| !s.is_empty());
    if let (Some(ref a), Some(ref b)) = (&ddns_a, &ddns_b) {
        if a != b {
            return (false, "Domini DuckDNS differenti (sedi o connessioni internet distinte)".into());
        } else {
            return (true, format!("Stesso dominio DuckDNS ({a})"));
        }
    }

    // 3. Sottorete IPv4 locale (es. 192.168.0.28 vs 192.168.0.29)
    let ip_a = parse_or_resolve_ip(host_a);
    let ip_b = parse_or_resolve_ip(host_b);
    if let (Some(ref a), Some(ref b)) = (&ip_a, &ip_b) {
        if are_ips_in_same_subnet(a, b) {
            return (true, "Stessa sottorete LAN locale (stesso router/modem)".into());
        }
    }

    // 4. Se entrambi i nodi sono su IP privati senza DDNS dedicato esplicito,
    // condividono la stessa rete locale
    if ddns_a.is_none() && ddns_b.is_none() {
        if let (Some(ref a), Some(ref b)) = (&ip_a, &ip_b) {
            if let (IpAddr::V4(v4_a), IpAddr::V4(v4_b)) = (a, b) {
                if v4_a.is_private() && v4_b.is_private() && are_ips_in_same_subnet(a, b) {
                    return (true, "Stessa rete privata LAN locale".into());
                }
            }
        }
    }

    (false, "Nodi su reti o domini indipendenti".into())
}

pub fn calculate_suggested_port(
    existing_nodes: &[NodeEntry],
    target_host: &str,
    target_ddns: Option<&str>,
    exclude_node_id: Option<&str>,
) -> PortSuggestion {
    let clean_host = target_host.trim();
    if clean_host.is_empty() {
        return PortSuggestion {
            port: 47989,
            is_conflict: false,
            conflicting_node: None,
            reason: "Inserisci l'indirizzo host del server".into(),
        };
    }

    let mut used_ports = std::collections::HashSet::new();
    let mut conflicting_node = None;
    let mut conflict_reason = String::new();

    for node in existing_nodes {
        if let Some(ex_id) = exclude_node_id {
            if node.id == ex_id {
                continue;
            }
        }
        let (same_lan, reason) = are_nodes_on_same_lan(&node.host, node.ddns_domain.as_deref(), clean_host, target_ddns);
        if same_lan {
            used_ports.insert(node.streaming_port);
            if conflicting_node.is_none() || node.streaming_port == 47989 {
                conflicting_node = Some(format!("{} ({})", node.name, node.host));
                conflict_reason = reason;
            }
        }
    }

    let mut candidate = 47989;
    let mut has_conflict = false;
    while used_ports.contains(&candidate) {
        has_conflict = true;
        candidate += 1000;
    }

    if has_conflict {
        PortSuggestion {
            port: candidate,
            is_conflict: true,
            conflicting_node,
            reason: format!(
                "Rilevato nodo esistente sulla stessa LAN ({conflict_reason}). Assegnata automaticamente la porta libera {candidate}."
            ),
        }
    } else {
        PortSuggestion {
            port: 47989,
            is_conflict: false,
            conflicting_node: None,
            reason: "Nessun conflitto rilevato sulla rete locale. Porta standard 47989 disponibile.".into(),
        }
    }
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
    if config.user.is_empty() || config.user == "dariusbogdan" {
        config.user = "daubog44".into();
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

fn moonlight_gaming_settings(
    width: u32,
    height: u32,
    fps: u32,
) -> BTreeMap<&'static str, MoonlightSetting> {
    let window_mode = 0; // 0 = Fullscreen (occupa l'intero schermo Retina edge-to-edge senza barre nere)
    BTreeMap::from([
        ("audiocfg", MoonlightSetting::Integer(0)),
        ("autoadjustbitrate", MoonlightSetting::Boolean(true)),
        (
            "bitrate",
            MoonlightSetting::Integer(moonlight_default_bitrate_kbps(width, height, fps)),
        ),
        ("capturesyskeys", MoonlightSetting::Integer(1)),
        ("fps", MoonlightSetting::Integer(fps)),
        ("framepacing", MoonlightSetting::Boolean(true)),
        ("gameopts", MoonlightSetting::Boolean(true)),
        ("hdr", MoonlightSetting::Boolean(false)),
        ("height", MoonlightSetting::Integer(height)),
        ("hostaudio", MoonlightSetting::Boolean(false)),
        ("keepawake", MoonlightSetting::Boolean(true)),
        ("mdns", MoonlightSetting::Boolean(true)),
        ("multicontroller", MoonlightSetting::Boolean(true)),
        ("packetsize", MoonlightSetting::Integer(1024)),
        ("showperfoverlay", MoonlightSetting::Boolean(false)),
        ("unlockbitrate", MoonlightSetting::Boolean(false)),
        ("videocfg", MoonlightSetting::Integer(2)), // 2 = Force HEVC (H.265)
        ("videodec", MoonlightSetting::Integer(0)), // 0 = Hardware Auto
        ("vsync", MoonlightSetting::Boolean(true)),
        ("width", MoonlightSetting::Integer(width)),
        ("windowmode", MoonlightSetting::Integer(window_mode)),
        ("yuv444", MoonlightSetting::Boolean(false)),
    ])
}

fn moonlight_gaming_profile(
    quality_mode: &str,
    monitor_width: u32,
    monitor_height: u32,
) -> AppResult<(u32, u32, u32, &'static str)> {
    match quality_mode {
        "performance" => Ok((1920, 1080, 60, "Full HD 60 FPS (H.265 HEVC)")),
        "quality30" => Ok((3840, 2160, 30, "4K 30 FPS (H.265 HEVC)")),
        "native" => Ok((
            monitor_width.min(3840),
            monitor_height.min(2160),
            60,
            "Qualita nativa 60 FPS (H.265 HEVC)",
        )),
        _ => Err("Profilo gaming non valido".into()),
    }
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
    } else if cfg!(target_os = "macos") {
        if Command::new("pgrep")
            .args(["-x", "Moonlight"])
            .status()
            .is_ok_and(|status| status.success())
        {
            let _ = Command::new("osascript")
                .args(["-e", "tell application \"Moonlight\" to quit"])
                .status();
            for _ in 0..10 {
                thread::sleep(Duration::from_millis(100));
                let running = Command::new("pgrep")
                    .args(["-x", "Moonlight"])
                    .status()
                    .is_ok_and(|status| status.success());
                if !running {
                    break;
                }
            }
            // If still running, terminate with pkill
            if Command::new("pgrep")
                .args(["-x", "Moonlight"])
                .status()
                .is_ok_and(|status| status.success())
            {
                let _ = Command::new("pkill").args(["-x", "Moonlight"]).status();
                thread::sleep(Duration::from_millis(150));
            }
        }
    }
    thread::sleep(Duration::from_millis(100));
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
    if let Ok(db_path) = nodes_db_path(app) {
        if let Ok(cfg_path) = config_path(app) {
            let config = detect_config(parse_config(&cfg_path));
            let nodes = db::load_nodes(&db_path, &config.vm_host, &config.user);
            if let Some(active_node) = nodes.iter().find(|n| n.is_active || n.host == config.vm_host) {
                if let Some(secret) = db::get_node_password(&db_path, &active_node.id) {
                    if !secret.is_empty() {
                        return Ok(Some(secret));
                    }
                }
            }
        }
    }
    Ok(secret_from_config(&config_path(app)?))
}

fn sync_active_node_env(app: &AppHandle) {
    if let Ok(cfg_path) = config_path(app) {
        let config = detect_config(parse_config(&cfg_path));
        if let Ok(db_path) = nodes_db_path(app) {
            let nodes = db::load_nodes(&db_path, &config.vm_host, &config.user);
            if let Some(active_node) = nodes.iter().find(|n| n.is_active || n.host == config.vm_host) {
                let port = if active_node.api_port == 0 { 47995 } else { active_node.api_port };
                std::env::set_var("OMARCHY_API_PORT", port.to_string());
                if let Some(ref tok) = active_node.api_token {
                    if !tok.trim().is_empty() {
                        std::env::set_var("OMARCHY_API_TOKEN", tok.trim());
                    }
                }
                if let Some(secret) = db::get_node_password(&db_path, &active_node.id) {
                    if !secret.trim().is_empty() {
                        std::env::set_var("OMARCHY_SSH_PASSWORD", &secret);
                    }
                }
            }
        }
    }
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
    } else if cfg!(target_os = "macos") {
        env::var_os("HOME").map(PathBuf::from).and_then(|home| {
            let voxtype = home.join(".ssh").join("voxtype-omarchy_ed25519");
            if voxtype.is_file() {
                Some(voxtype)
            } else {
                let id_ed = home.join(".ssh").join("id_ed25519");
                if id_ed.is_file() {
                    Some(id_ed)
                } else {
                    None
                }
            }
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

#[tauri::command(async)]
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
    let pwd = effective_password(&app, None).unwrap_or(None);
    let setup = if cfg!(target_os = "macos") {
        Check {
            state: "ready",
            detail: "Moonlight pronto con audio nativo macOS (CoreAudio)".into(),
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
            guest_receiver: receiver_check(&config, pwd.as_deref()),
            setup,
        },
        dependencies: dependency_list,
        ssh_password_source: configured_password_source(&path),
        config,
    })
}

#[tauri::command(async)]
fn discover_config(config: SetupConfig) -> SetupConfig {
    detect_config(config)
}

#[tauri::command(async)]
fn check_receiver(
    app: AppHandle,
    config: SetupConfig,
    ssh_password: Option<String>,
) -> AppResult<Check> {
    let config = detect_config(config);
    let password = effective_password(&app, ssh_password)?;
    Ok(receiver_check(&config, password.as_deref()))
}

#[tauri::command(async)]
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

#[tauri::command(async)]
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

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct StreamPortTestResult {
    pub host: String,
    pub port: u16,
    pub reachable: bool,
    pub latency_ms: u64,
    pub message: String,
}

#[tauri::command(async)]
fn test_stream_port(host: String, port: u16) -> AppResult<StreamPortTestResult> {
    let clean_host = host.trim();
    if clean_host.is_empty() {
        return Err("Host non specificato o vuoto".into());
    }

    let start = std::time::Instant::now();
    let addr_str = format!("{clean_host}:{port}");

    let addrs: Vec<SocketAddr> = match addr_str.to_socket_addrs() {
        Ok(iter) => iter.collect(),
        Err(e) => {
            return Ok(StreamPortTestResult {
                host: clean_host.into(),
                port,
                reachable: false,
                latency_ms: 0,
                message: format!("Impossibile risolvere l'indirizzo DNS '{clean_host}': {e}"),
            });
        }
    };

    if addrs.is_empty() {
        return Ok(StreamPortTestResult {
            host: clean_host.into(),
            port,
            reachable: false,
            latency_ms: 0,
            message: format!("Nessun record IP trovato per '{clean_host}'"),
        });
    }

    let timeout = std::time::Duration::from_millis(3500);
    let mut connected = false;
    let mut last_err = String::new();

    for addr in addrs {
        match std::net::TcpStream::connect_timeout(&addr, timeout) {
            Ok(stream) => {
                connected = true;
                let _ = stream.shutdown(std::net::Shutdown::Both);
                break;
            }
            Err(e) => {
                last_err = e.to_string();
            }
        }
    }

    let elapsed = start.elapsed().as_millis() as u64;

    if connected {
        Ok(StreamPortTestResult {
            host: clean_host.into(),
            port,
            reachable: true,
            latency_ms: elapsed,
            message: format!("Porta {port} aperta e raggiungibile (Latenza: {elapsed}ms)"),
        })
    } else {
        Ok(StreamPortTestResult {
            host: clean_host.into(),
            port,
            reachable: false,
            latency_ms: elapsed,
            message: format!("Porta {port} non risponde ({last_err}). Verifica il port forwarding del router."),
        })
    }
}

#[tauri::command(async)]
fn open_moonlight_url(url: String) -> AppResult<String> {
    let clean_url = url.trim();
    if !clean_url.starts_with("moonlight://") {
        return Err("URL non valido: deve iniziare con 'moonlight://'".into());
    }

    #[cfg(target_os = "macos")]
    {
        // On macOS, Moonlight-Qt is a desktop app that does not register 'moonlight://' with LaunchServices by default.
        // We reliably launch or focus Moonlight.app so the user sees the host list directly.
        let mut launched = false;

        // 1. Try launching by bundle / application name
        if let Ok(output) = Command::new("open").args(["-a", "Moonlight"]).output() {
            if output.status.success() {
                launched = true;
            }
        }

        // 2. Try explicit path /Applications/Moonlight.app
        if !launched {
            if let Ok(output) = Command::new("open").args(["-a", "/Applications/Moonlight.app"]).output() {
                if output.status.success() {
                    launched = true;
                }
            }
        }

        // 3. Fallback to raw URL
        if !launched {
            if let Ok(output) = Command::new("open").arg(clean_url).output() {
                if output.status.success() {
                    launched = true;
                }
            }
        }

        if !launched {
            return Err("Moonlight non trovato sul Mac. Assicurati che Moonlight sia installato nella cartella Applicazioni (/Applications/Moonlight.app)".into());
        }
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start", "", clean_url])
            .spawn()
            .map_err(|e| format!("Impossibile aprire Moonlight: {e}"))?;
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(clean_url)
            .spawn()
            .map_err(|e| format!("Impossibile aprire Moonlight: {e}"))?;
    }

    Ok("Moonlight avviato con successo sul tuo Mac!".into())
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
    let (width, height, fps, profile) =
        moonlight_gaming_profile(&quality_mode, monitor.size().width, monitor.size().height)?;
    if width < 640 || height < 480 {
        return Err(format!("Risoluzione schermo non valida: {width}x{height}"));
    }
    let bitrate = moonlight_default_bitrate_kbps(width, height, fps);
    let _ = stop_moonlight();
    write_moonlight_settings(&moonlight_gaming_settings(width, height, fps))?;
    launch_moonlight()?;
    Ok(format!(
        "Moonlight: {profile}, {width}x{height}@{fps} e {:.0} Mbps configurati con successo!",
        f64::from(bitrate) / 1000.0
    ))
}

#[tauri::command(async)]
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

#[tauri::command(async)]
fn get_multi_user_dashboard(
    app: AppHandle,
    use_fallback: Option<bool>,
) -> AppResult<broker::MultiUserOverview> {
    sync_active_node_env(&app);
    let path = config_path(&app)?;
    let config = detect_config(parse_config(&path));
    if let Ok(Some(pwd)) = effective_password(&app, None) {
        std::env::set_var("OMARCHY_SSH_PASSWORD", &pwd);
    }
    let overview = broker::get_status(&config.vm_host, &config.user, use_fallback.unwrap_or(true))
        .map_err(|e| e)?;
    if let Ok(config_dir) = app.path().app_config_dir() {
        auth::cache_users(&config_dir, &overview.users);
    }
    Ok(overview)
}

#[tauri::command(async)]
fn add_multi_user(
    app: AppHandle,
    token: Option<String>,
    username: String,
    display_name: String,
    pin: String,
    role: Option<String>,
    apps: Option<Vec<String>>,
    max_bitrate_mbps: Option<u32>,
    allowed_nodes: Option<Vec<String>>,
    auto_record: Option<bool>,
    storage_limit_gb: Option<f64>,
) -> AppResult<String> {
    if !auth::is_admin_session(token.as_deref().unwrap_or("")) {
        return Err("Operazione non autorizzata: solo l'amministratore può creare utenti.".into());
    }
    let path = config_path(&app)?;
    let config = detect_config(parse_config(&path));
    broker::create_user(
        &config.vm_host,
        &config.user,
        &username,
        &display_name,
        &pin,
        &role.unwrap_or_else(|| "guest".into()),
        &apps.unwrap_or_default(),
        max_bitrate_mbps.unwrap_or(20),
        &allowed_nodes.unwrap_or_default(),
        auto_record.unwrap_or(false),
        storage_limit_gb.unwrap_or(0.0),
    )
}

#[tauri::command(async)]
fn pair_moonlight_device(
    app: AppHandle,
    token: Option<String>,
    pin: String,
    name: Option<String>,
    target: Option<String>,
    username: Option<String>,
    client_ip: Option<String>,
) -> AppResult<String> {
    if !auth::is_admin_session(token.as_deref().unwrap_or("")) {
        return Err("Operazione non autorizzata: solo l'amministratore può accoppiare dispositivi.".into());
    }
    let path = config_path(&app)?;
    let config = detect_config(parse_config(&path));
    let res = broker::pair_moonlight_device(
        &config.vm_host,
        &config.user,
        &pin,
        name.as_deref(),
        target.as_deref(),
        username.as_deref(),
        client_ip.as_deref(),
    )?;
    Ok(res)
}

#[tauri::command(async)]
fn list_recordings(app: AppHandle, username: Option<String>) -> AppResult<serde_json::Value> {
    let path = config_path(&app)?;
    let config = detect_config(parse_config(&path));
    broker::list_recordings(&config.vm_host, username.as_deref())
}

#[tauri::command(async)]
fn delete_recording(app: AppHandle, token: Option<String>, id: String) -> AppResult<String> {
    if !auth::is_admin_session(token.as_deref().unwrap_or("")) {
        return Err("Operazione non autorizzata: solo l'amministratore può eliminare registrazioni.".into());
    }
    let path = config_path(&app)?;
    let config = detect_config(parse_config(&path));
    broker::delete_recording(&config.vm_host, &id)
}

fn download_cancels() -> &'static Mutex<HashMap<String, Arc<std::sync::atomic::AtomicBool>>> {
    static CANCELS: OnceLock<Mutex<HashMap<String, Arc<std::sync::atomic::AtomicBool>>>> = OnceLock::new();
    CANCELS.get_or_init(Default::default)
}

/// Free file name in `dir` ("file.mp4", "file (1).mp4", ...), never overwriting.
fn unique_download_path(dir: &Path, file_name: &str) -> PathBuf {
    let clean: String = file_name
        .chars()
        .map(|c| if c.is_alphanumeric() || matches!(c, '-' | '_' | '.' | ' ') { c } else { '_' })
        .collect();
    let clean = clean.trim_matches('.').trim();
    let clean = if clean.is_empty() { "registrazione.mp4" } else { clean };
    let (stem, ext) = match clean.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => (stem.to_string(), format!(".{ext}")),
        _ => (clean.to_string(), String::new()),
    };
    let mut candidate = dir.join(format!("{stem}{ext}"));
    let mut n = 1;
    while candidate.exists() || candidate.with_extension("mp4.part").exists() {
        candidate = dir.join(format!("{stem} ({n}){ext}"));
        n += 1;
    }
    candidate
}

/// Downloads a recording into the user's Downloads folder, reporting
/// `{received, total}` progress on `on_progress`. Returns the saved path.
#[tauri::command(async)]
fn download_recording(
    app: AppHandle,
    id: String,
    file_name: String,
    username: Option<String>,
    on_progress: tauri::ipc::Channel<serde_json::Value>,
) -> AppResult<String> {
    use std::sync::atomic::AtomicBool;
    let path = config_path(&app)?;
    let config = detect_config(parse_config(&path));
    let dir = app
        .path()
        .download_dir()
        .map_err(|e| format!("Cartella Download non disponibile: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("Impossibile creare {}: {e}", dir.display()))?;
    // Prefix with the owner so recordings of different users do not collide.
    let name = match username.as_deref().filter(|u| !u.trim().is_empty()) {
        Some(user) => format!("{}_{}", user.trim(), file_name),
        None => file_name,
    };
    let dest = unique_download_path(&dir, &name);
    let cancel = Arc::new(AtomicBool::new(false));
    download_cancels()
        .lock()
        .map_err(|_| "Stato download non disponibile".to_string())?
        .insert(id.clone(), cancel.clone());
    let result = broker::download_recording(&config.vm_host, &id, &dest, &cancel, |received, total| {
        on_progress
            .send(serde_json::json!({ "received": received, "total": total }))
            .is_ok()
    });
    if let Ok(mut map) = download_cancels().lock() {
        map.remove(&id);
    }
    result.map(|_| dest.to_string_lossy().into_owned())
}

#[tauri::command(async)]
fn cancel_recording_download(id: String) -> AppResult<()> {
    if let Some(flag) = download_cancels().lock().ok().and_then(|map| map.get(&id).cloned()) {
        flag.store(true, std::sync::atomic::Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command(async)]
fn session_control(app: AppHandle, token: String, session_id: String, body: serde_json::Value) -> AppResult<serde_json::Value> {
    if !auth::is_admin_session(&token) { return Err("Controllo riservato all'amministratore".into()); }
    sync_active_node_env(&app);
    let config = detect_config(parse_config(&config_path(&app)?));
    broker::json_request(&config.vm_host, &format!("/api/sessions/{}/control", broker::urlencode(&session_id)), body, 15)
}

#[tauri::command(async)]
fn user_storage(app: AppHandle, token: String, username: String, body: serde_json::Value) -> AppResult<serde_json::Value> {
    if !auth::is_admin_session(&token) { return Err("Storage riservato all'amministratore".into()); }
    sync_active_node_env(&app);
    let config = detect_config(parse_config(&config_path(&app)?));
    broker::json_request(&config.vm_host, &format!("/api/users/{}/storage", broker::urlencode(&username)), body, 300)
}

#[tauri::command(async)]
fn download_user_file(app: AppHandle, token: String, username: String, relative: String,
                      on_progress: tauri::ipc::Channel<serde_json::Value>) -> AppResult<String> {
    if !auth::is_admin_session(&token) { return Err("Storage riservato all'amministratore".into()); }
    sync_active_node_env(&app);
    let config = detect_config(parse_config(&config_path(&app)?));
    let dir = app.path().download_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let name = Path::new(&relative).file_name().and_then(|n| n.to_str()).ok_or("Nome file non valido")?;
    let dest = unique_download_path(&dir, &format!("{username}_{name}"));
    let id = format!("storage:{username}:{relative}");
    let cancel = Arc::new(std::sync::atomic::AtomicBool::new(false));
    download_cancels().lock().map_err(|e| e.to_string())?.insert(id.clone(), cancel.clone());
    let endpoint = format!("/api/users/{}/storage/file?path={}", broker::urlencode(&username), broker::urlencode(&relative));
    let result = broker::download_file(&config.vm_host, &endpoint, &dest, &cancel, |received, total| {
        on_progress.send(serde_json::json!({"received":received,"total":total})).is_ok()
    });
    if let Ok(mut map) = download_cancels().lock() { map.remove(&id); }
    result.map(|_| dest.to_string_lossy().into_owned())
}

/// Shows a downloaded file in Finder / Explorer / the file manager.
#[tauri::command(async)]
fn reveal_in_file_manager(app: AppHandle, path: String) -> AppResult<()> {
    let downloads = app.path().download_dir().map_err(|e| e.to_string())?;
    let target = PathBuf::from(&path);
    // Only reveal what we saved: files inside the Downloads folder.
    if !target.starts_with(&downloads) || !target.exists() {
        return Err("File non trovato nella cartella Download".into());
    }
    #[cfg(target_os = "macos")]
    let status = Command::new("open").arg("-R").arg(&target).status();
    #[cfg(target_os = "windows")]
    let status = Command::new("explorer").arg(format!("/select,{}", target.display())).status();
    #[cfg(all(unix, not(target_os = "macos")))]
    let status = Command::new("xdg-open").arg(target.parent().unwrap_or(&downloads)).status();
    status.map(|_| ()).map_err(|e| format!("Impossibile aprire il file manager: {e}"))
}

/// `omarchy-rec://localhost/<recording id>`: proxies the media player's Range
/// requests to the broker (token in the header, never in a URL) in bounded
/// 4 MB slices so the <video> element can seek through large recordings.
fn serve_recording(
    ctx: tauri::UriSchemeContext<'_, tauri::Wry>,
    request: tauri::http::Request<Vec<u8>>,
    responder: tauri::UriSchemeResponder,
) {
    const SLICE: u64 = 4 * 1024 * 1024;
    let app = ctx.app_handle().clone();
    let id = percent_decode(request.uri().path().trim_start_matches('/'));
    let range = request
        .headers()
        .get("range")
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    std::thread::spawn(move || {
        let reply = config_path(&app)
            .map(|path| detect_config(parse_config(&path)))
            .and_then(|config| broker::fetch_recording_range(&config.vm_host, &id, range.as_deref(), SLICE));
        let response = match reply {
            Ok(r) => {
                let mut builder = tauri::http::Response::builder()
                    .status(r.status)
                    .header("Content-Type", r.content_type)
                    .header("Content-Length", r.body.len().to_string())
                    .header("Accept-Ranges", "bytes");
                if let Some(content_range) = r.content_range {
                    builder = builder.header("Content-Range", content_range);
                }
                builder.body(r.body)
            }
            Err(err) => tauri::http::Response::builder()
                .status(502)
                .header("Content-Type", "text/plain; charset=utf-8")
                .body(err.into_bytes()),
        };
        match response {
            Ok(resp) => responder.respond(resp),
            Err(err) => responder.respond(
                tauri::http::Response::builder()
                    .status(500)
                    .body(err.to_string().into_bytes())
                    .unwrap_or_default(),
            ),
        }
    });
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&value[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[tauri::command(async)]
fn edit_multi_user(
    app: AppHandle,
    token: Option<String>,
    username: String,
    new_username: Option<String>,
    display_name: Option<String>,
    pin: Option<String>,
    role: Option<String>,
    apps: Option<Vec<String>>,
    max_bitrate_mbps: Option<u32>,
    allowed_nodes: Option<Vec<String>>,
    auto_record: Option<bool>,
    storage_limit_gb: Option<f64>,
) -> AppResult<String> {
    if !auth::is_admin_session(token.as_deref().unwrap_or("")) {
        return Err("Operazione non autorizzata: solo l'amministratore può modificare gli utenti.".into());
    }
    let path = config_path(&app)?;
    let config = detect_config(parse_config(&path));
    broker::edit_user(
        &config.vm_host,
        &config.user,
        &username,
        new_username.as_deref(),
        display_name.as_deref(),
        pin.as_deref(),
        role.as_deref(),
        apps.as_deref(),
        max_bitrate_mbps,
        allowed_nodes.as_deref(),
        auto_record,
        storage_limit_gb,
    )
}

#[tauri::command(async)]
fn remove_multi_user(
    app: AppHandle,
    token: Option<String>,
    username: String,
    archive: Option<bool>,
) -> AppResult<String> {
    if !auth::is_admin_session(token.as_deref().unwrap_or("")) {
        return Err("Operazione non autorizzata: solo l'amministratore può eliminare utenti.".into());
    }
    let path = config_path(&app)?;
    let config = detect_config(parse_config(&path));
    broker::delete_user(&config.vm_host, &config.user, &username, archive.unwrap_or(false))
}

#[tauri::command(async)]
fn ban_multi_user(
    app: AppHandle,
    token: Option<String>,
    username: String,
    reason: Option<String>,
) -> AppResult<String> {
    if !auth::is_admin_session(token.as_deref().unwrap_or("")) {
        return Err("Operazione non autorizzata: solo l'amministratore può bannare utenti.".into());
    }
    sync_active_node_env(&app);
    let path = config_path(&app)?;
    let config = detect_config(parse_config(&path));
    broker::ban_user(
        &config.vm_host,
        &config.user,
        &username,
        &reason.unwrap_or_else(|| "Bannato dall'amministratore".into()),
    )
}

#[tauri::command(async)]
fn unban_multi_user(
    app: AppHandle,
    token: Option<String>,
    username: String,
) -> AppResult<String> {
    if !auth::is_admin_session(token.as_deref().unwrap_or("")) {
        return Err("Operazione non autorizzata: solo l'amministratore può riabilitare utenti.".into());
    }
    sync_active_node_env(&app);
    let path = config_path(&app)?;
    let config = detect_config(parse_config(&path));
    broker::unban_user(&config.vm_host, &config.user, &username)
}

#[tauri::command(async)]
fn kill_user_session(
    app: AppHandle,
    session_id: String,
    reason: Option<String>,
) -> AppResult<String> {
    let path = config_path(&app)?;
    let config = detect_config(parse_config(&path));
    broker::terminate_session(
        &config.vm_host,
        &config.user,
        &session_id,
        &reason.unwrap_or_else(|| "Terminata dall'amministratore".into()),
    )
}

#[tauri::command(async)]
fn takeover_user_session(
    app: AppHandle,
    window: WebviewWindow,
    token: String,
    session_id: String,
) -> AppResult<String> {
    if !auth::is_admin_session(&token) { return Err("Controllo riservato all'amministratore".into()); }
    sync_active_node_env(&app);
    let path = config_path(&app)?;
    let config = detect_config(parse_config(&path));
    let result = broker::json_request(&config.vm_host, &format!("/api/sessions/{}/moonlight", broker::urlencode(&session_id)), serde_json::json!({}), 15)?;
    if result["mode"] == "connect" {
        let monitor = window.current_monitor().map_err(|e| e.to_string())?.ok_or("Schermo non disponibile")?;
        let resolution = format!("{}x{}", monitor.size().width, monitor.size().height);
        let host = format!("{}:{}", config.vm_host, result["port"].as_u64().ok_or("Porta Wolf non disponibile")?);
        let args = ["stream", &host, result["app"].as_str().ok_or("App Wolf non disponibile")?, "--resolution", &resolution,
                    "--video-codec", "HEVC", "--display-mode", "fullscreen"];
        let mut command = if cfg!(target_os = "macos") { Command::new("/Applications/Moonlight.app/Contents/MacOS/Moonlight") }
            else if cfg!(target_os = "linux") { let mut c = Command::new("flatpak"); c.args(["run", "com.moonlight_stream.Moonlight"]); c }
            else { Command::new(windows_moonlight_path().unwrap_or_else(|| "Moonlight.exe".into())) };
        command.args(args).spawn().map_err(|e| format!("Avvio Moonlight fallito: {e}"))?;
    } else { launch_moonlight()?; }
    Ok(result["message"].as_str().unwrap_or("Moonlight avviato").into())
}

#[tauri::command(async)]
fn spectate_user_session(
    app: AppHandle,
    session_id: String,
) -> AppResult<String> {
    let path = config_path(&app)?;
    let config = detect_config(parse_config(&path));
    broker::spectate_session(&config.vm_host, &config.user, &session_id)
}

#[tauri::command(async)]
fn capture_session_frame(
    app: AppHandle,
    session_id: String,
) -> AppResult<String> {
    let path = config_path(&app)?;
    let config = detect_config(parse_config(&path));
    broker::capture_session_frame(&config.vm_host, &session_id)
}

#[tauri::command(async)]
fn get_session_stream_url(
    app: AppHandle,
    session_id: String,
) -> AppResult<String> {
    let path = config_path(&app)?;
    let config = detect_config(parse_config(&path));
    Ok(broker::get_session_stream_url(&config.vm_host, &session_id))
}

#[tauri::command(async)]
fn start_session_recording(
    app: AppHandle,
    session_id: String,
) -> AppResult<String> {
    let path = config_path(&app)?;
    let config = detect_config(parse_config(&path));
    broker::start_session_recording(&config.vm_host, &config.user, &session_id)
}

#[tauri::command(async)]
fn stop_session_recording(
    app: AppHandle,
    session_id: String,
) -> AppResult<String> {
    let path = config_path(&app)?;
    let config = detect_config(parse_config(&path));
    broker::stop_session_recording(&config.vm_host, &config.user, &session_id)
}

#[tauri::command(async)]
fn whep_offer(app: AppHandle, session_id: String, sdp: String, quality: Option<String>) -> AppResult<broker::WhepAnswer> {
    let path = config_path(&app)?;
    let config = detect_config(parse_config(&path));
    broker::whep_offer(&config.vm_host, &session_id, &sdp, quality.as_deref().unwrap_or("original"))
}

#[tauri::command(async)]
fn live_info(app: AppHandle, session_id: String, quality: Option<String>) -> AppResult<serde_json::Value> {
    let path = config_path(&app)?;
    let config = detect_config(parse_config(&path));
    broker::live_info(&config.vm_host, &session_id, quality.as_deref().unwrap_or("original"))
}

#[tauri::command(async)]
fn whep_close(app: AppHandle, session_id: String, resource: String) -> AppResult<()> {
    let path = config_path(&app)?;
    let config = detect_config(parse_config(&path));
    broker::whep_close(&config.vm_host, &session_id, &resource)
}

fn live_video_stops(
) -> &'static Mutex<HashMap<String, Arc<std::sync::atomic::AtomicBool>>> {
    static STOPS: OnceLock<Mutex<HashMap<String, Arc<std::sync::atomic::AtomicBool>>>> =
        OnceLock::new();
    STOPS.get_or_init(Default::default)
}

/// Starts pushing the session's live fMP4 video into `on_chunk`. Raw chunks
/// arrive as ArrayBuffers; a final JSON `{ "event": "end", "error": ... }`
/// message tells the viewer the feed stopped.
#[tauri::command(async)]
fn start_live_video(
    app: AppHandle,
    session_id: String,
    viewer_id: String,
    quality: Option<String>,
    on_chunk: tauri::ipc::Channel<tauri::ipc::InvokeResponseBody>,
) -> AppResult<()> {
    use std::sync::atomic::{AtomicBool, Ordering};

    let path = config_path(&app)?;
    let config = detect_config(parse_config(&path));
    let stop = Arc::new(AtomicBool::new(false));
    if let Some(previous) = live_video_stops()
        .lock()
        .map_err(|_| "Stato video live non disponibile".to_string())?
        .insert(viewer_id.clone(), stop.clone())
    {
        previous.store(true, Ordering::Relaxed);
    }

    std::thread::spawn(move || {
        let result = broker::stream_live_video(&config.vm_host, &session_id, quality.as_deref().unwrap_or("original"), &stop, |chunk| {
            on_chunk
                .send(tauri::ipc::InvokeResponseBody::Raw(chunk))
                .is_ok()
        });
        if let Ok(mut stops) = live_video_stops().lock() {
            if stops.get(&viewer_id).is_some_and(|s| Arc::ptr_eq(s, &stop)) {
                stops.remove(&viewer_id);
            }
        }
        let end = serde_json::json!({
            "event": "end",
            "error": result.err().filter(|_| !stop.load(Ordering::Relaxed)),
        });
        let _ = on_chunk.send(tauri::ipc::InvokeResponseBody::Json(end.to_string()));
    });
    Ok(())
}

#[tauri::command(async)]
fn stop_live_video(viewer_id: String) -> AppResult<()> {
    if let Ok(mut stops) = live_video_stops().lock() {
        if let Some(stop) = stops.remove(&viewer_id) {
            stop.store(true, std::sync::atomic::Ordering::Relaxed);
        }
    }
    Ok(())
}

#[tauri::command(async)]
fn stop_session_stream(
    app: AppHandle,
    session_id: String,
) -> AppResult<String> {
    let path = config_path(&app)?;
    let config = detect_config(parse_config(&path));
    broker::stop_session_stream(&config.vm_host, &config.user, &session_id)
}

#[tauri::command(async)]
fn install_multi_user_backend(app: AppHandle) -> AppResult<String> {
    let path = config_path(&app)?;
    let config = detect_config(parse_config(&path));
    broker::install_backend(&config.vm_host, &config.user)
}

#[tauri::command(async)]
fn check_for_updates() -> AppResult<updater::UpdateInfo> {
    let current_version = env!("CARGO_PKG_VERSION");
    updater::check_for_updates(current_version, None)
}

#[tauri::command(async)]
fn install_update(download_url: String) -> AppResult<updater::UpdateOutcome> {
    updater::apply_update(&download_url)
}

/// After an update: start the new version (Restart) or let the installer run (Quit).
#[tauri::command]
fn finish_update(app: AppHandle, outcome: updater::UpdateOutcome) {
    match outcome {
        updater::UpdateOutcome::Restart => app.restart(),
        updater::UpdateOutcome::Quit => app.exit(0),
    }
}

#[tauri::command(async)]
fn login(
    app: AppHandle,
    username: String,
    password: String,
) -> AppResult<auth::AuthSession> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?;
    auth::login(&config_dir, &username, &password)
}

/// True until an admin password has been chosen on this machine.
#[tauri::command(async)]
fn auth_needs_setup(app: AppHandle) -> AppResult<bool> {
    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(auth::needs_setup(&config_dir))
}

/// First-run setup: store the chosen admin password, then sign in with it.
#[tauri::command(async)]
fn auth_setup(app: AppHandle, password: String) -> AppResult<auth::AuthSession> {
    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    auth::set_initial_password(&config_dir, &password)?;
    auth::login(&config_dir, auth::DEFAULT_ADMIN_USERNAME, &password)
}

#[tauri::command(async)]
fn validate_session(token: String) -> AppResult<bool> {
    Ok(auth::validate_session(&token))
}

#[tauri::command(async)]
fn logout(token: String) -> AppResult<bool> {
    Ok(auth::logout(&token))
}

fn nodes_db_path(app: &AppHandle) -> AppResult<PathBuf> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join("nodes.db"))
}

fn load_nodes(app: &AppHandle, current_host: &str, current_user: &str) -> Vec<NodeEntry> {
    if let Ok(db_path) = nodes_db_path(app) {
        if let Ok(directory) = app.path().app_config_dir() {
            let legacy_json = directory.join("nodes.json");
            db::migrate_legacy_json(&db_path, &legacy_json);
        }
        return db::load_nodes(&db_path, current_host, current_user);
    }
    vec![]
}

fn save_nodes(app: &AppHandle, nodes: &[NodeEntry]) -> AppResult<()> {
    let db_path = nodes_db_path(app)?;
    db::save_nodes(&db_path, nodes)
}

#[tauri::command(async)]
fn list_nodes(app: AppHandle, token: Option<String>) -> AppResult<Vec<NodeEntry>> {
    let path = config_path(&app)?;
    let config = detect_config(parse_config(&path));
    let mut nodes = load_nodes(&app, &config.vm_host, &config.user);
    let pwd = effective_password(&app, None).unwrap_or(None);
    let active_check = receiver_check(&config, pwd.as_deref());
    let active_state = match active_check.state {
        "ready" => "connected",
        "blocked" if active_check.detail.contains("Autenticazione") => "auth_required",
        _ => "offline",
    };

    for node in &mut nodes {
        if node.is_active {
            node.connection_state = Some(active_state.into());
        } else {
            node.connection_state = None;
        }
    }

    // Role-based filtering
    let session = token.as_deref().and_then(auth::get_session);
    let is_admin = session.as_ref().map(|s| s.role == "admin" || s.role == "owner").unwrap_or(false);

    if is_admin {
        Ok(nodes)
    } else {
        let username = session.as_ref().map(|s| s.username.to_lowercase()).unwrap_or_default();
        let visible_nodes: Vec<NodeEntry> = nodes
            .into_iter()
            .filter(|n| {
                n.allowed_users.iter().any(|u| u == "*" || (!username.is_empty() && u.to_lowercase() == username))
            })
            .collect();
        Ok(visible_nodes)
    }
}

#[tauri::command(async)]
fn switch_node(
    app: AppHandle,
    host: String,
    user: Option<String>,
    ssh_password: Option<String>,
    token: Option<String>,
) -> AppResult<SetupConfig> {
    let session = token.as_deref().and_then(auth::get_session);
    let is_admin = session.as_ref().map(|s| s.role == "admin" || s.role == "owner").unwrap_or(false);

    let path = config_path(&app)?;
    let mut config = detect_config(parse_config(&path));
    let target_host = host.trim().to_string();

    if !is_admin {
        let nodes = load_nodes(&app, &config.vm_host, &config.user);
        let username = session.as_ref().map(|s| s.username.to_lowercase()).unwrap_or_default();
        let allowed = nodes.iter().any(|n| {
            n.host == target_host
                && (n.allowed_users.iter().any(|u| u == "*" || (!username.is_empty() && u.to_lowercase() == username)))
        });
        if !allowed {
            return Err("Accesso a questo nodo non autorizzato per il tuo profilo.".into());
        }
    }

    config.vm_host = target_host;
    if is_admin {
        if let Some(u) = user.filter(|u| !u.trim().is_empty()) {
            config.user = u.trim().to_string();
        }
    }

    if config.vm_host.parse::<IpAddr>().is_ok() {
        config.vm_address = config.vm_host.clone();
    } else if let Ok(mut addrs) = format!("{}:22", config.vm_host).to_socket_addrs() {
        if let Some(addr) = addrs.next() {
            config.vm_address = addr.ip().to_string();
        }
    }

    let db_path = nodes_db_path(&app).ok();
    let mut node_secret: Option<String> = None;
    if let Some(ref db_p) = db_path {
        let current_nodes = db::load_nodes(db_p, &config.vm_host, &config.user);
        if let Some(target_node) = current_nodes.iter().find(|n| n.host == config.vm_host) {
            if let Some(pwd) = &ssh_password {
                if !pwd.trim().is_empty() {
                    let _ = db::save_node_password(db_p, &target_node.id, pwd);
                    node_secret = Some(pwd.clone());
                }
            } else {
                node_secret = db::get_node_password(db_p, &target_node.id);
            }
        }
    }

    let preserved_password = if let Some(sec) = node_secret {
        Some(sec)
    } else if ssh_password.is_some() {
        ssh_password
    } else {
        secret_from_config(&path)
    };

    if let Some(ref sec) = preserved_password {
        if !sec.trim().is_empty() {
            std::env::set_var("OMARCHY_SSH_PASSWORD", sec);
        }
    }

    fs::write(
        &path,
        config_contents(&config, preserved_password.as_deref()),
    )
    .map_err(|e| e.to_string())?;

    let mut nodes = load_nodes(&app, &config.vm_host, &config.user);
    let mut found = false;
    for n in &mut nodes {
        if n.host == config.vm_host {
            n.is_active = true;
            found = true;
        } else {
            n.is_active = false;
        }
    }
    if !found && is_admin {
        nodes.push(NodeEntry {
            id: format!("node-{}", nodes.len() + 1),
            name: format!("Nodo ({})", config.vm_host),
            host: config.vm_host.clone(),
            user: config.user.clone(),
            is_active: true,
            connection_state: None,
            allowed_users: vec!["admin".into(), "owner".into()],
            api_port: 47995,
            api_token: None,
            streaming_port: 47989,
            ddns_domain: None,
        });
    }
    let _ = save_nodes(&app, &nodes);

    Ok(config)
}

#[tauri::command(async)]
fn add_node_entry(
    app: AppHandle,
    name: String,
    host: String,
    user: String,
    ssh_password: Option<String>,
    allowed_users: Option<Vec<String>>,
    token: Option<String>,
    streaming_port: Option<u16>,
    ddns_domain: Option<String>,
) -> AppResult<Vec<NodeEntry>> {
    if !auth::is_admin_session(token.as_deref().unwrap_or("")) {
        return Err("Operazione non autorizzata: solo l'amministratore può aggiungere nodi.".into());
    }
    let path = config_path(&app)?;
    let config = detect_config(parse_config(&path));
    let mut nodes = load_nodes(&app, &config.vm_host, &config.user);
    let users = allowed_users.unwrap_or_else(|| vec!["admin".into(), "owner".into()]);
    let new_id = format!("node-{}", nodes.len() + 1);
    let clean_ddns = ddns_domain.filter(|s| !s.trim().is_empty());
    let effective_stream_port = match streaming_port {
        Some(p) if p != 0 => p,
        _ => {
            let suggestion = calculate_suggested_port(&nodes, &host, clean_ddns.as_deref(), None);
            suggestion.port
        }
    };

    nodes.push(NodeEntry {
        id: new_id.clone(),
        name: if name.trim().is_empty() { host.clone() } else { name.trim().into() },
        host: host.trim().into(),
        user: if user.trim().is_empty() { config.user.clone() } else { user.trim().into() },
        is_active: false,
        connection_state: None,
        allowed_users: users,
        api_port: 47995,
        api_token: None,
        streaming_port: effective_stream_port,
        ddns_domain: clean_ddns,
    });
    save_nodes(&app, &nodes)?;

    if let Some(pwd) = ssh_password.filter(|p| !p.trim().is_empty()) {
        if let Ok(db_path) = nodes_db_path(&app) {
            let _ = db::save_node_password(&db_path, &new_id, &pwd);
        }
    }

    Ok(nodes)
}

#[tauri::command(async)]
fn get_suggested_streaming_port(
    app: AppHandle,
    host: String,
    ddns_domain: Option<String>,
    node_id: Option<String>,
) -> AppResult<PortSuggestion> {
    let path = config_path(&app)?;
    let config = detect_config(parse_config(&path));
    let nodes = load_nodes(&app, &config.vm_host, &config.user);
    Ok(calculate_suggested_port(
        &nodes,
        &host,
        ddns_domain.as_deref(),
        node_id.as_deref(),
    ))
}

#[tauri::command(async)]
fn delete_node_entry(
    app: AppHandle,
    node_id: String,
    token: Option<String>,
) -> AppResult<Vec<NodeEntry>> {
    if !auth::is_admin_session(token.as_deref().unwrap_or("")) {
        return Err("Operazione non autorizzata: solo l'amministratore può rimuovere nodi.".into());
    }
    if let Ok(db_path) = nodes_db_path(&app) {
        let _ = db::delete_node(&db_path, &node_id);
    }
    let path = config_path(&app)?;
    let config = detect_config(parse_config(&path));
    let mut nodes = load_nodes(&app, &config.vm_host, &config.user);
    nodes.retain(|n| n.id != node_id);
    save_nodes(&app, &nodes)?;
    Ok(nodes)
}

#[tauri::command(async)]
fn set_node_allowed_users(
    app: AppHandle,
    node_id: String,
    allowed_users: Vec<String>,
    token: Option<String>,
) -> AppResult<Vec<NodeEntry>> {
    if !auth::is_admin_session(token.as_deref().unwrap_or("")) {
        return Err("Operazione non autorizzata: solo l'amministratore può configurare le autorizzazioni dei nodi.".into());
    }
    let path = config_path(&app)?;
    let config = detect_config(parse_config(&path));
    let mut nodes = load_nodes(&app, &config.vm_host, &config.user);
    if let Some(node) = nodes.iter_mut().find(|n| n.id == node_id) {
        node.allowed_users = allowed_users;
    }
    save_nodes(&app, &nodes)?;
    Ok(nodes)
}

#[tauri::command(async)]
fn test_ssh_connection(
    app: AppHandle,
    host: String,
    user: String,
    ssh_password: Option<String>,
) -> AppResult<String> {
    let clean_host = host.trim();
    let clean_user = user.trim();
    if clean_host.is_empty() {
        return Err("Host non specificato o vuoto".into());
    }
    let effective_user = if clean_user.is_empty() { "daubog44" } else { clean_user };

    let mut command = Command::new("ssh");
    command.args([
        "-o", "StrictHostKeyChecking=accept-new",
        "-o", "ConnectTimeout=4",
        "-o", "NumberOfPasswordPrompts=1",
    ]);

    let password = if let Some(p) = ssh_password.filter(|p| !p.trim().is_empty()) {
        Some(p)
    } else {
        effective_password(&app, None).unwrap_or(None)
    };

    if let Some(ref pwd) = password {
        // Enforce password authentication so SSH does not offer restricted keys like voxtype
        command.args(["-o", "PubkeyAuthentication=no"]);
        prepare_askpass(&mut command, pwd)?;
    } else {
        if let Some(home) = std::env::var_os("HOME").map(std::path::PathBuf::from) {
            let key = home.join(".ssh").join("id_ed25519");
            if key.is_file() {
                command.arg("-i").arg(key).args(["-o", "IdentitiesOnly=yes"]);
            }
        }
        command.args(["-o", "BatchMode=yes"]);
    }

    let target = format!("{effective_user}@{clean_host}");
    let output = command.arg(&target).arg("echo 'OMARCHY_SSH_SUCCESS'").output()
        .map_err(|e| format!("Impossibile avviare il processo SSH: {e}"))?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        if stdout.contains("OMARCHY_SSH_SUCCESS") {
            return Ok(format!("Connessione SSH riuscita con successo ({effective_user}@{clean_host})"));
        }
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    if stderr.contains("Permission denied") {
        Err("Autenticazione fallita: Password SSH o chiave non valida.".into())
    } else if stderr.contains("Connection refused") {
        Err("Connessione rifiutata sulla porta 22 (fail2ban attivo o servizio SSH spento).".into())
    } else if stderr.contains("Comando microfono non autorizzato") {
        Err("La chiave SSH sul client è configurata per il solo microfono. Inserisci la password SSH per l'accesso completo.".into())
    } else if stderr.contains("timed out") || stderr.contains("Operation timed out") {
        Err("Timeout di connessione (host non raggiungibile entro 4s).".into())
    } else {
        let trimmed = stderr.trim();
        if trimmed.is_empty() {
            Err("Tentativo SSH non riuscito (codice di uscita diverso da 0).".into())
        } else {
            Err(format!("Errore SSH: {trimmed}"))
        }
    }
}

#[derive(Serialize)]
pub struct ApiTestResult {
    pub ok: bool,
    pub latency_ms: u64,
    pub version: String,
    pub authenticated: bool,
    pub message: String,
}

#[tauri::command(async)]
fn test_node_api(
    host: String,
    port: Option<u16>,
    api_token: Option<String>,
) -> AppResult<ApiTestResult> {
    let clean_host = host.trim();
    if clean_host.is_empty() {
        return Err("Host non specificato".into());
    }
    let p = port.unwrap_or(47995);
    let start = std::time::Instant::now();
    let health_url = format!("http://{}:{}/api/health", clean_host, p);

    let resp = ureq::get(&health_url)
        .timeout(std::time::Duration::from_millis(3000))
        .call();

    match resp {
        Ok(res) => {
            let latency_ms = start.elapsed().as_millis() as u64;
            let body: serde_json::Value = res.into_json().unwrap_or_default();
            let version = body.get("version").and_then(|v| v.as_str()).unwrap_or("0.3.0").to_string();

            let mut authenticated = false;
            if let Some(tok) = api_token.as_deref().filter(|t| !t.trim().is_empty()) {
                let status_url = format!("http://{}:{}/api/status", clean_host, p);
                let auth_resp = ureq::get(&status_url)
                    .set("Authorization", &format!("Bearer {}", tok.trim()))
                    .timeout(std::time::Duration::from_millis(3000))
                    .call();
                match auth_resp {
                    Ok(_) => {
                        authenticated = true;
                    }
                    Err(ureq::Error::Status(401, _)) => {
                        return Ok(ApiTestResult {
                            ok: false,
                            latency_ms,
                            version,
                            authenticated: false,
                            message: "Server raggiungibile ma Bearer Token non valido (401 Unauthorized)".into(),
                        });
                    }
                    Err(e) => {
                        return Ok(ApiTestResult {
                            ok: false,
                            latency_ms,
                            version,
                            authenticated: false,
                            message: format!("Errore test autenticazione: {e}"),
                        });
                    }
                }
            }

            Ok(ApiTestResult {
                ok: true,
                latency_ms,
                version,
                authenticated,
                message: if authenticated {
                    format!("Connessione REST API verificata con successo ({latency_ms}ms, Token Valido)")
                } else if api_token.as_ref().map(|t| !t.trim().is_empty()).unwrap_or(false) {
                    format!("Daemon REST API online ({latency_ms}ms)")
                } else {
                    format!("Daemon REST API attivo ({latency_ms}ms). Inserisci il Bearer Token per l'accesso amministrativo.")
                },
            })
        }
        Err(e) => Err(format!("Impossibile connettersi al daemon REST API su {clean_host}:{p}: {e}")),
    }
}

#[tauri::command(async)]
fn test_nas_connection(
    server: String,
    share: String,
    username: Option<String>,
    password: Option<String>,
) -> Result<broker::NasTestResult, String> {
    let host = std::env::var("OMARCHY_VM_HOST").unwrap_or_else(|_| "192.168.0.28".into());
    let ssh_user = std::env::var("OMARCHY_SSH_USER").unwrap_or_else(|_| "daubog44".into());
    broker::test_nas_share(
        &host,
        &ssh_user,
        &server,
        &share,
        username.as_deref(),
        password.as_deref(),
    )
}

#[tauri::command(async)]
fn mount_nas_storage(
    server: String,
    share: String,
    mountpoint: String,
    username: Option<String>,
    password: Option<String>,
) -> Result<broker::NasMountResult, String> {
    let host = std::env::var("OMARCHY_VM_HOST").unwrap_or_else(|_| "192.168.0.28".into());
    let ssh_user = std::env::var("OMARCHY_SSH_USER").unwrap_or_else(|_| "daubog44".into());
    broker::mount_nas_share(
        &host,
        &ssh_user,
        &server,
        &share,
        &mountpoint,
        username.as_deref(),
        password.as_deref(),
    )
}

#[tauri::command(async)]
fn get_tailscale_nodes() -> Result<Vec<broker::TailscaleNode>, String> {
    broker::get_tailscale_nodes()
}

#[tauri::command(async)]
fn get_public_ip() -> Result<String, String> {
    let resp = ureq::get("https://api.ipify.org")
        .timeout(std::time::Duration::from_millis(3000))
        .call()
        .map_err(|e| format!("Errore nel recupero IP pubblico: {e}"))?;
    resp.into_string().map_err(|e| format!("Errore lettura risposta: {e}"))
}

#[tauri::command(async)]
fn save_node_credentials(
    app: AppHandle,
    node_id: String,
    host: String,
    user: String,
    ssh_password: Option<String>,
    api_port: Option<u16>,
    api_token: Option<String>,
    token: Option<String>,
    streaming_port: Option<u16>,
    ddns_domain: Option<String>,
) -> AppResult<NodeEntry> {
    let session = token.as_deref().and_then(auth::get_session);
    let is_admin = session.as_ref().map(|s| s.role == "admin" || s.role == "owner").unwrap_or(false);
    if !is_admin {
        return Err("Solo l'amministratore può salvare le credenziali dei nodi.".into());
    }

    let db_p = nodes_db_path(&app)?;
    let clean_host = host.trim().to_string();
    let clean_user = user.trim().to_string();
    if clean_host.is_empty() {
        return Err("Host non specificato.".into());
    }

    let effective_port = api_port.unwrap_or(47995);
    let clean_token = api_token.as_ref().map(|t| t.trim().to_string()).filter(|t| !t.is_empty());

    if let Some(ref pwd) = ssh_password {
        if !pwd.trim().is_empty() {
            db::save_node_password(&db_p, &node_id, pwd)
                .map_err(|e| format!("Errore salvataggio password: {e}"))?;
            std::env::set_var("OMARCHY_SSH_PASSWORD", pwd);
        }
    }

    std::env::set_var("OMARCHY_API_PORT", effective_port.to_string());
    if let Some(ref t) = clean_token {
        std::env::set_var("OMARCHY_API_TOKEN", t);
    }

    let path = config_path(&app)?;
    let mut config = detect_config(parse_config(&path));
    config.vm_host = clean_host.clone();
    if !clean_user.is_empty() {
        config.user = clean_user.clone();
    }
    if config.vm_host.parse::<IpAddr>().is_ok() {
        config.vm_address = config.vm_host.clone();
    } else if let Ok(mut addrs) = format!("{}:22", config.vm_host).to_socket_addrs() {
        if let Some(addr) = addrs.next() {
            config.vm_address = addr.ip().to_string();
        }
    }

    let secret_string = ssh_password.clone().or_else(|| db::get_node_password(&db_p, &node_id));
    let _ = fs::write(&path, config_contents(&config, secret_string.as_deref()));

    let mut nodes = load_nodes(&app, &config.vm_host, &config.user);
    let mut target_entry = None;
    for n in &mut nodes {
        if n.id == node_id || n.host == clean_host {
            n.host = clean_host.clone();
            if !clean_user.is_empty() {
                n.user = clean_user.clone();
            }
            n.api_port = effective_port;
            if clean_token.is_some() {
                n.api_token = clean_token.clone();
            }
            if let Some(sp) = streaming_port {
                if sp > 0 {
                    n.streaming_port = sp;
                }
            }
            if ddns_domain.is_some() {
                n.ddns_domain = ddns_domain.clone().filter(|s| !s.trim().is_empty());
            }
            n.is_active = true;
            target_entry = Some(n.clone());
        } else {
            n.is_active = false;
        }
    }

    if let Some(entry) = target_entry {
        save_nodes(&app, &nodes)?;
        Ok(entry)
    } else {
        let new_entry = NodeEntry {
            id: node_id,
            name: clean_host.clone(),
            host: clean_host,
            user: if clean_user.is_empty() { "daubog44".into() } else { clean_user },
            is_active: true,
            connection_state: Some("connected".into()),
            allowed_users: vec!["admin".into(), "owner".into()],
            api_port: effective_port,
            api_token: clean_token,
            streaming_port: streaming_port.unwrap_or(47989),
            ddns_domain: ddns_domain.filter(|s| !s.trim().is_empty()),
        };
        nodes.push(new_entry.clone());
        save_nodes(&app, &nodes)?;
        Ok(new_entry)
    }
}

#[tauri::command(async)]
fn get_enterprise_settings(
    app: AppHandle,
) -> AppResult<std::collections::HashMap<String, String>> {
    let path = config_path(&app)?;
    let config = detect_config(parse_config(&path));
    broker::get_enterprise_settings(&config.vm_host, &config.user)
}

#[tauri::command(async)]
fn update_enterprise_setting(
    app: AppHandle,
    token: Option<String>,
    key: String,
    value: String,
) -> AppResult<String> {
    if !auth::is_admin_session(token.as_deref().unwrap_or("")) {
        return Err("Operazione non autorizzata: solo l'amministratore può modificare le impostazioni Enterprise.".into());
    }
    let path = config_path(&app)?;
    let config = detect_config(parse_config(&path));
    broker::update_enterprise_setting(&config.vm_host, &config.user, &key, &value)
}

#[tauri::command(async)]
fn check_admission(
    app: AppHandle,
    requested_vram: Option<u32>,
) -> AppResult<broker::AdmissionStatus> {
    let path = config_path(&app)?;
    let config = detect_config(parse_config(&path));
    broker::check_admission(&config.vm_host, &config.user, requested_vram.unwrap_or(600))
}

#[tauri::command(async)]
fn sync_user_savegames(
    app: AppHandle,
    token: Option<String>,
    username: String,
    direction: Option<String>,
) -> AppResult<String> {
    let tok = token.as_deref().unwrap_or("");
    let is_admin = auth::is_admin_session(tok);
    if !is_admin {
        if let Some(session) = auth::get_session(tok) {
            if session.username != username {
                return Err("Non autorizzato a sincronizzare i salvataggi di un altro utente.".into());
            }
        } else {
            return Err("Sessione non valida.".into());
        }
    }
    let path = config_path(&app)?;
    let config = detect_config(parse_config(&path));
    broker::sync_savegames(&config.vm_host, &config.user, &username, &direction.unwrap_or_else(|| "push".into()))
}

#[tauri::command(async)]
fn list_user_savegames(
    app: AppHandle,
    token: Option<String>,
    username: Option<String>,
) -> AppResult<Vec<broker::SavegameManifest>> {
    let tok = token.as_deref().unwrap_or("");
    let is_admin = auth::is_admin_session(tok);
    let target_user = if !is_admin {
        let session = auth::get_session(tok).ok_or("Sessione non valida")?;
        Some(session.username)
    } else {
        username
    };
    let path = config_path(&app)?;
    let config = detect_config(parse_config(&path));
    broker::list_savegames(&config.vm_host, &config.user, target_user.as_deref())
}

#[tauri::command(async)]
fn create_vpn_peer(
    app: AppHandle,
    token: Option<String>,
    username: String,
    client_name: String,
) -> AppResult<String> {
    let tok = token.as_deref().unwrap_or("");
    let is_admin = auth::is_admin_session(tok);
    if !is_admin {
        if let Some(session) = auth::get_session(tok) {
            if session.username != username {
                return Err("Non autorizzato a creare un peer WireGuard per un altro utente.".into());
            }
        } else {
            return Err("Sessione non valida.".into());
        }
    }
    let path = config_path(&app)?;
    let config = detect_config(parse_config(&path));
    broker::create_vpn_peer(&config.vm_host, &config.user, &username, &client_name)
}

#[tauri::command(async)]
fn list_vpn_peers(
    app: AppHandle,
    token: Option<String>,
    username: Option<String>,
) -> AppResult<Vec<broker::VpnPeer>> {
    let tok = token.as_deref().unwrap_or("");
    let is_admin = auth::is_admin_session(tok);
    let target_user = if !is_admin {
        let session = auth::get_session(tok).ok_or("Sessione non valida")?;
        Some(session.username)
    } else {
        username
    };
    let path = config_path(&app)?;
    let config = detect_config(parse_config(&path));
    broker::list_vpn_peers(&config.vm_host, &config.user, target_user.as_deref())
}

#[tauri::command(async)]
fn delete_vpn_peer(
    app: AppHandle,
    token: Option<String>,
    peer_id: String,
) -> AppResult<String> {
    if !auth::is_admin_session(token.as_deref().unwrap_or("")) {
        return Err("Operazione non autorizzata: solo l'amministratore può revocare i peer WireGuard.".into());
    }
    let path = config_path(&app)?;
    let config = detect_config(parse_config(&path));
    broker::delete_vpn_peer(&config.vm_host, &config.user, &peer_id)
}

#[tauri::command(async)]
fn prune_nas_storage(
    app: AppHandle,
    token: Option<String>,
    dry_run: Option<bool>,
) -> AppResult<String> {
    if !auth::is_admin_session(token.as_deref().unwrap_or("")) {
        return Err("Operazione non autorizzata: solo l'amministratore può eseguire la retention dello storage NAS.".into());
    }
    let path = config_path(&app)?;
    let config = detect_config(parse_config(&path));
    broker::prune_nas_storage(&config.vm_host, &config.user, dry_run.unwrap_or(false))
}

#[tauri::command(async)]
fn test_vpn_connectivity(
    target_ip: String,
) -> AppResult<String> {
    broker::test_vpn_connectivity(&target_ip)
}

#[tauri::command(async)]
fn get_desktop_vpn_status() -> broker::DesktopVpnStatus {
    broker::get_desktop_vpn_status()
}

#[tauri::command(async)]
fn connect_desktop_vpn(
    app: AppHandle,
    token: Option<String>,
) -> AppResult<broker::DesktopVpnStatus> {
    let tok = token.as_deref().unwrap_or("");
    let session = auth::get_session(tok).ok_or("Sessione non valida")?;
    let path = config_path(&app)?;
    let config = detect_config(parse_config(&path));
    broker::connect_desktop_vpn(&config.vm_host, &config.user, &session.username)
}

#[tauri::command(async)]
fn disconnect_desktop_vpn() -> AppResult<broker::DesktopVpnStatus> {
    broker::disconnect_desktop_vpn()
}

#[tauri::command(async)]
fn get_ddns_status(app: AppHandle) -> AppResult<broker::DdnsStatus> {
    let path = config_path(&app)?;
    let config = detect_config(parse_config(&path));
    broker::get_ddns_status(&config.vm_host, &config.user)
}

#[tauri::command(async)]
fn update_ddns_config(
    app: AppHandle,
    domain: String,
    token: String,
    enabled: bool,
) -> AppResult<String> {
    let path = config_path(&app)?;
    let config = detect_config(parse_config(&path));
    broker::update_ddns_config(&config.vm_host, &config.user, &domain, &token, enabled)
}

pub fn run() {
    tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol("omarchy-rec", serve_recording)
        .invoke_handler(tauri::generate_handler![
            inspect_setup,
            discover_config,
            check_receiver,
            save_config,
            launch_moonlight,
            list_displays,
            configure_moonlight_gaming,
            install_dependency,
            run_setup_in_terminal,
            get_multi_user_dashboard,
            add_multi_user,
            pair_moonlight_device,
            list_recordings,
            session_control,
            user_storage,
            download_user_file,
            delete_recording,
            download_recording,
            cancel_recording_download,
            reveal_in_file_manager,
            edit_multi_user,
            remove_multi_user,
            ban_multi_user,
            unban_multi_user,
            kill_user_session,
            takeover_user_session,
            spectate_user_session,
            capture_session_frame,
            get_session_stream_url,
            start_session_recording,
            stop_session_recording,
            stop_session_stream,
            start_live_video,
            whep_offer,
            whep_close,
            live_info,
            stop_live_video,
            install_multi_user_backend,
            check_for_updates,
            install_update,
            finish_update,
            login,
            auth_needs_setup,
            auth_setup,
            validate_session,
            logout,
            list_nodes,
            switch_node,
            add_node_entry,
            delete_node_entry,
            set_node_allowed_users,
            get_enterprise_settings,
            update_enterprise_setting,
            check_admission,
            sync_user_savegames,
            list_user_savegames,
            create_vpn_peer,
            list_vpn_peers,
            delete_vpn_peer,
            prune_nas_storage,
            test_vpn_connectivity,
            get_desktop_vpn_status,
            connect_desktop_vpn,
            disconnect_desktop_vpn,
            test_ssh_connection,
            test_node_api,
            save_node_credentials,
            test_nas_connection,
            mount_nas_storage,
            get_tailscale_nodes,
            get_public_ip,
            get_ddns_status,
            update_ddns_config,
            get_suggested_streaming_port,
            test_stream_port,
            open_moonlight_url
        ])
        .run(tauri::generate_context!())
        .expect("errore durante l'avvio di Omarchy Control");
}



#[cfg(test)]
mod tests {
    #[test]
    fn recording_state_survives_broker_to_frontend() {
        let session: crate::broker::ActiveSession = serde_json::from_value(serde_json::json!({
            "session_id":"wolf-1", "username":"test", "client_ip":"127.0.0.1", "app_name":"Desktop",
            "resolution":"2880x1800", "fps":60, "bitrate_kbps":20000, "vram_mb":600,
            "started_at":1, "state":"running", "is_recording":true
        })).unwrap();
        assert!(serde_json::to_value(session).unwrap()["is_recording"].as_bool().unwrap());
    }

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
        assert_eq!(moonlight_default_bitrate_kbps(3840, 2160, 30), 40_000);
        assert_eq!(moonlight_default_bitrate_kbps(3840, 2160, 60), 80_000);
    }

    #[test]
    fn moonlight_profiles_default_to_full_hd_and_offer_4k30() {
        assert_eq!(
            moonlight_gaming_profile("performance", 3840, 2160).unwrap(),
            (1920, 1080, 60, "Full HD 60 FPS (H.265 HEVC)")
        );
        assert_eq!(
            moonlight_gaming_profile("quality30", 3840, 2160).unwrap(),
            (3840, 2160, 30, "4K 30 FPS (H.265 HEVC)")
        );
        assert_eq!(
            moonlight_gaming_profile("quality30", 1920, 1080).unwrap(),
            (3840, 2160, 30, "4K 30 FPS (H.265 HEVC)")
        );
    }

    #[test]
    fn moonlight_settings_enforce_hevc_codec() {
        let settings = moonlight_gaming_settings(1920, 1080, 60);
        assert_eq!(settings.get("videocfg").unwrap().ini_value(), "2");
    }

    #[test]
    fn install_backend_simulation() {
        let res = broker::install_backend("", "").unwrap();
        assert!(res.contains("Backend simulato"));
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

    #[test]
    fn multi_user_fallback_overview_has_telemetry_and_owner() {
        let overview = broker::fallback_overview();
        assert_eq!(overview.status, "ok");
        assert!(overview.telemetry.memory_total_mb == 4096);
        assert!(!overview.users.is_empty());
        let owner = overview.users.iter().find(|u| u.role == "owner");
        assert!(owner.is_some());
        assert_eq!(owner.unwrap().username, "owner");
    }

    #[test]
    fn create_user_rejects_empty_credentials() {
        let result = broker::create_user("", "", "", "Test", "", "guest", &[], 20, &[], false, 0.0);
        assert!(result.is_err());
    }

    #[test]
    fn db_encryption_and_storage_roundtrip() {
        let secret = "SuperSecretPassword123!";
        let encrypted = db::encrypt_secret(secret).unwrap();
        assert_ne!(encrypted, secret);
        let decrypted = db::decrypt_secret(&encrypted).unwrap();
        assert_eq!(decrypted, secret);

        let temp_dir = std::env::temp_dir().join(format!("omarchy_db_test_{}", std::process::id()));
        let db_file = temp_dir.join("test_nodes.db");
        let nodes = db::load_nodes(&db_file, "omarchy.local", "daubog44");
        assert!(!nodes.is_empty());
        let first_id = &nodes[0].id;
        db::save_node_password(&db_file, first_id, secret).unwrap();
        let loaded_pwd = db::get_node_password(&db_file, first_id);
        assert_eq!(loaded_pwd.as_deref(), Some(secret));
        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn ban_and_unban_user_validation() {
        assert!(broker::ban_user("", "", "", "reason").is_err());
        assert!(broker::unban_user("", "", "").is_err());
        let ban_sim = broker::ban_user("", "", "ospite1", "violazione").unwrap();
        assert!(ban_sim.contains("ospite1"));
        let unban_sim = broker::unban_user("", "", "ospite1").unwrap();
        assert!(unban_sim.contains("ospite1"));
    }

    #[test]
    fn updater_version_comparison() {
        assert!(updater::is_newer("0.3.1", "0.3.0"));
        assert!(updater::is_newer("0.4.0", "0.3.0"));
        assert!(updater::is_newer("1.0.0", "0.3.0"));
        assert!(!updater::is_newer("0.3.0", "0.3.0"));
        assert!(!updater::is_newer("0.2.9", "0.3.0"));
        assert!(!updater::is_newer("0.1.0", "0.3.0"));
    }

    #[test]
    fn updater_check_local_fallback() {
        let update_res = updater::check_for_updates("0.3.0", None);
        assert!(update_res.is_ok());
        let update_info = update_res.unwrap();
        assert_eq!(update_info.current_version, "0.3.0");
    }

    #[test]
    fn auth_hash_and_verification() {
        let hash1 = auth::hash_password("test-value-4821", "test_salt");
        let hash2 = auth::hash_password("test-value-4821", "test_salt");
        assert_eq!(hash1.len(), 64);
        assert_eq!(hash1, hash2);

        let hash_wrong = auth::hash_password("WrongPassword123", "test_salt");
        assert_ne!(hash1, hash_wrong);
    }

    #[test]
    fn auth_login_and_session_lifecycle() {
        let temp_dir = std::env::temp_dir().join(format!("omarchy_auth_test_{}", std::process::id()));
        let _ = std::fs::create_dir_all(&temp_dir);

        let _ = std::fs::remove_file(temp_dir.join("omarchy-admin.auth"));
        let password = "local-test-password-42";

        // First run: no password yet, nothing logs in (no built-in default)
        assert!(auth::needs_setup(&temp_dir));
        assert!(auth::login(&temp_dir, "admin", password).is_err());
        assert!(auth::set_initial_password(&temp_dir, "short").is_err());
        assert!(auth::set_initial_password(&temp_dir, password).is_ok());
        assert!(!auth::needs_setup(&temp_dir));
        // Setup cannot overwrite an existing password
        assert!(auth::set_initial_password(&temp_dir, "another-password-99").is_err());

        // Success login
        let session_res = auth::login(&temp_dir, "admin", password);
        assert!(session_res.is_ok());
        let session = session_res.unwrap();
        assert_eq!(session.username, "admin");
        assert_eq!(session.role, "admin");
        assert!(session.token.len() > 10);

        // Validate session
        assert!(auth::validate_session(&session.token));

        // Wrong token fails validation
        assert!(!auth::validate_session("fake_token_12345"));

        // Logout
        assert!(auth::logout(&session.token));
        assert!(!auth::validate_session(&session.token));

        // Wrong password fails login
        let fail_res = auth::login(&temp_dir, "admin", "WrongPassword!");
        assert!(fail_res.is_err());

        // Tokens are random, never derived from user/time/pid
        let t1 = auth::login(&temp_dir, "admin", password).unwrap().token;
        let t2 = auth::login(&temp_dir, "admin", password).unwrap().token;
        assert_ne!(t1, t2);
        assert_eq!(t1.len(), 64);

        // Cleanup
        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    /// Serves `body` once over HTTP (optionally lying about Content-Length).
    fn one_shot_http(body: Vec<u8>, advertised_len: usize) -> u16 {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut req = [0u8; 4096];
                let _ = stream.read(&mut req);
                let head = format!("HTTP/1.1 200 OK\r\nContent-Type: video/mp4\r\nContent-Length: {advertised_len}\r\nConnection: close\r\n\r\n");
                let _ = stream.write_all(head.as_bytes());
                let _ = stream.write_all(&body);
            }
        });
        port
    }

    #[test]
    fn recording_download_to_disk() {
        use std::sync::atomic::AtomicBool;
        let dir = std::env::temp_dir().join(format!("omarchy_dl_test_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        // Never overwrites an existing file
        std::fs::write(dir.join("rec.mp4"), b"old").unwrap();
        let dest = super::unique_download_path(&dir, "rec.mp4");
        assert_eq!(dest.file_name().unwrap(), "rec (1).mp4");
        assert_eq!(super::unique_download_path(&dir, "../../etc/x.mp4").parent().unwrap(), dir.as_path());

        let body: Vec<u8> = (0..3 * 1024 * 1024 + 123).map(|i| (i % 251) as u8).collect();
        let port = one_shot_http(body.clone(), body.len());
        std::env::set_var("OMARCHY_API_PORT", port.to_string());
        let cancel = AtomicBool::new(false);
        let mut updates = 0;
        let bytes = broker::download_recording("127.0.0.1", "0:u/a.mp4", &dest, &cancel, |_, total| {
            assert_eq!(total, Some(body.len() as u64));
            updates += 1;
            true
        })
        .unwrap();
        assert_eq!(bytes, body.len() as u64);
        assert_eq!(std::fs::read(&dest).unwrap(), body);
        assert!(updates >= 3);
        assert!(!dest.with_extension("mp4.part").exists());

        // Cancelled: error, no partial file left behind
        let cancelled = dir.join("cancelled.mp4");
        let port = one_shot_http(body.clone(), body.len());
        std::env::set_var("OMARCHY_API_PORT", port.to_string());
        let cancel = AtomicBool::new(true);
        assert!(broker::download_recording("127.0.0.1", "x", &cancelled, &cancel, |_, _| true).is_err());
        assert!(!cancelled.exists() && !cancelled.with_extension("mp4.part").exists());

        // Truncated transfer is rejected, not saved as a broken video
        let short = dir.join("short.mp4");
        let port = one_shot_http(body[..1000].to_vec(), body.len());
        std::env::set_var("OMARCHY_API_PORT", port.to_string());
        let cancel = AtomicBool::new(false);
        assert!(broker::download_recording("127.0.0.1", "x", &short, &cancel, |_, _| true).is_err());
        assert!(!short.exists());

        std::env::remove_var("OMARCHY_API_PORT");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn pbkdf2_sha256_known_vectors() {
        // RFC 7914 section 11 / widely published PBKDF2-HMAC-SHA256 vectors (dkLen = 32)
        assert_eq!(
            auth::pbkdf2_sha256_hex("password", "salt", 1),
            "120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b"
        );
        assert_eq!(
            auth::pbkdf2_sha256_hex("password", "salt", 2),
            "ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43"
        );
        assert_eq!(
            auth::pbkdf2_sha256_hex("password", "salt", 4096),
            "c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a"
        );
    }

    #[test]
    fn auth_existing_records() {
        let temp_dir = std::env::temp_dir().join(format!("omarchy_auth_records_{}", std::process::id()));
        let _ = std::fs::create_dir_all(&temp_dir);
        let auth_file = temp_dir.join("omarchy-admin.auth");

        // A record with a real password (own salt + hash) keeps working
        let record = serde_json::json!({
            "username": "admin",
            "salt": "a1b2c3d4",
            "password_hash": auth::hash_password("kept-password-42", "a1b2c3d4"),
        });
        std::fs::write(&auth_file, record.to_string()).unwrap();
        assert!(!auth::needs_setup(&temp_dir));
        assert!(auth::login(&temp_dir, "admin", "kept-password-42").is_ok());
        // ...and is upgraded to PBKDF2 on that login, still accepting the same password
        let upgraded: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&auth_file).unwrap()).unwrap();
        assert_eq!(upgraded["algo"], "pbkdf2-sha256");
        assert!(auth::login(&temp_dir, "admin", "kept-password-42").is_ok());
        assert!(auth::login(&temp_dir, "admin", "wrong-password-42").is_err());

        // The legacy first-run record (fixed salt + shipped default) is not a
        // credential: login is refused and setup is required
        let legacy = serde_json::json!({
            "username": "admin",
            "salt": "omarchy_pascal_salt_2026",
            "password_hash": "0ddcc0473e65438235cdc191ba0bef2b76127bf0c34d1da7280e9093361faa60",
        });
        std::fs::write(&auth_file, legacy.to_string()).unwrap();
        assert!(auth::needs_setup(&temp_dir));
        assert!(!auth::verify_credentials(&temp_dir, "admin", "kept-password-42").unwrap());
        assert!(auth::set_initial_password(&temp_dir, "brand-new-password-7").is_ok());
        assert!(auth::login(&temp_dir, "admin", "brand-new-password-7").is_ok());

        // New records get a random per-record salt and PBKDF2
        let stored: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&auth_file).unwrap()).unwrap();
        assert_eq!(stored["salt"].as_str().unwrap().len(), 32);
        assert_eq!(stored["algo"], "pbkdf2-sha256");
        assert_ne!(stored["salt"], "omarchy_pascal_salt_2026");

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_guest_login_and_node_filtering() {
        let temp_dir = std::env::temp_dir().join(format!("omarchy_auth_guest_{}", std::process::id()));
        let _ = std::fs::create_dir_all(&temp_dir);

        let test_users = vec![
            crate::broker::UserRecord {
                id: 1,
                username: "ospite1".into(),
                display_name: "Ospite Test".into(),
                role: "guest".into(),
                status: "active".into(),
                pin: "4321".into(),
                allowed_apps: vec!["Steam".into()],
                allowed_nodes: vec!["*".into()],
                max_bitrate_mbps: 20,
                created_at: 1700000000,
                auto_record: false,
                storage_limit_gb: 0.0,
                storage_used_gb: None,
                storage_quota_active: false,
            },
            crate::broker::UserRecord {
                id: 2,
                username: "banned_user".into(),
                display_name: "Banned".into(),
                role: "guest".into(),
                status: "banned".into(),
                pin: "9999".into(),
                allowed_apps: vec![],
                allowed_nodes: vec!["*".into()],
                max_bitrate_mbps: 10,
                created_at: 1700000000,
                auto_record: false,
                storage_limit_gb: 0.0,
                storage_used_gb: None,
                storage_quota_active: false,
            },
        ];
        auth::cache_users(&temp_dir, &test_users);

        // Guest login with PIN
        let guest_session = auth::login(&temp_dir, "ospite1", "4321").unwrap();
        assert_eq!(guest_session.role, "guest");
        assert_eq!(guest_session.username, "ospite1");
        assert!(!auth::is_admin_session(&guest_session.token));

        // Banned guest login fails
        assert!(auth::login(&temp_dir, "banned_user", "9999").is_err());

        // Node filtering logic verification
        let sample_nodes = vec![
            NodeEntry {
                id: "n1".into(),
                name: "Public".into(),
                host: "10.0.0.1".into(),
                user: "user".into(),
                is_active: true,
                connection_state: None,
                allowed_users: vec!["*".into()],
                api_port: 47995,
                api_token: None,
                streaming_port: 47989,
                ddns_domain: None,
            },
            NodeEntry {
                id: "n2".into(),
                name: "Private Proxmox".into(),
                host: "10.0.0.2".into(),
                user: "root".into(),
                is_active: false,
                connection_state: None,
                allowed_users: vec!["admin".into()],
                api_port: 47995,
                api_token: None,
                streaming_port: 47989,
                ddns_domain: None,
            },
            NodeEntry {
                id: "n3".into(),
                name: "Ospite Dedicated".into(),
                host: "10.0.0.3".into(),
                user: "ospite".into(),
                is_active: false,
                connection_state: None,
                allowed_users: vec!["ospite1".into()],
                api_port: 47995,
                api_token: None,
                streaming_port: 47989,
                ddns_domain: None,
            },
        ];

        let visible: Vec<&NodeEntry> = sample_nodes
            .iter()
            .filter(|n| n.allowed_users.iter().any(|u| u == "*" || u == &guest_session.username))
            .collect();
        assert_eq!(visible.len(), 2);
        assert_eq!(visible[0].id, "n1");
        assert_eq!(visible[1].id, "n3");

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn db_api_node_storage_roundtrip() {
        let temp_dir = std::env::temp_dir().join(format!("omarchy_api_db_test_{}", std::process::id()));
        let db_file = temp_dir.join("test_api_nodes.db");
        let initial_nodes = vec![
            NodeEntry {
                id: "test-node-1".into(),
                name: "Gaming Rig 1".into(),
                host: "192.168.0.50".into(),
                user: "daubog44".into(),
                is_active: true,
                connection_state: Some("connected".into()),
                allowed_users: vec!["admin".into()],
                api_port: 47995,
                api_token: Some("omarchy_sec_test_token_123456789".into()),
                streaming_port: 48989,
                ddns_domain: Some("cloudgamingadrian-node2.duckdns.org".into()),
            },
        ];
        db::save_nodes(&db_file, &initial_nodes).unwrap();
        let loaded = db::load_nodes(&db_file, "192.168.0.50", "daubog44");
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].api_port, 47995);
        assert_eq!(loaded[0].api_token.as_deref(), Some("omarchy_sec_test_token_123456789"));

        // Test updating api port and token via helper
        db::save_node_api_config(&db_file, "test-node-1", 48000, Some("omarchy_sec_updated")).unwrap();
        let updated = db::load_nodes(&db_file, "192.168.0.50", "daubog44");
        assert_eq!(updated[0].api_port, 48000);
        assert_eq!(updated[0].api_token.as_deref(), Some("omarchy_sec_updated"));

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_subnet_and_lan_detection() {
        let ip1: IpAddr = "192.168.0.28".parse().unwrap();
        let ip2: IpAddr = "192.168.0.29".parse().unwrap();
        let ip3: IpAddr = "192.168.1.50".parse().unwrap();
        let ip4: IpAddr = "10.0.0.10".parse().unwrap();
        let ip5: IpAddr = "10.0.0.15".parse().unwrap();

        assert!(are_ips_in_same_subnet(&ip1, &ip2));
        assert!(!are_ips_in_same_subnet(&ip1, &ip3));
        assert!(are_ips_in_same_subnet(&ip4, &ip5));
        assert!(!are_ips_in_same_subnet(&ip1, &ip4));

        let (same1, _) = are_nodes_on_same_lan("192.168.0.28", None, "192.168.0.29", None);
        assert!(same1);

        let (same2, _) = are_nodes_on_same_lan("192.168.0.28", None, "192.168.100.5", None);
        assert!(!same2);

        let (same_ddns, _) = are_nodes_on_same_lan(
            "10.0.0.1",
            Some("cloudgamingadrian.duckdns.org"),
            "10.0.0.2",
            Some("cloudgamingadrian.duckdns.org"),
        );
        assert!(same_ddns);

        let (diff_ddns, _) = are_nodes_on_same_lan(
            "10.0.0.1",
            Some("cloudgamingadrian.duckdns.org"),
            "10.200.0.1",
            Some("other-domain.duckdns.org"),
        );
        assert!(!diff_ddns);
    }

    #[test]
    fn test_auto_port_selection_avoids_lan_collisions() {
        let nodes = vec![
            NodeEntry {
                id: "node-1".into(),
                name: "Rig 1".into(),
                host: "192.168.0.28".into(),
                user: "daubog44".into(),
                is_active: true,
                connection_state: Some("connected".into()),
                allowed_users: vec!["*".into()],
                api_port: 47995,
                api_token: None,
                streaming_port: 47989,
                ddns_domain: None,
            },
            NodeEntry {
                id: "node-2".into(),
                name: "Rig 2".into(),
                host: "192.168.0.29".into(),
                user: "daubog44".into(),
                is_active: false,
                connection_state: None,
                allowed_users: vec!["*".into()],
                api_port: 47995,
                api_token: None,
                streaming_port: 48989,
                ddns_domain: None,
            },
        ];

        let suggestion3 = calculate_suggested_port(&nodes, "192.168.0.30", None, None);
        assert_eq!(suggestion3.port, 49989);
        assert!(suggestion3.is_conflict);

        let suggestion_other = calculate_suggested_port(&nodes, "192.168.50.10", None, None);
        assert_eq!(suggestion_other.port, 47989);
        assert!(!suggestion_other.is_conflict);
    }

    /// Live check against a real broker: OMARCHY_LIVE_HOST, OMARCHY_API_TOKEN,
    /// OMARCHY_LIVE_RECORDING. `cargo test -- --ignored live_recording_download`.
    #[test]
    #[ignore]
    fn live_recording_download() {
        let host = std::env::var("OMARCHY_LIVE_HOST").expect("OMARCHY_LIVE_HOST");
        let id = std::env::var("OMARCHY_LIVE_RECORDING").expect("OMARCHY_LIVE_RECORDING");
        let dest = std::env::temp_dir().join("omarchy-live-download.mp4");
        let cancel = std::sync::atomic::AtomicBool::new(false);
        let mut calls = 0u32;
        let written = broker::download_recording(&host, &id, &dest, &cancel, |done, total| {
            calls += 1;
            assert!(total.map_or(true, |t| done <= t));
            true
        })
        .expect("download");
        assert_eq!(std::fs::metadata(&dest).unwrap().len(), written);
        println!("downloaded {written} bytes in {calls} progress callbacks to {}", dest.display());
    }
}
