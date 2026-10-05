use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdmissionStatus {
    pub admitted: bool,
    pub active_streams: u32,
    pub max_concurrent_streams: u32,
    pub free_vram_mb: u32,
    pub requested_vram_mb: u32,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserStorageUsage {
    pub username: String,
    pub total_mb: f64,
    pub snapshots_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageTelemetry {
    pub nas_mounted: bool,
    pub nas_path: String,
    #[serde(default)]
    pub nas_mountpoint: String,
    pub storage_type: String,
    pub max_concurrent_streams: u32,
    pub vpn_peers_count: usize,
    pub savegame_snapshots_count: usize,
    pub retention_recordings_days: u32,
    #[serde(default)]
    pub nas_total_gb: f64,
    #[serde(default)]
    pub nas_free_gb: f64,
    #[serde(default)]
    pub recordings_mb: f64,
    #[serde(default)]
    pub recordings_count: usize,
    #[serde(default)]
    pub user_saves_breakdown: Vec<UserStorageUsage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VpnPeer {
    pub id: String,
    pub username: String,
    pub client_name: String,
    pub public_key: String,
    pub ip_address: String,
    pub created_at: u64,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavegameManifest {
    pub id: i64,
    pub username: String,
    pub snapshot_name: String,
    pub storage_type: String,
    pub file_path: String,
    pub size_bytes: u64,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PruneResult {
    pub status: String,
    pub dry_run: bool,
    pub retention_recordings_days: u32,
    pub pruned_recordings_count: usize,
    pub freed_recordings_mb: f64,
    pub storage_total_gb: f64,
    pub storage_free_gb: f64,
    pub nas_mounted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NasTestResult {
    pub status: String,
    pub accessible: bool,
    #[serde(default)]
    pub server: String,
    #[serde(default)]
    pub share: String,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub latency_ms: Option<f64>,
    #[serde(default)]
    pub auth_type: Option<String>,
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NasMountResult {
    pub status: String,
    pub mounted: bool,
    #[serde(default)]
    pub server: String,
    #[serde(default)]
    pub share: String,
    #[serde(default)]
    pub mountpoint: String,
    #[serde(default)]
    pub total_gb: Option<f64>,
    #[serde(default)]
    pub free_gb: Option<f64>,
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TailscaleNode {
    pub hostname: String,
    pub dns_name: String,
    pub ip: String,
    pub os: String,
    pub online: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpuTelemetry {
    pub available: bool,
    pub name: String,
    pub driver_version: String,
    pub gpu_utilization_pct: u32,
    pub memory_used_mb: u32,
    pub memory_total_mb: u32,
    pub memory_free_mb: u32,
    pub temperature_c: u32,
    pub encoder_sessions_count: u32,
    pub vram_status: String,
    #[serde(default)]
    pub cpu_utilization_pct: u32,
    #[serde(default)]
    pub ram_used_mb: u32,
    #[serde(default)]
    pub ram_total_mb: u32,
}

impl Default for GpuTelemetry {
    fn default() -> Self {
        Self {
            available: false,
            name: "NVIDIA GeForce GTX 1050 Mobile".into(),
            driver_version: "--".into(),
            gpu_utilization_pct: 0,
            memory_used_mb: 0,
            memory_total_mb: 4096,
            memory_free_mb: 4096,
            temperature_c: 0,
            encoder_sessions_count: 0,
            vram_status: "offline".into(),
            cpu_utilization_pct: 0,
            ram_used_mb: 0,
            ram_total_mb: 16384,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActiveSession {
    pub session_id: String,
    pub username: String,
    pub client_ip: String,
    pub app_name: String,
    pub resolution: String,
    pub fps: u32,
    pub bitrate_kbps: u32,
    pub vram_mb: u32,
    pub started_at: u64,
    pub state: String,
    pub takeover_by: Option<String>,
    #[serde(default, alias = "recording_active")]
    pub is_recording: bool,
    #[serde(default)]
    pub recording_file: Option<String>,
    #[serde(default)]
    pub recording_size_mb: f64,
    #[serde(default)]
    pub recording_duration_sec: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserRecord {
    pub id: i64,
    pub username: String,
    pub display_name: String,
    pub pin: String,
    pub role: String,
    pub allowed_apps: Vec<String>,
    #[serde(default)]
    pub allowed_nodes: Vec<String>,
    pub max_bitrate_mbps: u32,
    pub status: String,
    pub created_at: u64,
    #[serde(default)]
    pub auto_record: bool,
    #[serde(default)]
    pub storage_limit_gb: f64,
    #[serde(default)]
    pub storage_used_gb: Option<f64>,
    #[serde(default)]
    pub storage_quota_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MultiUserOverview {
    pub status: String,
    pub timestamp: u64,
    pub telemetry: GpuTelemetry,
    pub wolf_online: bool,
    pub nas_mounted: bool,
    pub nas_path: String,
    pub nas_mountpoint: String,
    pub active_sessions_count: usize,
    pub registered_users_count: usize,
    pub sessions: Vec<ActiveSession>,
    pub users: Vec<UserRecord>,
    #[serde(default)]
    pub admission: Option<AdmissionStatus>,
    #[serde(default)]
    pub settings: Option<HashMap<String, String>>,
    #[serde(default)]
    pub storage: Option<StorageTelemetry>,
    #[serde(default)]
    pub vpn_peers: Vec<VpnPeer>,
    #[serde(default)]
    pub savegames: Vec<SavegameManifest>,
    /// Moonlight clients waiting for a pairing PIN (Wolf).
    #[serde(default)]
    pub pair_pending: Vec<PendingPairing>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingPairing {
    pub client_ip: String,
    #[serde(default)]
    pub target: String,
    #[serde(default)]
    pub username: Option<String>,
}

pub fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

pub fn fallback_overview() -> MultiUserOverview {
    let now = current_timestamp();
    let mut default_settings = HashMap::new();
    default_settings.insert("max_concurrent_streams".into(), "2".into());
    default_settings.insert("savegames_storage_type".into(), "nas".into());
    default_settings.insert("savegames_nas_path".into(), String::new());
    default_settings.insert("savegames_auto_sync".into(), "true".into());
    default_settings.insert("retention_recordings_days".into(), "0".into());
    default_settings.insert("retention_saves_max_snapshots".into(), "0".into());
    default_settings.insert("wireguard_enabled".into(), "true".into());
    default_settings.insert("wireguard_subnet".into(), "10.66.0.0/24".into());
    default_settings.insert("wireguard_endpoint".into(), "omarchy.local:51820".into());

    MultiUserOverview {
        status: "ok".into(),
        timestamp: now,
        telemetry: GpuTelemetry::default(),
        wolf_online: false,
        nas_mounted: false,
        nas_path: String::new(),
        nas_mountpoint: String::new(),
        active_sessions_count: 0,
        registered_users_count: 2,
        sessions: Vec::new(),
        users: vec![
            UserRecord {
                id: 1,
                username: "owner".into(),
                display_name: "Host Principale (Sunshine)".into(),
                pin: "0000".into(),
                role: "owner".into(),
                allowed_apps: vec!["desktop".into(), "steam".into(), "all".into()],
                allowed_nodes: vec!["*".into()],
                max_bitrate_mbps: 40,
                status: "active".into(),
                created_at: now.saturating_sub(86400 * 7),
                auto_record: false,
                storage_limit_gb: 0.0,
                storage_used_gb: None,
                storage_quota_active: false,
            },
            UserRecord {
                id: 2,
                username: "ospite1".into(),
                display_name: "Ospite Gaming".into(),
                pin: "4321".into(),
                role: "guest".into(),
                allowed_apps: vec!["steam".into()],
                allowed_nodes: vec![],
                max_bitrate_mbps: 20,
                status: "active".into(),
                created_at: now.saturating_sub(86400 * 2),
                auto_record: false,
                storage_limit_gb: 0.0,
                storage_used_gb: None,
                storage_quota_active: false,
            },
        ],
        admission: Some(AdmissionStatus {
            admitted: true,
            active_streams: 0,
            max_concurrent_streams: 2,
            free_vram_mb: 4096,
            requested_vram_mb: 600,
            reason: "Nessuna sessione attiva".into(),
        }),
        settings: Some(default_settings),
        storage: Some(StorageTelemetry {
            nas_mounted: false,
            nas_path: String::new(),
            nas_mountpoint: String::new(),
            storage_type: "nas".into(),
            max_concurrent_streams: 2,
            vpn_peers_count: 0,
            savegame_snapshots_count: 0,
            retention_recordings_days: 0,
            nas_total_gb: 0.0,
            nas_free_gb: 0.0,
            recordings_mb: 0.0,
            recordings_count: 0,
            user_saves_breakdown: Vec::new(),
        }),
        vpn_peers: Vec::new(),
        savegames: Vec::new(),
        pair_pending: Vec::new(),
    }
}

pub fn execute_broker_remote(
    vm_host: &str,
    ssh_user: &str,
    args: &[&str],
) -> Result<String, String> {
    if vm_host.trim().is_empty() {
        return Err("Indirizzo o hostname VM non specificato".into());
    }
    let target = if ssh_user.trim().is_empty() {
        vm_host.to_string()
    } else {
        format!("{ssh_user}@{vm_host}")
    };

    let mut command_line = "omarchy-session-broker".to_string();
    for arg in args {
        command_line.push(' ');
        command_line.push_str(&format!("'{arg}'"));
    }

    let mut cmd = Command::new("ssh");
    cmd.args([
        "-o", "StrictHostKeyChecking=accept-new",
        "-o", "ConnectTimeout=4",
    ]);

    let password = std::env::var("OMARCHY_SSH_PASSWORD").ok().filter(|p| !p.trim().is_empty());

    if let Some(pwd) = password {
        // Enforce password auth so SSH doesn't offer restricted keys like voxtype
        cmd.args(["-o", "PubkeyAuthentication=no"]);
        if let Ok(exe) = std::env::current_exe() {
            cmd.env("SSH_ASKPASS", exe)
                .env("SSH_ASKPASS_REQUIRE", "force")
                .env("OMARCHY_ASKPASS_MODE", "1")
                .env("OMARCHY_SSH_PASSWORD", &pwd)
                .stdin(std::process::Stdio::null());
            if std::env::var_os("DISPLAY").is_none() {
                cmd.env("DISPLAY", ":0");
            }
        }
    } else {
        if let Some(home) = std::env::var_os("HOME").map(std::path::PathBuf::from) {
            let key = home.join(".ssh").join("id_ed25519");
            if key.is_file() {
                cmd.arg("-i").arg(key).args(["-o", "IdentitiesOnly=yes"]);
            }
        }
        cmd.args(["-o", "BatchMode=yes"]);
    }

    cmd.arg(&target).arg(&command_line);

    let output = cmd.output()
        .map_err(|e| format!("Impossibile invocare SSH: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Errore esecuzione remota broker: {stderr}"));
    }

    String::from_utf8(output.stdout)
        .map_err(|e| format!("Risposta non UTF-8 dal broker remoto: {e}"))
}

/// Errore HTTP del broker. `retryable` è vero solo quando la richiesta non ha
/// mai raggiunto il broker (DNS/connessione rifiutata): in quel caso è sicuro
/// ripeterla su un altro percorso senza eseguire due volte l'operazione.
pub struct BrokerHttpError {
    pub message: String,
    pub retryable: bool,
}

pub fn execute_broker_http(
    host: &str,
    port: u16,
    token: Option<&str>,
    method: &str,
    path: &str,
    body: Option<&serde_json::Value>,
    timeout: std::time::Duration,
) -> Result<String, BrokerHttpError> {
    let fail = |message: String, retryable: bool| BrokerHttpError { message, retryable };
    if host.trim().is_empty() {
        return Err(fail("Host non specificato".into(), true));
    }
    let url = format!("http://{}:{}{}", host.trim(), port, path);
    if !matches!(method, "GET" | "POST" | "PUT" | "DELETE") {
        return Err(fail(format!("Metodo HTTP non supportato: {method}"), false));
    }
    // Connessione rapida: se l'host non risponde passiamo subito al percorso
    // alternativo; il tempo di risposta invece dipende dall'operazione.
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_millis(1500))
        .timeout(timeout)
        .build();
    let mut req = agent.request(method, &url);
    if let Some(tok) = token.filter(|t| !t.trim().is_empty()) {
        req = req.set("Authorization", &format!("Bearer {}", tok.trim()));
    }

    let resp = if let Some(payload) = body {
        req.set("Content-Type", "application/json").send_json(payload)
    } else {
        req.call()
    };

    match resp {
        Ok(res) => res
            .into_string()
            .map_err(|e| fail(format!("Errore decodifica risposta HTTP: {e}"), false)),
        Err(ureq::Error::Status(code, res)) => {
            let err_body = res.into_string().unwrap_or_default();
            Err(fail(format!("Errore HTTP {code}: {err_body}"), false))
        }
        Err(ureq::Error::Transport(e)) => {
            let retryable = matches!(
                e.kind(),
                ureq::ErrorKind::Dns | ureq::ErrorKind::ConnectionFailed
            );
            Err(fail(format!("Errore connessione HTTP ({url}): {e}"), retryable))
        }
    }
}

pub fn dispatch_broker_call(
    vm_host: &str,
    ssh_user: &str,
    http_method: &str,
    http_path: &str,
    http_body: Option<serde_json::Value>,
    ssh_args: &[&str],
) -> Result<String, String> {
    dispatch_broker_call_with_timeout(
        vm_host,
        ssh_user,
        http_method,
        http_path,
        http_body,
        ssh_args,
        std::time::Duration::from_secs(if http_method == "GET" { 3 } else { 20 }),
    )
}

pub fn dispatch_broker_call_with_timeout(
    vm_host: &str,
    ssh_user: &str,
    http_method: &str,
    http_path: &str,
    http_body: Option<serde_json::Value>,
    ssh_args: &[&str],
    timeout: std::time::Duration,
) -> Result<String, String> {
    if vm_host.trim().is_empty() {
        return Err("Indirizzo o hostname VM non specificato".into());
    }

    let api_port: u16 = std::env::var("OMARCHY_API_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(47995);
    let api_token = std::env::var("OMARCHY_API_TOKEN").ok();

    let http_err = match execute_broker_http(
        vm_host,
        api_port,
        api_token.as_deref(),
        http_method,
        http_path,
        http_body.as_ref(),
        timeout,
    ) {
        Ok(res) => return Ok(res),
        Err(err) => err,
    };
    // Il broker ha ricevuto la richiesta (risposta di errore o timeout in
    // lettura): ripeterla via VPN/SSH eseguirebbe l'azione una seconda volta.
    if !http_err.retryable {
        return Err(http_err.message);
    }

    // Host primario irraggiungibile (es. usciti dalla LAN): auto-roaming su WireGuard
    if vm_host.trim() != "10.66.0.1" {
        match execute_broker_http(
            "10.66.0.1",
            api_port,
            api_token.as_deref(),
            http_method,
            http_path,
            http_body.as_ref(),
            timeout,
        ) {
            Ok(vpn_res) => return Ok(vpn_res),
            Err(vpn_err) if !vpn_err.retryable => return Err(vpn_err.message),
            Err(_) => {}
        }
    }

    execute_broker_remote(vm_host, ssh_user, ssh_args).map_err(|ssh_err| {
        format!(
            "Chiamata API REST fallita ({}); fallback SSH fallito ({ssh_err})",
            http_err.message
        )
    })
}

pub fn get_status(
    vm_host: &str,
    ssh_user: &str,
    use_fallback: bool,
) -> Result<MultiUserOverview, String> {
    if vm_host.trim().is_empty() {
        return Ok(fallback_overview());
    }

    match dispatch_broker_call(vm_host, ssh_user, "GET", "/api/status", None, &["status-json"]) {
        Ok(json_str) => serde_json::from_str::<MultiUserOverview>(&json_str)
            .map_err(|e| format!("Errore nel parsing stato JSON: {e}")),
        Err(err) => {
            if use_fallback {
                Ok(fallback_overview())
            } else {
                Err(err)
            }
        }
    }
}

pub fn create_user(
    vm_host: &str,
    ssh_user: &str,
    username: &str,
    display_name: &str,
    pin: &str,
    role: &str,
    apps: &[String],
    max_bitrate_mbps: u32,
    allowed_nodes: &[String],
    auto_record: bool,
    storage_limit_gb: f64,
) -> Result<String, String> {
    if username.trim().is_empty() || pin.trim().is_empty() {
        return Err("Username e PIN sono obbligatori".into());
    }

    let mut args: Vec<String> = vec![
        "add-user".into(),
        "--username".into(),
        username.into(),
        "--display".into(),
        display_name.into(),
        "--pin".into(),
        pin.into(),
        "--role".into(),
        role.into(),
        "--bitrate".into(),
        max_bitrate_mbps.to_string(),
        "--storage-gb".into(),
        storage_limit_gb.to_string(),
    ];
    if !apps.is_empty() {
        args.push("--apps".into());
        for app in apps {
            args.push(app.clone());
        }
    }
    if !allowed_nodes.is_empty() {
        args.push("--allowed-nodes".into());
        for node in allowed_nodes {
            args.push(node.clone());
        }
    }
    if auto_record {
        args.push("--auto-record".into());
    }

    if vm_host.trim().is_empty() {
        return Ok(format!(
            "Utente '{display_name}' ({username}) registrato localmente nel profilo simulato"
        ));
    }

    let str_args: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let body = serde_json::json!({
        "username": username,
        "display_name": display_name,
        "pin": pin,
        "role": role,
        "apps": apps,
        "max_bitrate_mbps": max_bitrate_mbps,
        "allowed_nodes": allowed_nodes,
        "auto_record": auto_record,
        "storage_limit_gb": storage_limit_gb,
    });
    dispatch_broker_call(vm_host, ssh_user, "POST", "/api/users", Some(body), &str_args)
        .map_err(humanize_broker_error)
}

/// Turns "Errore HTTP 400: {\"status\":\"error\",\"message\":\"...\"}" into the message.
pub fn humanize_broker_error(err: String) -> String {
    err.find('{')
        .and_then(|i| serde_json::from_str::<serde_json::Value>(&err[i..]).ok())
        .and_then(|v| {
            v.get("message")
                .or_else(|| v.get("error"))
                .and_then(|m| m.as_str())
                .map(str::to_owned)
        })
        .unwrap_or(err)
}

/// Pairs a Moonlight client with Sunshine (owner desktop) or Wolf (guest
/// sandboxes). The broker refuses to pair a guest with Sunshine and binds the
/// paired client IP to `username` so sessions are attributed correctly.
pub fn pair_moonlight_device(
    vm_host: &str,
    ssh_user: &str,
    pin: &str,
    name: Option<&str>,
    target: Option<&str>,
    username: Option<&str>,
    client_ip: Option<&str>,
) -> Result<String, String> {
    let clean_pin = pin.trim();
    if clean_pin.len() != 4 || !clean_pin.chars().all(|c| c.is_ascii_digit()) {
        return Err("Il PIN deve essere esattamente di 4 cifre numeriche".into());
    }
    let client_name = name.unwrap_or("Client").trim();
    let effective_name = if client_name.is_empty() { "Client" } else { client_name };
    let effective_target = match target.map(str::trim) {
        Some(t @ ("sunshine" | "wolf" | "auto")) => t,
        None | Some("") => "auto",
        Some(other) => return Err(format!("Destinazione di pairing non valida: {other}")),
    };
    let username = username.map(str::trim).filter(|u| !u.is_empty());
    let client_ip = client_ip.map(str::trim).filter(|ip| !ip.is_empty());
    let body = serde_json::json!({
        "pin": clean_pin,
        "name": effective_name,
        "target": effective_target,
        "username": username,
        "client_ip": client_ip,
    });
    let mut str_args = vec!["pair", "--pin", clean_pin, "--name", effective_name, "--target", effective_target];
    if let Some(user) = username {
        str_args.extend(["--username", user]);
    }
    if let Some(ip) = client_ip {
        str_args.extend(["--client-ip", ip]);
    }
    dispatch_broker_call(vm_host, ssh_user, "POST", "/api/pair", Some(body), &str_args)
        .map_err(humanize_broker_error)
}

fn broker_http(
    vm_host: &str,
    method: &str,
    path: &str,
    timeout: std::time::Duration,
) -> Result<String, String> {
    let api_port: u16 = std::env::var("OMARCHY_API_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(47995);
    let api_token = std::env::var("OMARCHY_API_TOKEN").ok();
    let mut last_err = String::from("Host non specificato");
    for host in [vm_host.trim(), "10.66.0.1"] {
        if host.is_empty() {
            continue;
        }
        match execute_broker_http(host, api_port, api_token.as_deref(), method, path, None, timeout) {
            Ok(raw) => return Ok(raw),
            Err(err) if err.retryable => last_err = err.message,
            Err(err) => return Err(humanize_broker_error(err.message)),
        }
    }
    Err(last_err)
}

pub fn json_request(vm_host: &str, path: &str, body: serde_json::Value, timeout_s: u64) -> Result<serde_json::Value, String> {
    let port = std::env::var("OMARCHY_API_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(47995);
    let token = std::env::var("OMARCHY_API_TOKEN").ok();
    let mut last = String::from("Nodo non raggiungibile");
    for host in [vm_host.trim(), "10.66.0.1"] {
        match execute_broker_http(host, port, token.as_deref(), "POST", path, Some(&body), std::time::Duration::from_secs(timeout_s)) {
            Ok(raw) => {
                let value: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
                if value["status"] != "ok" {
                    return Err(value["message"].as_str().unwrap_or("Operazione non riuscita").into());
                }
                return Ok(value);
            }
            Err(err) if err.retryable => last = err.message,
            Err(err) => return Err(humanize_broker_error(err.message)),
        }
    }
    Err(last)
}

/// Recorded sessions on the NAS / local spool (GET /api/recordings).
pub fn list_recordings(vm_host: &str, username: Option<&str>) -> Result<serde_json::Value, String> {
    let path = match username.filter(|u| !u.trim().is_empty()) {
        Some(user) => format!("/api/recordings?username={}", urlencode(user.trim())),
        None => "/api/recordings".to_string(),
    };
    // ffprobe runs on files not probed yet: allow a slow first listing.
    let raw = broker_http(vm_host, "GET", &path, std::time::Duration::from_secs(60))?;
    serde_json::from_str(&raw).map_err(|e| format!("Risposta broker non valida: {e}"))
}

pub fn delete_recording(vm_host: &str, recording_id: &str) -> Result<String, String> {
    let raw = broker_http(
        vm_host,
        "DELETE",
        &format!("/api/recordings?id={}", urlencode(recording_id)),
        std::time::Duration::from_secs(15),
    )?;
    Ok(humanize_broker_error(raw))
}

pub struct RangeReply {
    pub status: u16,
    pub content_type: String,
    pub content_range: Option<String>,
    pub body: Vec<u8>,
}

/// One bounded Range read of a recording, for the `omarchy-rec://` protocol.
/// Open-ended ranges are capped at `max_len` so a multi-GB file is never held
/// in memory; the media player simply asks for the next range.
pub fn fetch_recording_range(
    vm_host: &str,
    recording_id: &str,
    range: Option<&str>,
    max_len: u64,
) -> Result<RangeReply, String> {
    use std::io::Read;

    let (start, end) = match range.and_then(|r| r.trim().strip_prefix("bytes=")) {
        Some(spec) => {
            let (a, b) = spec.split_once('-').unwrap_or((spec, ""));
            let start: u64 = a.trim().parse().unwrap_or(0);
            let end = b.trim().parse::<u64>().ok();
            (start, end.map(|e| e.min(start + max_len - 1)).unwrap_or(start + max_len - 1))
        }
        None => (0, max_len - 1),
    };
    let api_port: u16 = std::env::var("OMARCHY_API_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(47995);
    let token = std::env::var("OMARCHY_API_TOKEN").unwrap_or_default();
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_millis(1500))
        .timeout(std::time::Duration::from_secs(30))
        .build();
    let mut last_err = String::new();
    for host in [vm_host.trim(), "10.66.0.1"] {
        let url = format!(
            "http://{host}:{api_port}/api/recordings/stream?id={}",
            urlencode(recording_id)
        );
        let mut req = agent.get(&url).set("Range", &format!("bytes={start}-{end}"));
        if !token.trim().is_empty() {
            req = req.set("Authorization", &format!("Bearer {}", token.trim()));
        }
        match req.call() {
            Ok(res) | Err(ureq::Error::Status(_, res)) => {
                let status = res.status();
                let content_type = res.header("Content-Type").unwrap_or("video/mp4").to_string();
                let content_range = res.header("Content-Range").map(str::to_owned);
                let mut body = Vec::new();
                res.into_reader()
                    .take(max_len)
                    .read_to_end(&mut body)
                    .map_err(|e| format!("Lettura registrazione interrotta: {e}"))?;
                return Ok(RangeReply { status, content_type, content_range, body });
            }
            Err(ureq::Error::Transport(e)) => {
                last_err = format!("Broker non raggiungibile: {e}");
                if !matches!(e.kind(), ureq::ErrorKind::Dns | ureq::ErrorKind::ConnectionFailed) {
                    break;
                }
            }
        }
    }
    Err(last_err)
}

/// Streams a whole recording from the broker into `dest` (via `dest.part`,
/// renamed only when complete). `on_progress(received, total)` is called about
/// every MiB; returning false or setting `cancel` aborts and removes the part file.
pub fn download_recording(
    vm_host: &str,
    recording_id: &str,
    dest: &std::path::Path,
    cancel: &std::sync::atomic::AtomicBool,
    on_progress: impl FnMut(u64, Option<u64>) -> bool,
) -> Result<u64, String> {
    download_file(vm_host, &format!("/api/recordings/stream?id={}", urlencode(recording_id)), dest, cancel, on_progress)
}

pub fn download_file(
    vm_host: &str,
    http_path: &str,
    dest: &std::path::Path,
    cancel: &std::sync::atomic::AtomicBool,
    mut on_progress: impl FnMut(u64, Option<u64>) -> bool,
) -> Result<u64, String> {
    use std::io::{Read, Write};
    use std::sync::atomic::Ordering;

    let api_port: u16 = std::env::var("OMARCHY_API_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(47995);
    let token = std::env::var("OMARCHY_API_TOKEN").unwrap_or_default();
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_millis(1500))
        .timeout_read(std::time::Duration::from_secs(30))
        .build();
    let mut last_err = String::from("Host non specificato");
    let mut response = None;
    for host in [vm_host.trim(), "10.66.0.1"] {
        if host.is_empty() {
            continue;
        }
        let url = format!("http://{host}:{api_port}{http_path}");
        let mut req = agent.get(&url);
        if !token.trim().is_empty() {
            req = req.set("Authorization", &format!("Bearer {}", token.trim()));
        }
        match req.call() {
            Ok(res) => {
                response = Some(res);
                break;
            }
            Err(ureq::Error::Status(code, res)) => {
                return Err(humanize_broker_error(format!(
                    "Download rifiutato (HTTP {code}): {}",
                    res.into_string().unwrap_or_default()
                )))
            }
            Err(ureq::Error::Transport(e)) => {
                last_err = format!("Broker non raggiungibile: {e}");
                if !matches!(e.kind(), ureq::ErrorKind::Dns | ureq::ErrorKind::ConnectionFailed) {
                    return Err(last_err);
                }
            }
        }
    }
    let response = response.ok_or(last_err)?;
    let total = response.header("Content-Length").and_then(|v| v.parse::<u64>().ok());
    let part = dest.with_extension("mp4.part");
    let result = (|| -> Result<u64, String> {
        let mut file = std::fs::File::create(&part).map_err(|e| format!("Impossibile creare {}: {e}", part.display()))?;
        let mut reader = response.into_reader();
        let mut buf = vec![0u8; 256 * 1024];
        let (mut received, mut reported) = (0u64, 0u64);
        loop {
            if cancel.load(Ordering::Relaxed) {
                return Err("Download annullato".into());
            }
            let n = reader.read(&mut buf).map_err(|e| format!("Download interrotto: {e}"))?;
            if n == 0 {
                break;
            }
            file.write_all(&buf[..n]).map_err(|e| format!("Scrittura su disco fallita: {e}"))?;
            received += n as u64;
            if received - reported >= 1024 * 1024 {
                reported = received;
                if !on_progress(received, total) {
                    return Err("Download annullato".into());
                }
            }
        }
        file.sync_all().map_err(|e| format!("Scrittura su disco fallita: {e}"))?;
        if let Some(expected) = total {
            if received != expected {
                return Err(format!("Download incompleto: {received} di {expected} byte"));
            }
        }
        on_progress(received, total);
        Ok(received)
    })();
    match result {
        Ok(bytes) => {
            std::fs::rename(&part, dest).map_err(|e| format!("Impossibile salvare {}: {e}", dest.display()))?;
            Ok(bytes)
        }
        Err(err) => {
            let _ = std::fs::remove_file(&part);
            Err(err)
        }
    }
}

pub fn urlencode(value: &str) -> String {
    value
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

pub fn edit_user(
    vm_host: &str,
    ssh_user: &str,
    username: &str,
    new_username: Option<&str>,
    display_name: Option<&str>,
    pin: Option<&str>,
    role: Option<&str>,
    apps: Option<&[String]>,
    max_bitrate_mbps: Option<u32>,
    allowed_nodes: Option<&[String]>,
    auto_record: Option<bool>,
    storage_limit_gb: Option<f64>,
) -> Result<String, String> {
    if username.trim().is_empty() {
        return Err("Username non specificato".into());
    }

    let mut args: Vec<String> = vec![
        "edit-user".into(),
        "--username".into(),
        username.into(),
    ];

    if let Some(new_user) = new_username {
        if !new_user.trim().is_empty() {
            args.push("--new-username".into());
            args.push(new_user.into());
        }
    }
    if let Some(disp) = display_name {
        if !disp.trim().is_empty() {
            args.push("--display".into());
            args.push(disp.into());
        }
    }
    if let Some(p) = pin {
        if !p.trim().is_empty() {
            args.push("--pin".into());
            args.push(p.into());
        }
    }
    if let Some(r) = role {
        if !r.trim().is_empty() {
            args.push("--role".into());
            args.push(r.into());
        }
    }
    if let Some(bitrate) = max_bitrate_mbps {
        args.push("--bitrate".into());
        args.push(bitrate.to_string());
    }
    if let Some(app_list) = apps {
        if !app_list.is_empty() {
            args.push("--apps".into());
            for app in app_list {
                args.push(app.clone());
            }
        }
    }
    if let Some(nodes) = allowed_nodes {
        if !nodes.is_empty() {
            args.push("--allowed-nodes".into());
            for node in nodes {
                args.push(node.clone());
            }
        }
    }
    if let Some(ar) = auto_record {
        if ar {
            args.push("--auto-record".into());
        } else {
            args.push("--no-auto-record".into());
        }
    }
    if let Some(limit) = storage_limit_gb {
        args.extend(["--storage-gb".into(), limit.to_string()]);
    }

    if vm_host.trim().is_empty() {
        return Ok(format!("Utente '{username}' aggiornato nel profilo simulato"));
    }

    let str_args: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let mut body = serde_json::json!({
        "new_username": new_username,
        "display_name": display_name,
        "pin": pin,
        "role": role,
        "apps": apps,
        "max_bitrate_mbps": max_bitrate_mbps,
        "allowed_nodes": allowed_nodes,
    });
    if let Some(ar) = auto_record {
        body["auto_record"] = serde_json::json!(ar);
    }
    if let Some(limit) = storage_limit_gb {
        body["storage_limit_gb"] = serde_json::json!(limit);
    }
    let path = format!("/api/users/{username}");
    dispatch_broker_call(vm_host, ssh_user, "PUT", &path, Some(body), &str_args)
        .map_err(humanize_broker_error)
}

pub fn delete_user(
    vm_host: &str,
    ssh_user: &str,
    username: &str,
    archive: bool,
) -> Result<String, String> {
    if username.trim().is_empty() {
        return Err("Username non specificato".into());
    }
    let mut args = vec!["remove-user", "--username", username];
    if archive {
        args.push("--archive");
    }

    if vm_host.trim().is_empty() {
        return Ok(format!(
            "Utente '{username}' rimosso dal profilo simulato"
        ));
    }

    let path = format!("/api/users/{username}");
    dispatch_broker_call(vm_host, ssh_user, "DELETE", &path, None, &args)
}

pub fn ban_user(
    vm_host: &str,
    ssh_user: &str,
    username: &str,
    reason: &str,
) -> Result<String, String> {
    if username.trim().is_empty() {
        return Err("Username non specificato".into());
    }
    let args = vec!["ban-user", "--username", username, "--reason", reason];

    if vm_host.trim().is_empty() {
        return Ok(format!(
            "Utente '{username}' bannato nel profilo simulato (sessioni disconnesse, dati preservati)"
        ));
    }

    let body = serde_json::json!({ "reason": reason });
    let path = format!("/api/users/{username}/ban");
    dispatch_broker_call_with_timeout(vm_host, ssh_user, "POST", &path, Some(body), &args,
                                     std::time::Duration::from_secs(20))
}

pub fn unban_user(
    vm_host: &str,
    ssh_user: &str,
    username: &str,
) -> Result<String, String> {
    if username.trim().is_empty() {
        return Err("Username non specificato".into());
    }
    let args = vec!["unban-user", "--username", username];

    if vm_host.trim().is_empty() {
        return Ok(format!(
            "Utente '{username}' riabilitato con successo nel profilo simulato"
        ));
    }

    let path = format!("/api/users/{username}/unban");
    dispatch_broker_call(vm_host, ssh_user, "POST", &path, Some(serde_json::json!({})), &args)
}

pub fn terminate_session(
    vm_host: &str,
    ssh_user: &str,
    session_id: &str,
    reason: &str,
) -> Result<String, String> {
    if session_id.trim().is_empty() {
        return Err("ID sessione non specificato".into());
    }
    let args = vec!["kill-session", "--id", session_id, "--reason", reason];

    if vm_host.trim().is_empty() {
        return Ok(format!("Sessione '{session_id}' terminata con successo"));
    }

    let body = serde_json::json!({ "reason": reason });
    let path = format!("/api/sessions/{session_id}/kill");
    // Il kill ferma registrazione/live e riavvia Sunshine: servono alcuni secondi.
    dispatch_broker_call_with_timeout(
        vm_host,
        ssh_user,
        "POST",
        &path,
        Some(body),
        &args,
        std::time::Duration::from_secs(20),
    )
}

pub fn takeover_session(
    vm_host: &str,
    ssh_user: &str,
    session_id: &str,
) -> Result<String, String> {
    if session_id.trim().is_empty() {
        return Err("ID sessione non specificato".into());
    }
    let args = vec!["shadow-session", "--id", session_id];

    if vm_host.trim().is_empty() {
        return Ok(format!(
            "Controllo sessione '{session_id}' acquisito. Connessione spectator/takeover attiva."
        ));
    }

    let path = format!("/api/sessions/{session_id}/takeover");
    dispatch_broker_call(vm_host, ssh_user, "POST", &path, Some(serde_json::json!({})), &args)
}

pub fn spectate_session(
    vm_host: &str,
    ssh_user: &str,
    session_id: &str,
) -> Result<String, String> {
    if session_id.trim().is_empty() {
        return Err("ID sessione non specificato".into());
    }
    let args = vec!["spectate-session", "--id", session_id];

    if vm_host.trim().is_empty() {
        return Ok(format!(
            "Visualizzazione passiva della sessione '{session_id}' avviata."
        ));
    }

    let path = format!("/api/sessions/{session_id}/spectate");
    dispatch_broker_call(vm_host, ssh_user, "POST", &path, Some(serde_json::json!({})), &args)
}

pub fn capture_session_frame(
    vm_host: &str,
    session_id: &str,
) -> Result<String, String> {
    if vm_host.trim().is_empty() {
        return Err("Host non specificato".into());
    }
    let api_port: u16 = std::env::var("OMARCHY_API_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(47995);
    let api_token = std::env::var("OMARCHY_API_TOKEN").ok();
    let url = format!("http://{}:{}/api/sessions/{}/preview", vm_host.trim(), api_port, session_id);
    let mut req = ureq::get(&url).timeout(std::time::Duration::from_millis(2500));
    if let Some(tok) = api_token.as_deref().filter(|t| !t.trim().is_empty()) {
        req = req.set("Authorization", &format!("Bearer {}", tok.trim()));
    }
    let resp = req.call().map_err(|e| format!("Errore cattura anteprima: {e}"))?;
    let mut bytes = Vec::new();
    use std::io::Read;
    resp.into_reader().read_to_end(&mut bytes).map_err(|e| format!("Errore lettura frame: {e}"))?;
    use base64::engine::general_purpose::STANDARD as BASE64;
    use base64::Engine;
    Ok(format!("data:image/jpeg;base64,{}", BASE64.encode(&bytes)))
}

pub fn get_session_stream_url(
    vm_host: &str,
    session_id: &str,
) -> String {
    let api_port: u16 = std::env::var("OMARCHY_API_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(47995);
    let token_param = if let Ok(tok) = std::env::var("OMARCHY_API_TOKEN") {
        if !tok.trim().is_empty() {
            format!("?token={}", tok.trim())
        } else {
            String::new()
        }
    } else {
        String::new()
    };
    format!("http://{}:{}/api/sessions/{}/live/stream.m3u8{}", vm_host.trim(), api_port, session_id, token_param)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WhepAnswer {
    pub sdp: String,
    pub resource: String,
}

/// Calls a broker endpoint over HTTP only (no SSH fallback: WebRTC needs the
/// live broker), trying the LAN host first and then the WireGuard address.
fn broker_http_json(
    vm_host: &str,
    path: &str,
    body: &serde_json::Value,
    timeout: std::time::Duration,
) -> Result<serde_json::Value, String> {
    let api_port: u16 = std::env::var("OMARCHY_API_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(47995);
    let api_token = std::env::var("OMARCHY_API_TOKEN").ok();
    let mut last_err = String::from("Host non specificato");
    for host in [vm_host.trim(), "10.66.0.1"] {
        if host.is_empty() {
            continue;
        }
        match execute_broker_http(host, api_port, api_token.as_deref(), "POST", path, Some(body), timeout) {
            Ok(raw) => {
                return serde_json::from_str(&raw)
                    .map_err(|e| format!("Risposta broker non valida: {e}"))
            }
            Err(err) => {
                // HTTP errors carry the broker's JSON message: surface it.
                let message = err
                    .message
                    .split_once(": ")
                    .and_then(|(_, body)| serde_json::from_str::<serde_json::Value>(body).ok())
                    .and_then(|v| {
                        v.get("message")
                            .or_else(|| v.get("error"))
                            .and_then(|m| m.as_str())
                            .map(str::to_owned)
                    })
                    .unwrap_or(err.message);
                if !err.retryable {
                    return Err(message);
                }
                last_err = message;
            }
        }
    }
    Err(last_err)
}

/// WebRTC (WHEP) signalling for the live view, relayed by the broker to
/// MediaMTX. Media then flows peer-to-peer over UDP/TCP 8189.
pub fn whep_offer(vm_host: &str, session_id: &str, sdp: &str, quality: &str) -> Result<WhepAnswer, String> {
    if session_id.trim().is_empty() {
        return Err("ID sessione non specificato".into());
    }
    let res = broker_http_json(
        vm_host,
        &format!("/api/sessions/{session_id}/whep"),
        &serde_json::json!({ "sdp": sdp, "quality": quality }),
        // An on-demand path answers only once the GPU publisher is running.
        std::time::Duration::from_secs(30),
    )?;
    if res.get("status").and_then(|s| s.as_str()) != Some("ok") {
        return Err(res
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("WebRTC non disponibile")
            .to_string());
    }
    Ok(WhepAnswer {
        sdp: res.get("sdp").and_then(|s| s.as_str()).unwrap_or_default().to_string(),
        resource: res
            .get("resource")
            .and_then(|s| s.as_str())
            .unwrap_or_default()
            .to_string(),
    })
}

/// Live pipeline status of a session (capture backend, copy/transcode, codec
/// served by MediaMTX) so the UI can show when a fallback is in use.
pub fn live_info(vm_host: &str, session_id: &str, quality: &str) -> Result<serde_json::Value, String> {
    let api_port: u16 = std::env::var("OMARCHY_API_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(47995);
    let api_token = std::env::var("OMARCHY_API_TOKEN").ok();
    let path = format!("/api/sessions/{session_id}/live/info?quality={}", urlencode(quality));
    let mut last_err = String::from("Host non specificato");
    for host in [vm_host.trim(), "10.66.0.1"] {
        if host.is_empty() {
            continue;
        }
        match execute_broker_http(host, api_port, api_token.as_deref(), "GET", &path, None, std::time::Duration::from_secs(5)) {
            Ok(raw) => return serde_json::from_str(&raw).map_err(|e| format!("Risposta broker non valida: {e}")),
            Err(err) if err.retryable => last_err = err.message,
            Err(err) => return Err(err.message),
        }
    }
    Err(last_err)
}

pub fn whep_close(vm_host: &str, session_id: &str, resource: &str) -> Result<(), String> {
    broker_http_json(
        vm_host,
        &format!("/api/sessions/{session_id}/whep/close"),
        &serde_json::json!({ "resource": resource }),
        std::time::Duration::from_secs(5),
    )
    .map(|_| ())
}

/// Streams the broker's low-latency fMP4 feed (`/live.mp4`) into `on_chunk`
/// until `stop` is set, the viewer's channel closes or the host ends the feed.
/// Raw chunks reach the webview as `ArrayBuffer`s for Media Source Extensions;
/// going through Rust avoids the page CSP and keeps the API token out of URLs.
pub fn stream_live_video(
    vm_host: &str,
    session_id: &str,
    quality: &str,
    stop: &std::sync::atomic::AtomicBool,
    mut on_chunk: impl FnMut(Vec<u8>) -> bool,
) -> Result<(), String> {
    use std::io::Read;
    use std::sync::atomic::Ordering;

    if vm_host.trim().is_empty() {
        return Err("Host non specificato".into());
    }
    if session_id.trim().is_empty() {
        return Err("ID sessione non specificato".into());
    }
    let api_port: u16 = std::env::var("OMARCHY_API_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(47995);
    let api_token = std::env::var("OMARCHY_API_TOKEN").ok();
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_millis(1500))
        // MediaMTX can spend 25s starting an on-demand publisher. The old 8s
        // deadline killed it before its first keyframe, then repeated forever.
        .timeout_read(std::time::Duration::from_secs(30))
        .build();

    let mut last_err = String::new();
    let mut response = None;
    for host in [vm_host.trim(), "10.66.0.1"] {
        if stop.load(Ordering::Relaxed) { return Ok(()); }
        let url = format!("http://{host}:{api_port}/api/sessions/{session_id}/live.mp4?quality={}", urlencode(quality));
        let mut req = agent.get(&url);
        if let Some(tok) = api_token.as_deref().filter(|t| !t.trim().is_empty()) {
            req = req.set("Authorization", &format!("Bearer {}", tok.trim()));
        }
        match req.call() {
            Ok(res) => {
                response = Some(res);
                break;
            }
            Err(ureq::Error::Status(code, res)) => {
                let body = res.into_string().unwrap_or_default();
                let message = serde_json::from_str::<serde_json::Value>(&body)
                    .ok()
                    .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(str::to_owned))
                    .unwrap_or(body);
                return Err(format!("Video live non disponibile (HTTP {code}): {message}"));
            }
            Err(ureq::Error::Transport(e)) => {
                last_err = format!("Errore connessione video live ({url}): {e}");
                if !matches!(e.kind(), ureq::ErrorKind::Dns | ureq::ErrorKind::ConnectionFailed) {
                    return Err(last_err);
                }
            }
        }
    }
    let response = response.ok_or(last_err)?;

    let mut reader = response.into_reader();
    let mut buf = vec![0u8; 64 * 1024];
    while !stop.load(Ordering::Relaxed) {
        let n = reader
            .read(&mut buf)
            .map_err(|e| format!("Video live interrotto: {e}"))?;
        if n == 0 {
            return Err("L'host ha chiuso il video live (encoder non avviato?)".into());
        }
        if !on_chunk(buf[..n].to_vec()) {
            break;
        }
    }
    Ok(())
}

pub fn stop_session_stream(
    vm_host: &str,
    ssh_user: &str,
    session_id: &str,
) -> Result<String, String> {
    if session_id.trim().is_empty() {
        return Err("ID sessione non specificato".into());
    }
    if vm_host.trim().is_empty() {
        return Ok(format!("Live stream '{session_id}' interrotto."));
    }
    let path = format!("/api/sessions/{session_id}/live/stop");
    let args = vec!["live-stop", "--id", session_id];
    dispatch_broker_call(vm_host, ssh_user, "POST", &path, Some(serde_json::json!({})), &args)
}


pub fn start_session_recording(
    vm_host: &str,
    ssh_user: &str,
    session_id: &str,
) -> Result<String, String> {
    if session_id.trim().is_empty() {
        return Err("ID sessione non specificato".into());
    }
    let args = vec!["start-recording", "--id", session_id];

    if vm_host.trim().is_empty() {
        return Ok(format!(
            "Registrazione sessione '{session_id}' avviata in H.265/HEVC (Massima Efficienza) su NAS Samba (smb://192.168.0.39/nvme1/omarchy-recordings)"
        ));
    }

    let path = format!("/api/sessions/{session_id}/recording/start");
    dispatch_broker_call(vm_host, ssh_user, "POST", &path, Some(serde_json::json!({})), &args)
}

pub fn stop_session_recording(
    vm_host: &str,
    ssh_user: &str,
    session_id: &str,
) -> Result<String, String> {
    if session_id.trim().is_empty() {
        return Err("ID sessione non specificato".into());
    }
    let args = vec!["stop-recording", "--id", session_id];

    if vm_host.trim().is_empty() {
        return Ok(format!(
            "Registrazione H.265/HEVC della sessione '{session_id}' completata e archiviata su NAS Samba"
        ));
    }

    let path = format!("/api/sessions/{session_id}/recording/stop");
    dispatch_broker_call(vm_host, ssh_user, "POST", &path, Some(serde_json::json!({})), &args)
}

pub fn install_backend(
    vm_host: &str,
    ssh_user: &str,
) -> Result<String, String> {
    if vm_host.trim().is_empty() {
        return Ok("Backend simulato: directory e configurazioni pronte".into());
    }
    execute_broker_remote(vm_host, ssh_user, &["install-backend"])
}

pub fn get_enterprise_settings(
    vm_host: &str,
    ssh_user: &str,
) -> Result<HashMap<String, String>, String> {
    if vm_host.trim().is_empty() {
        return Ok(fallback_overview().settings.unwrap_or_default());
    }
    let res_json = dispatch_broker_call(vm_host, ssh_user, "GET", "/api/settings", None, &["get-settings"])?;
    serde_json::from_str::<HashMap<String, String>>(&res_json)
        .map_err(|e| format!("Errore nel parsing impostazioni: {e}"))
}

pub fn update_enterprise_setting(
    vm_host: &str,
    ssh_user: &str,
    key: &str,
    value: &str,
) -> Result<String, String> {
    if vm_host.trim().is_empty() {
        return Ok(format!("Impostazione '{key}' = '{value}' aggiornata (simulato)"));
    }
    let body = serde_json::json!({ "key": key, "value": value });
    dispatch_broker_call(vm_host, ssh_user, "POST", "/api/settings", Some(body), &["set-setting", "--key", key, "--value", value])
        .map_err(humanize_broker_error)
}

pub fn check_admission(
    vm_host: &str,
    ssh_user: &str,
    requested_vram: u32,
) -> Result<AdmissionStatus, String> {
    if vm_host.trim().is_empty() {
        return Ok(fallback_overview().admission.unwrap());
    }
    let vram_str = requested_vram.to_string();
    let body = serde_json::json!({ "requested_vram_mb": requested_vram });
    let res_json = dispatch_broker_call(vm_host, ssh_user, "POST", "/api/admission", Some(body), &["check-admission", "--vram", &vram_str])?;
    serde_json::from_str::<AdmissionStatus>(&res_json)
        .map_err(|e| format!("Errore nel parsing stato admission: {e}"))
}

pub fn sync_savegames(
    vm_host: &str,
    ssh_user: &str,
    username: &str,
    direction: &str,
) -> Result<String, String> {
    if username.trim().is_empty() {
        return Err("Username non specificato".into());
    }
    if vm_host.trim().is_empty() {
        return Ok(format!("Salvataggi utente '{username}' sincronizzati con successo ({direction}) su NAS Samba"));
    }
    let body = serde_json::json!({ "username": username, "direction": direction });
    dispatch_broker_call(vm_host, ssh_user, "POST", "/api/saves/sync", Some(body), &["sync-saves", "--username", username, "--direction", direction])
}

pub fn list_savegames(
    vm_host: &str,
    ssh_user: &str,
    username: Option<&str>,
) -> Result<Vec<SavegameManifest>, String> {
    if vm_host.trim().is_empty() {
        return Ok(fallback_overview().savegames);
    }
    let mut args = vec!["list-saves"];
    let path = if let Some(user) = username {
        if !user.trim().is_empty() {
            args.push("--username");
            args.push(user);
            format!("/api/saves?username={user}")
        } else {
            "/api/saves".into()
        }
    } else {
        "/api/saves".into()
    };
    let res_json = dispatch_broker_call(vm_host, ssh_user, "GET", &path, None, &args)?;
    serde_json::from_str::<Vec<SavegameManifest>>(&res_json)
        .map_err(|e| format!("Errore nel parsing lista salvataggi: {e}"))
}

pub fn test_nas_share(
    vm_host: &str,
    ssh_user: &str,
    server: &str,
    share: &str,
    username: Option<&str>,
    password: Option<&str>,
) -> Result<NasTestResult, String> {
    if vm_host.trim().is_empty() {
        return Ok(NasTestResult {
            status: "ok".into(),
            accessible: true,
            server: server.into(),
            share: share.into(),
            port: Some(445),
            latency_ms: Some(3.8),
            auth_type: Some(if username.unwrap_or("").is_empty() { "guest".into() } else { "credentials".into() }),
            message: format!("Simulazione: Server NAS '{server}' accessibile"),
            error: None,
        });
    }
    let body = serde_json::json!({
        "server": server,
        "share": share,
        "username": username.unwrap_or(""),
        "password": password.unwrap_or(""),
    });
    let res_json = dispatch_broker_call(vm_host, ssh_user, "POST", "/api/nas/test", Some(body), &["status-json"])?;
    serde_json::from_str::<NasTestResult>(&res_json)
        .map_err(|e| format!("Errore nel parsing risposta test NAS: {e}"))
}

pub fn mount_nas_share(
    vm_host: &str,
    ssh_user: &str,
    server: &str,
    share: &str,
    mountpoint: &str,
    username: Option<&str>,
    password: Option<&str>,
) -> Result<NasMountResult, String> {
    if vm_host.trim().is_empty() {
        return Ok(NasMountResult {
            status: "ok".into(),
            mounted: true,
            server: server.into(),
            share: share.into(),
            mountpoint: mountpoint.into(),
            total_gb: Some(1860.0),
            free_gb: Some(1150.0),
            message: format!("Simulazione: Storage NAS //{server}/{share} montato"),
            error: None,
        });
    }
    let body = serde_json::json!({
        "server": server,
        "share": share,
        "mountpoint": mountpoint,
        "username": username.unwrap_or(""),
        "password": password.unwrap_or(""),
    });
    let res_json = dispatch_broker_call(vm_host, ssh_user, "POST", "/api/nas/mount", Some(body), &["status-json"])?;
    serde_json::from_str::<NasMountResult>(&res_json)
        .map_err(|e| format!("Errore nel parsing risposta mount NAS: {e}"))
}

pub fn get_tailscale_nodes() -> Result<Vec<TailscaleNode>, String> {
    let output = match Command::new("tailscale").args(&["status", "--json"]).output() {
        Ok(out) => out,
        Err(e) => {
            let fallback_paths = [
                "/usr/local/bin/tailscale",
                "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
                "/usr/bin/tailscale",
            ];
            let mut found = None;
            for p in &fallback_paths {
                if let Ok(out) = Command::new(p).args(&["status", "--json"]).output() {
                    found = Some(out);
                    break;
                }
            }
            match found {
                Some(out) => out,
                None => return Err(format!("Tailscale non trovato o non in esecuzione: {e}")),
            }
        }
    };

    if !output.status.success() {
        let err_msg = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Errore tailscale status: {err_msg}"));
    }

    let val: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Errore nel parsing JSON Tailscale: {e}"))?;

    let mut nodes = Vec::new();

    if let Some(peers) = val.get("Peer").and_then(|p| p.as_object()) {
        for (_k, v) in peers {
            let mut dns_name = v.get("DNSName").and_then(|d| d.as_str()).unwrap_or("").to_string();
            if dns_name.ends_with('.') {
                dns_name.pop();
            }
            let raw_hostname = v.get("HostName").and_then(|h| h.as_str()).unwrap_or("");
            let hostname = if raw_hostname.is_empty() || raw_hostname.eq_ignore_ascii_case("localhost") {
                dns_name.split('.').next().unwrap_or(raw_hostname).to_string()
            } else {
                raw_hostname.to_string()
            };
            let ip = v.get("TailscaleIPs")
                .and_then(|ips| ips.as_array())
                .and_then(|arr| arr.first())
                .and_then(|i| i.as_str())
                .unwrap_or("")
                .to_string();
            let os = v.get("OS").and_then(|o| o.as_str()).unwrap_or("unknown").to_string();
            let online = v.get("Online").and_then(|o| o.as_bool()).unwrap_or(false);

            if !dns_name.is_empty() || !ip.is_empty() {
                nodes.push(TailscaleNode {
                    hostname,
                    dns_name,
                    ip,
                    os,
                    online,
                });
            }
        }
    }

    nodes.sort_by(|a, b| {
        b.online.cmp(&a.online).then_with(|| a.hostname.to_lowercase().cmp(&b.hostname.to_lowercase()))
    });

    Ok(nodes)
}

pub fn create_vpn_peer(
    vm_host: &str,
    ssh_user: &str,
    username: &str,
    client_name: &str,
) -> Result<String, String> {
    if username.trim().is_empty() || client_name.trim().is_empty() {
        return Err("Username e Nome Client sono obbligatori".into());
    }
    if vm_host.trim().is_empty() {
        let dummy = serde_json::json!({
            "status": "ok",
            "peer_id": "peer-sim-new",
            "username": username,
            "client_name": client_name,
            "ip_address": "10.66.0.3",
            "public_key": "K7qO4c5B+SimulatedPeerWireguardKey2026=",
            "config_text": "[Interface]\nPrivateKey = SimPrivKey=\nAddress = 10.66.0.3/32\nDNS = 1.1.1.1\n\n[Peer]\nPublicKey = OmarchyHostServerPascal1050Key2026Base64=\nEndpoint = omarchy.local:51820\nAllowedIPs = 10.66.0.0/24\nPersistentKeepalive = 25\n",
            "config_base64": "W0ludGVyZmFjZV0KUHJpdmF0ZUtleSA9IFNpbVByaXZLZXk9CkFkZHJlc3MgPSAxMC42Ni4wLjMvMzIKRE5TID0gMS4xLjEuMQoKW1BlZXJdClB1YmxpY0tleSA9IE9tYXJjaHlIb3N0U2VydmVyUGFzY2FsMTA1MEtleTIwMjZCYXNlNjQ9CkVuZHBvaW50ID0gb21hcmNoeS5sb2NhbDo1MTgyMApBbGxvd2VkSVBzID0gMTAuNjYuMC4wLzI0ClBlcnNpc3RlbnRLZWVwYWxpdmUgPSAyNQo=",
            "endpoint": "omarchy.local:51820",
            "message": format!("Peer WireGuard '{client_name}' creato con IP 10.66.0.3")
        });
        return Ok(dummy.to_string());
    }
    let body = serde_json::json!({ "username": username, "client_name": client_name });
    dispatch_broker_call(vm_host, ssh_user, "POST", "/api/vpn/peers", Some(body), &["vpn-peer-add", "--username", username, "--client-name", client_name])
}

pub fn list_vpn_peers(
    vm_host: &str,
    ssh_user: &str,
    username: Option<&str>,
) -> Result<Vec<VpnPeer>, String> {
    if vm_host.trim().is_empty() {
        return Ok(fallback_overview().vpn_peers);
    }
    let mut args = vec!["vpn-peer-list"];
    let path = if let Some(user) = username {
        if !user.trim().is_empty() {
            args.push("--username");
            args.push(user);
            format!("/api/vpn/peers?username={user}")
        } else {
            "/api/vpn/peers".into()
        }
    } else {
        "/api/vpn/peers".into()
    };
    let res_json = dispatch_broker_call(vm_host, ssh_user, "GET", &path, None, &args)?;
    serde_json::from_str::<Vec<VpnPeer>>(&res_json)
        .map_err(|e| format!("Errore nel parsing lista peer VPN: {e}"))
}

pub fn delete_vpn_peer(
    vm_host: &str,
    ssh_user: &str,
    peer_id: &str,
) -> Result<String, String> {
    if peer_id.trim().is_empty() {
        return Err("ID peer non specificato".into());
    }
    if vm_host.trim().is_empty() {
        return Ok(format!("Peer VPN '{peer_id}' revocato ed eliminato"));
    }
    let path = format!("/api/vpn/peers/{peer_id}");
    dispatch_broker_call(vm_host, ssh_user, "DELETE", &path, None, &["vpn-peer-del", "--id", peer_id])
}

pub fn prune_nas_storage(
    vm_host: &str,
    ssh_user: &str,
    dry_run: bool,
) -> Result<String, String> {
    if vm_host.trim().is_empty() {
        let dummy = serde_json::json!({
            "status": "ok",
            "dry_run": dry_run,
            "retention_recordings_days": 0,
            "pruned_recordings_count": 0,
            "freed_recordings_mb": 0.0,
            "storage_total_gb": 0.0,
            "storage_free_gb": 0.0,
            "nas_mounted": false
        });
        return Ok(dummy.to_string());
    }
    let mut args = vec!["prune-nas"];
    if dry_run {
        args.push("--dry-run");
    }
    let body = serde_json::json!({ "dry_run": dry_run });
    dispatch_broker_call(vm_host, ssh_user, "POST", "/api/nas/prune", Some(body), &args)
}

pub fn test_vpn_connectivity(target_ip: &str) -> Result<String, String> {
    if target_ip.trim().is_empty() {
        return Err("Indirizzo IP non specificato".into());
    }
    let (cmd, args) = if cfg!(target_os = "windows") {
        ("ping", vec!["-n", "1", "-w", "1000", target_ip])
    } else {
        ("ping", vec!["-c", "1", "-W", "1", target_ip])
    };

    let output = Command::new(cmd)
        .args(&args)
        .output()
        .map_err(|e| format!("Impossibile eseguire ping di test: {e}"))?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let time_info = stdout
            .lines()
            .find(|line| line.contains("time=") || line.contains("tempo="))
            .unwrap_or("Connessione attiva e raggiungibile");
        Ok(format!("WireGuard VPN connesso con successo: {time_info}"))
    } else {
        Err(format!("Nessuna risposta ICMP da {target_ip} (Peer offline o pacchetti bloccati da firewall)"))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DesktopVpnStatus {
    pub connected: bool,
    pub ip_address: String,
    pub latency_ms: Option<u32>,
    pub config_path: String,
    pub message: String,
}

pub fn get_desktop_vpn_status() -> DesktopVpnStatus {
    let conf_path = dirs_config_path();
    let ping_res = test_vpn_connectivity("10.66.0.1");
    let is_connected = ping_res.is_ok();
    let latency = if let Ok(ref msg) = ping_res {
        parse_ping_latency(msg)
    } else {
        None
    };

    DesktopVpnStatus {
        connected: is_connected,
        ip_address: if is_connected { "10.66.0.X".into() } else { "".into() },
        latency_ms: latency,
        config_path: conf_path.display().to_string(),
        message: if is_connected {
            "Tunnel WireGuard attivo e connesso al gateway della sandbox (10.66.0.1)".into()
        } else {
            "Tunnel WireGuard desktop non attivo".into()
        },
    }
}

pub fn connect_desktop_vpn(
    vm_host: &str,
    ssh_user: &str,
    username: &str,
) -> Result<DesktopVpnStatus, String> {
    let conf_path = dirs_config_path();
    if let Some(parent) = conf_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    // 1. Controlla se il gateway VPN è già raggiungibile
    if let Ok(msg) = test_vpn_connectivity("10.66.0.1") {
        return Ok(DesktopVpnStatus {
            connected: true,
            ip_address: "10.66.0.X".into(),
            latency_ms: parse_ping_latency(&msg),
            config_path: conf_path.display().to_string(),
            message: "Tunnel WireGuard già attivo e funzionante verso la sandbox!".into(),
        });
    }

    // 2. Richiedi una configurazione dedicata per questo computer desktop
    let hostname = std::env::var("HOSTNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_else(|_| "Desktop".into());
    let client_name = format!("Desktop-{}", hostname);

    let peer_json = create_vpn_peer(vm_host, ssh_user, username, &client_name)?;
    let parsed: serde_json::Value = serde_json::from_str(&peer_json)
        .map_err(|e| format!("Errore nel parsing configurazione VPN: {e}"))?;

    let config_text = parsed["config_text"]
        .as_str()
        .ok_or_else(|| "Testo configurazione VPN mancante".to_string())?;
    let allocated_ip = parsed["ip_address"].as_str().unwrap_or("10.66.0.X");

    // 3. Salva la configurazione localmente su disco
    std::fs::write(&conf_path, config_text)
        .map_err(|e| format!("Impossibile salvare il file di configurazione VPN locale: {e}"))?;

    // 4. Tenta attivazione del tunnel
    let mut activation_msg = String::new();
    let wg_quick_present = Command::new("which")
        .arg("wg-quick")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    if wg_quick_present {
        let _ = Command::new("wg-quick")
            .args(&["up", &conf_path.display().to_string()])
            .output();
    } else if cfg!(target_os = "macos") {
        let _ = Command::new("open")
            .arg(&conf_path.display().to_string())
            .output();
        activation_msg = " (file aperto con WireGuard macOS)".into();
    }

    // 5. Verifica connettività
    std::thread::sleep(std::time::Duration::from_millis(500));
    let ping_res = test_vpn_connectivity("10.66.0.1");
    let is_connected = ping_res.is_ok();
    let latency = if let Ok(ref msg) = ping_res {
        parse_ping_latency(msg)
    } else {
        None
    };

    Ok(DesktopVpnStatus {
        connected: is_connected,
        ip_address: allocated_ip.to_string(),
        latency_ms: latency,
        config_path: conf_path.display().to_string(),
        message: if is_connected {
            format!("VPN desktop connessa con successo (IP {allocated_ip})!")
        } else {
            format!(
                "Configurazione salvata in {}.{}{}",
                conf_path.display(),
                activation_msg,
                if !wg_quick_present { " Attiva il tunnel dall'app WireGuard." } else { "" }
            )
        },
    })
}

pub fn disconnect_desktop_vpn() -> Result<DesktopVpnStatus, String> {
    let conf_path = dirs_config_path();
    let wg_quick_present = Command::new("which")
        .arg("wg-quick")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    if wg_quick_present {
        let _ = Command::new("wg-quick")
            .args(&["down", &conf_path.display().to_string()])
            .output();
    }

    Ok(DesktopVpnStatus {
        connected: false,
        ip_address: "".into(),
        latency_ms: None,
        config_path: conf_path.display().to_string(),
        message: "Tunnel VPN desktop disattivato".into(),
    })
}

fn dirs_config_path() -> std::path::PathBuf {
    if let Some(home) = std::env::var_os("HOME") {
        std::path::PathBuf::from(home).join(".config").join("omarchy").join("omarchy-vpn.conf")
    } else {
        std::path::PathBuf::from("/tmp/omarchy-vpn.conf")
    }
}

fn parse_ping_latency(msg: &str) -> Option<u32> {
    for part in msg.split_whitespace() {
        if part.starts_with("time=") {
            let num = part.trim_start_matches("time=").trim_end_matches("ms");
            if let Ok(f) = num.parse::<f32>() {
                return Some(f.round() as u32);
            }
        }
    }
    None
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DdnsStatus {
    pub status: String,
    pub enabled: bool,
    pub domain: String,
    pub ip: Option<String>,
    pub timestamp: Option<u64>,
    pub provider: Option<String>,
    pub message: Option<String>,
}

pub fn get_ddns_status(vm_host: &str, ssh_user: &str) -> Result<DdnsStatus, String> {
    if vm_host.trim().is_empty() {
        return Ok(DdnsStatus {
            status: "disabled".into(),
            enabled: false,
            domain: String::new(),
            ip: None,
            timestamp: None,
            provider: Some("duckdns".into()),
            message: Some("Nessun nodo selezionato".into()),
        });
    }
    let res_json = dispatch_broker_call(vm_host, ssh_user, "GET", "/api/ddns", None, &["status-json"])?;
    serde_json::from_str::<DdnsStatus>(&res_json)
        .map_err(|e| format!("Errore nel parsing stato DDNS: {e}"))
}

pub fn update_ddns_config(
    vm_host: &str,
    ssh_user: &str,
    domain: &str,
    token: &str,
    enabled: bool,
) -> Result<String, String> {
    if vm_host.trim().is_empty() {
        return Ok("Configurazione DuckDNS salvata (simulato)".into());
    }
    let body = serde_json::json!({
        "domain": domain,
        "token": token,
        "enabled": enabled,
    });
    dispatch_broker_call(vm_host, ssh_user, "POST", "/api/ddns", Some(body), &["status-json"])
}
