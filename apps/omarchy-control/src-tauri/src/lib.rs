use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    process::Command,
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
}

#[derive(Serialize)]
struct Checks {
    moonlight: Check,
    ssh: Check,
    guest_receiver: Check,
    setup: Check,
}

#[derive(Serialize)]
struct Dashboard {
    platform: &'static str,
    config_path: String,
    config: SetupConfig,
    checks: Checks,
}

type AppResult<T> = Result<T, String>;

fn platform_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "Windows"
    } else if cfg!(target_os = "macos") {
        "macOS"
    } else if cfg!(target_os = "linux") {
        "Linux"
    } else {
        "Unsupported"
    }
}

fn config_path(app: &AppHandle) -> AppResult<PathBuf> {
    let directory = app.path().app_config_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join("omarchy.env"))
}

fn parse_config(path: &Path) -> SetupConfig {
    let values = fs::read_to_string(path)
        .ok()
        .map(|contents| {
            contents
                .lines()
                .filter_map(|line| line.split_once('='))
                .map(|(key, value)| (key.trim().to_string(), value.trim().trim_matches(['\'', '"']).to_string()))
                .collect::<BTreeMap<_, _>>()
        })
        .unwrap_or_default();
    SetupConfig {
        vm_host: values.get("OMARCHY_VM_HOST").cloned().unwrap_or_default(),
        vm_address: values.get("OMARCHY_VM_ADDRESS").cloned().unwrap_or_default(),
        user: values.get("OMARCHY_USER").cloned().unwrap_or_default(),
        client_address: values.get("OMARCHY_CLIENT_ADDRESS").cloned().unwrap_or_default(),
        rtp_port: values.get("OMARCHY_RTP_PORT").cloned().unwrap_or_else(|| "40100".to_string()),
        microphone: values.get("OMARCHY_MIC_DEVICE").cloned().unwrap_or_default(),
        fedora_source: values.get("OMARCHY_FEDORA_MIC_SOURCE").cloned().unwrap_or_else(|| "@DEFAULT_SOURCE@".to_string()),
    }
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
    let port = config.rtp_port.parse::<u16>().map_err(|_| "Porta RTP non valida".to_string())?;
    if port == 0 {
        return Err("Porta RTP non valida".to_string());
    }
    if cfg!(target_os = "windows") && config.microphone.trim().is_empty() {
        return Err("Microfono Windows mancante: seleziona il nome esatto del dispositivo di input prima del setup".to_string());
    }
    for (name, value) in [
        ("Microfono Windows", &config.microphone),
        ("Sorgente PipeWire Fedora", &config.fedora_source),
    ] {
        if value.contains(['\n', '\r', '\0']) {
            return Err(format!("{name} non valido"));
        }
    }
    if !config.user.chars().all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-')) {
        return Err("Utente VM non valido per SSH".to_string());
    }
    if !config.vm_host.chars().all(|character| character.is_ascii_alphanumeric() || matches!(character, '.' | ':' | '-')) {
        return Err("Host VM non valido per SSH".to_string());
    }
    Ok(())
}

fn quote_env(value: &str) -> String {
    if value.chars().all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-' | '.' | ':' | '/' | '@' | ' ' | '(' | ')')) {
        value.to_string()
    } else {
        format!("'{}'", value.replace('\'', "'\"'\"'"))
    }
}

fn config_contents(config: &SetupConfig) -> String {
    [
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
    .collect()
}

fn command_exists(command: &str) -> bool {
    if cfg!(target_os = "windows") {
        Command::new("where").arg(command).output().is_ok_and(|output| output.status.success())
    } else {
        Command::new("sh").args(["-lc", &format!("command -v {command}")]).output().is_ok_and(|output| output.status.success())
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
    let repository = manifest.ancestors().nth(3).ok_or("repository root non trovato")?;
    let candidate = repository.join(relative);
    candidate.is_file().then_some(candidate).ok_or_else(|| format!("asset applicazione mancante: {relative}"))
}

fn moonlight_check() -> Check {
    if cfg!(target_os = "windows") {
        if command_exists("moonlight.exe") || command_exists("moonlight") { Check { state: "ready", detail: "Moonlight rilevato nel PATH".into() } } else { Check { state: "missing", detail: "Moonlight non e' nel PATH: il setup Windows puo' installarlo".into() } }
    } else if cfg!(target_os = "macos") {
        if Path::new("/Applications/Moonlight.app").exists() { Check { state: "ready", detail: "Moonlight.app rilevato".into() } } else { Check { state: "missing", detail: "Installa Moonlight.app in /Applications".into() } }
    } else if command_exists("flatpak") && Command::new("flatpak").args(["info", "com.moonlight_stream.Moonlight"]).output().is_ok_and(|output| output.status.success()) {
        Check { state: "ready", detail: "Moonlight Flatpak rilevato".into() }
    } else {
        Check { state: "missing", detail: "Moonlight Flatpak non installato".into() }
    }
}

fn ssh_check() -> Check {
    if command_exists("ssh") { Check { state: "ready", detail: "Client SSH disponibile".into() } } else { Check { state: "missing", detail: "Installa OpenSSH Client".into() } }
}

fn receiver_check(config: &SetupConfig) -> Check {
    if config.vm_host.is_empty() || config.user.is_empty() {
        return Check { state: "unknown", detail: "Inserisci host e utente VM per il controllo remoto".into() };
    }
    if !command_exists("ssh") {
        return Check { state: "blocked", detail: "SSH locale mancante".into() };
    }
    let target = format!("{}@{}", config.user, config.vm_host);
    let result = Command::new("ssh")
        .args(["-o", "BatchMode=yes", "-o", "ConnectTimeout=5", &target, "test -x ~/.local/bin/voxtype-remote-mic-ssh-dispatch && test -f ~/.config/systemd/user/voxtype-remote-mic-rtp.service"])
        .output();
    match result {
        Ok(output) if output.status.success() => Check { state: "ready", detail: "Dispatcher e servizio receiver presenti nella VM".into() },
        Ok(_) => Check { state: "blocked", detail: "Receiver assente oppure serve prima una chiave SSH. Usa Configura questo client: il terminale gestira' SSH e sudo.".into() },
        Err(error) => Check { state: "blocked", detail: format!("Verifica SSH fallita: {error}") },
    }
}

#[tauri::command]
fn inspect_setup(app: AppHandle) -> AppResult<Dashboard> {
    let path = config_path(&app)?;
    let config = parse_config(&path);
    let setup = if cfg!(target_os = "macos") {
        Check { state: "blocked", detail: "macOS: launcher Moonlight supportato; adapter microfono RTP non ancora implementato".into() }
    } else if cfg!(target_os = "windows") || cfg!(target_os = "linux") {
        Check { state: "ready", detail: "Automazione client versionata disponibile".into() }
    } else {
        Check { state: "blocked", detail: "Piattaforma non supportata".into() }
    };
    Ok(Dashboard { platform: platform_name(), config_path: path.display().to_string(), checks: Checks { moonlight: moonlight_check(), ssh: ssh_check(), guest_receiver: receiver_check(&config), setup }, config })
}

#[tauri::command]
fn save_config(app: AppHandle, config: SetupConfig) -> AppResult<String> {
    validate_config(&config)?;
    let path = config_path(&app)?;
    fs::write(&path, config_contents(&config)).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).map_err(|error| error.to_string())?;
    }
    Ok(path.display().to_string())
}

#[tauri::command]
fn launch_moonlight() -> AppResult<()> {
    if cfg!(target_os = "windows") {
        Command::new("cmd").args(["/C", "start", "", "moonlight"]).spawn().map_err(|error| format!("Impossibile avviare Moonlight: {error}"))?;
    } else if cfg!(target_os = "macos") {
        Command::new("open").args(["-a", "Moonlight"]).spawn().map_err(|error| format!("Impossibile avviare Moonlight: {error}"))?;
    } else {
        Command::new("flatpak").args(["run", "com.moonlight_stream.Moonlight"]).spawn().map_err(|error| format!("Impossibile avviare Moonlight Flatpak: {error}"))?;
    }
    Ok(())
}

fn shell_quote(value: &Path) -> String {
    format!("'{}'", value.display().to_string().replace('\'', "'\"'\"'"))
}

#[tauri::command]
fn run_setup_in_terminal(app: AppHandle) -> AppResult<String> {
    let path = config_path(&app)?;
    let config = parse_config(&path);
    validate_config(&config)?;
    if cfg!(target_os = "windows") {
        let script = asset(&app, "clients/omarchy-client-setup.ps1")?;
        let mut command = Command::new("powershell.exe");
        command.args(["-NoExit", "-ExecutionPolicy", "Bypass", "-File"])
            .arg(script)
            .args(["-ConfigPath"])
            .arg(&path)
            .args(["-Module", "All", "-InstallKey"]);
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0000_0010);
        }
        command.spawn().map_err(|error| format!("Impossibile aprire PowerShell: {error}"))?;
        Ok("PowerShell aperto: completa le richieste SSH/sudo nel terminale. La GUI non riceve ne' conserva password.".into())
    } else if cfg!(target_os = "linux") {
        let script = asset(&app, "clients/omarchy-client-setup-fedora.sh")?;
        let instruction = format!("{} --config {} --module onboard; status=$?; echo; read -r -p 'Premi Invio per chiudere…'; exit $status", shell_quote(&script), shell_quote(&path));
        let terminals: [(&str, Vec<&str>); 4] = [
            ("kgx", vec!["--", "bash", "-lc"]),
            ("gnome-terminal", vec!["--", "bash", "-lc"]),
            ("konsole", vec!["-e", "bash", "-lc"]),
            ("xterm", vec!["-e", "bash", "-lc"]),
        ];
        for (terminal, arguments) in terminals {
            if command_exists(terminal) {
                let mut command = Command::new(terminal);
                command.args(arguments).arg(&instruction);
                command.spawn().map_err(|error| format!("Impossibile aprire {terminal}: {error}"))?;
                return Ok("Terminale aperto: il wizard Fedora esegue setup, bootstrap receiver VM e verifiche.".into());
            }
        }
        Err("Nessun terminale grafico trovato (kgx, gnome-terminal, konsole, xterm). Avvia omarchy-onboard --apply manualmente.".into())
    } else {
        Err("macOS non ha ancora l'adapter RTP microfono in questa release. Moonlight e la verifica restano disponibili; il pulsante non esegue un setup incompleto.".into())
    }
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![inspect_setup, save_config, launch_moonlight, run_setup_in_terminal])
        .run(tauri::generate_context!())
        .expect("errore durante l'avvio di Omarchy Control");
}
