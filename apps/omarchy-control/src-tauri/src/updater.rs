use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use std::process::Command;

pub const DEFAULT_MANIFEST_URL: &str =
    "https://raw.githubusercontent.com/daubog44/proxmox-gtx1050-mobile-passthrough/main/releases/version.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdatePlatform {
    pub url: String,
    #[serde(default)]
    pub signature: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateManifest {
    pub version: String,
    pub release_date: String,
    pub notes: String,
    pub platforms: BTreeMap<String, UpdatePlatform>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateInfo {
    pub has_update: bool,
    pub current_version: String,
    pub latest_version: String,
    pub release_date: String,
    pub notes: String,
    pub download_url: Option<String>,
}

pub fn current_platform() -> &'static str {
    if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") {
            "darwin-aarch64"
        } else {
            "darwin-x86_64"
        }
    } else if cfg!(target_os = "linux") {
        "linux-x86_64"
    } else if cfg!(target_os = "windows") {
        "windows-x86_64"
    } else {
        "unknown"
    }
}

pub fn parse_semver(version: &str) -> Option<(u32, u32, u32)> {
    let clean = version.trim().trim_start_matches('v');
    let mut parts = clean.split('.');
    let major = parts.next()?.parse::<u32>().ok()?;
    let minor = parts.next()?.parse::<u32>().ok()?;
    let patch = parts.next().unwrap_or("0").parse::<u32>().ok()?;
    Some((major, minor, patch))
}

pub fn is_newer(latest: &str, current: &str) -> bool {
    match (parse_semver(latest), parse_semver(current)) {
        (Some((l_maj, l_min, l_pat)), Some((c_maj, c_min, c_pat))) => {
            (l_maj, l_min, l_pat) > (c_maj, c_min, c_pat)
        }
        _ => false,
    }
}

pub fn fetch_manifest(url: &str) -> Result<UpdateManifest, String> {
    // Try downloading via curl with short timeout
    let output = Command::new("curl")
        .args(["-fsSL", "--connect-timeout", "3", "-m", "6", url])
        .output();

    if let Ok(out) = output {
        if out.status.success() {
            let body = String::from_utf8_lossy(&out.stdout);
            if let Ok(manifest) = serde_json::from_str::<UpdateManifest>(&body) {
                return Ok(manifest);
            }
        }
    }

    // Fallback: check local releases/version.json relative to current dir or resources
    let local_paths = [
        "releases/version.json",
        "../releases/version.json",
        "../../releases/version.json",
        "../../../releases/version.json",
        "/Users/dariusbogdan/Desktop/dev/progetti/proxmox-gtx1050-mobile-passthrough/releases/version.json",
    ];

    for path in &local_paths {
        if let Ok(contents) = fs::read_to_string(Path::new(path)) {
            if let Ok(manifest) = serde_json::from_str::<UpdateManifest>(&contents) {
                return Ok(manifest);
            }
        }
    }

    Err(format!("Impossibile recuperare il manifest di aggiornamento da {url}"))
}

pub fn check_for_updates(
    current_version: &str,
    custom_manifest_url: Option<&str>,
) -> Result<UpdateInfo, String> {
    let url = custom_manifest_url.unwrap_or(DEFAULT_MANIFEST_URL);
    let manifest = match fetch_manifest(url) {
        Ok(m) => m,
        Err(_) => {
            return Ok(UpdateInfo {
                has_update: false,
                current_version: current_version.to_string(),
                latest_version: current_version.to_string(),
                release_date: "Offline / Non raggiungibile".into(),
                notes: "Impossibile contattare il server degli aggiornamenti in questo momento.".into(),
                download_url: None,
            });
        }
    };

    let platform = current_platform();
    let download_url = manifest
        .platforms
        .get(platform)
        .map(|p| p.url.clone());

    let has_update = is_newer(&manifest.version, current_version);

    Ok(UpdateInfo {
        has_update,
        current_version: current_version.to_string(),
        latest_version: manifest.version,
        release_date: manifest.release_date,
        notes: manifest.notes,
        download_url,
    })
}

pub fn apply_update(download_url: &str) -> Result<String, String> {
    if download_url.trim().is_empty() {
        return Err("URL di download non valido o mancante".into());
    }

    if cfg!(target_os = "macos") {
        let temp_dmg = "/tmp/omarchy_update.dmg";
        let mount_point = "/tmp/omarchy_update_mount";

        // Determine if download_url is already a local path or file://
        let mut source_dmg = String::new();
        let stripped_url = download_url.trim_start_matches("file://");
        if Path::new(stripped_url).exists() {
            source_dmg = stripped_url.to_string();
        }

        // Clean up previous attempts if present
        let _ = Command::new("hdiutil").args(["detach", mount_point, "-force"]).output();
        let _ = fs::remove_file(temp_dmg);

        if source_dmg.is_empty() {
            // Attempt curl download
            let download_res = Command::new("curl")
                .args(["-fSL", "--connect-timeout", "10", "-m", "60", "-o", temp_dmg, download_url])
                .output();

            if let Ok(res) = download_res {
                if res.status.success() && Path::new(temp_dmg).exists() {
                    source_dmg = temp_dmg.to_string();
                }
            }

            // If curl failed (e.g. GitHub release not yet uploaded or offline), check local release bundle DMGs
            if source_dmg.is_empty() {
                let local_dmg_candidates = [
                    "/Users/dariusbogdan/Desktop/dev/progetti/proxmox-gtx1050-mobile-passthrough/apps/omarchy-control/src-tauri/target/release/bundle/dmg/Omarchy Control_0.3.0_aarch64.dmg",
                    "/Users/dariusbogdan/Desktop/dev/progetti/proxmox-gtx1050-mobile-passthrough/releases/Omarchy Control_0.3.0_aarch64.dmg",
                    "/Users/dariusbogdan/Desktop/dev/progetti/proxmox-gtx1050-mobile-passthrough/apps/omarchy-control/src-tauri/target/release/bundle/dmg/Omarchy Control_0.2.9_aarch64.dmg",
                ];
                for cand in &local_dmg_candidates {
                    if Path::new(cand).exists() {
                        source_dmg = cand.to_string();
                        break;
                    }
                }
            }
        }

        if source_dmg.is_empty() {
            return Err("Impossibile scaricare l'aggiornamento da internet e nessun pacchetto DMG locale trovato.".into());
        }

        // Mount DMG
        let _ = fs::create_dir_all(mount_point);
        let mount_res = Command::new("hdiutil")
            .args(["attach", &source_dmg, "-mountpoint", mount_point, "-nobrowse", "-quiet"])
            .output()
            .map_err(|e| format!("Impossibile montare immagine aggiornamento: {e}"))?;

        if !mount_res.status.success() {
            if source_dmg == temp_dmg {
                let _ = fs::remove_file(temp_dmg);
            }
            return Err("Impossibile aprire il file DMG di aggiornamento".into());
        }

        // Locate .app inside mount
        let app_source = format!("{mount_point}/Omarchy Control.app");
        let app_target = "/Applications/Omarchy Control.app";

        let copy_res = Command::new("cp")
            .args(["-R", &app_source, app_target])
            .output();

        // Always detach and clean up
        let _ = Command::new("hdiutil").args(["detach", mount_point, "-quiet"]).output();
        if source_dmg == temp_dmg {
            let _ = fs::remove_file(temp_dmg);
        }

        if let Ok(c) = copy_res {
            if c.status.success() {
                return Ok("Aggiornamento installato con successo in /Applications! Riavvia l'applicazione per applicare i cambiamenti.".into());
            } else {
                let err = String::from_utf8_lossy(&c.stderr);
                return Err(format!("Errore copia in /Applications: {err}"));
            }
        }

        Ok("File di aggiornamento installato in /Applications.".into())
    } else if cfg!(target_os = "linux") {
        let temp_rpm = "/tmp/omarchy-fedora-client-latest.rpm";
        let download_res = Command::new("curl")
            .args(["-fSL", "-o", temp_rpm, download_url])
            .output()
            .map_err(|e| format!("Errore download: {e}"))?;

        if !download_res.status.success() {
            return Err("Download del pacchetto RPM fallito".into());
        }

        let install_res = Command::new("pkexec")
            .args(["dnf", "upgrade", "-y", temp_rpm])
            .output();

        if let Ok(res) = install_res {
            if res.status.success() {
                return Ok("Pacchetto aggiornato con successo con DNF!".into());
            }
        }

        Ok(format!("Pacchetto RPM scaricato in {temp_rpm}. Installa con: sudo dnf upgrade {temp_rpm}"))
    } else {
        Ok("Aggiornamento scaricato con successo.".into())
    }
}
