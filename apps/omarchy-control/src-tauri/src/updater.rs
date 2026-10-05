use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

pub const DEFAULT_MANIFEST_URL: &str =
    "https://raw.githubusercontent.com/daubog44/proxmox-gtx1050-mobile-passthrough/main/releases/version.json";

/// Packages are only ever downloaded from this project's GitHub releases.
const ALLOWED_DOWNLOAD_PREFIX: &str =
    "https://github.com/daubog44/proxmox-gtx1050-mobile-passthrough/releases/download/";

const BUNDLE_ID: &str = "it.daubog44.omarchy-control";

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
    /// False when the release server could not be reached.
    #[serde(default = "default_true")]
    pub reachable: bool,
}

fn default_true() -> bool {
    true
}

/// What the app must do once `apply_update` returns.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UpdateOutcome {
    /// The new version is installed: restart to use it.
    Restart,
    /// An installer was started and needs this app closed (Windows).
    Quit,
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
        (Some(l), Some(c)) => l > c,
        _ => false,
    }
}

pub fn fetch_manifest(url: &str) -> Result<UpdateManifest, String> {
    let out = Command::new("curl")
        .args(["-fsSL", "--connect-timeout", "5", "-m", "15", url])
        .output()
        .map_err(|e| format!("curl non disponibile: {e}"))?;
    if !out.status.success() {
        return Err("server degli aggiornamenti non raggiungibile".into());
    }
    serde_json::from_slice::<UpdateManifest>(&out.stdout).map_err(|e| format!("manifest non valido: {e}"))
}

pub fn check_for_updates(current_version: &str, custom_manifest_url: Option<&str>) -> Result<UpdateInfo, String> {
    let url = custom_manifest_url.unwrap_or(DEFAULT_MANIFEST_URL);
    let manifest = match fetch_manifest(url) {
        Ok(m) => m,
        Err(_) => {
            return Ok(UpdateInfo {
                has_update: false,
                current_version: current_version.to_string(),
                latest_version: current_version.to_string(),
                release_date: String::new(),
                notes: String::new(),
                download_url: None,
                reachable: false,
            });
        }
    };
    let download_url = manifest.platforms.get(current_platform()).map(|p| p.url.clone());
    Ok(UpdateInfo {
        has_update: is_newer(&manifest.version, current_version) && download_url.is_some(),
        current_version: current_version.to_string(),
        latest_version: manifest.version,
        release_date: manifest.release_date,
        notes: manifest.notes,
        download_url,
        reachable: true,
    })
}

/// Private work directory for one update attempt (removed by the caller).
fn work_dir() -> Result<PathBuf, String> {
    let dir = std::env::temp_dir().join(format!("omarchy-update-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).map_err(|e| format!("cartella temporanea: {e}"))?;
    Ok(dir)
}

fn download(url: &str, dest: &Path) -> Result<(), String> {
    if !url.starts_with(ALLOWED_DOWNLOAD_PREFIX) {
        return Err("URL di aggiornamento non attendibile".into());
    }
    let out = Command::new("curl")
        .args(["-fSL", "--connect-timeout", "15", "-m", "900", "-o"])
        .arg(dest)
        .arg(url)
        .output()
        .map_err(|e| format!("curl non disponibile: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "download fallito: {}",
            String::from_utf8_lossy(&out.stderr).trim().lines().last().unwrap_or("errore di rete")
        ));
    }
    let size = fs::metadata(dest).map(|m| m.len()).unwrap_or(0);
    if size < 1024 * 1024 {
        return Err("pacchetto scaricato incompleto".into());
    }
    Ok(())
}

/// The .app bundle this process runs from (falls back to /Applications).
#[cfg(target_os = "macos")]
fn current_app_bundle() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.ancestors().find(|p| p.extension().is_some_and(|e| e == "app")).map(Path::to_path_buf))
        .unwrap_or_else(|| PathBuf::from("/Applications/Omarchy Control.app"))
}

#[cfg(target_os = "macos")]
fn install_macos(dmg: &Path, work: &Path, target: &Path) -> Result<UpdateOutcome, String> {
    let mount = work.join("mnt");
    fs::create_dir_all(&mount).map_err(|e| e.to_string())?;
    let attach = Command::new("hdiutil")
        .args(["attach", "-nobrowse", "-readonly", "-noautoopen", "-mountpoint"])
        .arg(&mount)
        .arg(dmg)
        .output()
        .map_err(|e| format!("hdiutil: {e}"))?;
    if !attach.status.success() {
        return Err("immagine DMG non valida".into());
    }
    let result = (|| {
        let source = fs::read_dir(&mount)
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .map(|e| e.path())
            .find(|p| p.extension().is_some_and(|e| e == "app"))
            .ok_or("nessuna app nel DMG")?;
        let plist = source.join("Contents/Info.plist");
        let id = Command::new("defaults")
            .arg("read")
            .arg(&plist)
            .arg("CFBundleIdentifier")
            .output()
            .map_err(|e| e.to_string())?;
        if String::from_utf8_lossy(&id.stdout).trim() != BUNDLE_ID {
            return Err("il DMG non contiene Omarchy Control".to_string());
        }

        // Copy next to the installed app, then swap: a failed copy never
        // leaves a half-written app in place.
        let parent = target.parent().ok_or("percorso app non valido")?;
        let staged = parent.join(".Omarchy Control.app.update");
        let previous = parent.join(".Omarchy Control.app.previous");
        let _ = fs::remove_dir_all(&staged);
        let _ = fs::remove_dir_all(&previous);
        let copy = Command::new("ditto").arg(&source).arg(&staged).output().map_err(|e| e.to_string())?;
        if !copy.status.success() {
            let _ = fs::remove_dir_all(&staged);
            return Err(format!(
                "copia in {} non riuscita: {}",
                parent.display(),
                String::from_utf8_lossy(&copy.stderr).trim()
            ));
        }
        let _ = Command::new("xattr").args(["-dr", "com.apple.quarantine"]).arg(&staged).output();
        if target.exists() {
            fs::rename(target, &previous).map_err(|e| format!("sostituzione app: {e}"))?;
        }
        if let Err(e) = fs::rename(&staged, target) {
            let _ = fs::rename(&previous, target);
            return Err(format!("sostituzione app: {e}"));
        }
        let _ = fs::remove_dir_all(&previous);
        Ok(UpdateOutcome::Restart)
    })();
    let _ = Command::new("hdiutil").arg("detach").arg(&mount).args(["-quiet", "-force"]).output();
    result
}

pub fn apply_update(download_url: &str) -> Result<UpdateOutcome, String> {
    let work = work_dir()?;
    let result = (|| {
        #[cfg(target_os = "macos")]
        {
            let dmg = work.join("update.dmg");
            download(download_url, &dmg)?;
            install_macos(&dmg, &work, &current_app_bundle())
        }
        #[cfg(target_os = "windows")]
        {
            // The NSIS installer replaces the files once this app has exited.
            let exe = std::env::temp_dir().join(format!("omarchy-control-setup-{}.exe", std::process::id()));
            download(download_url, &exe)?;
            Command::new(&exe).spawn().map_err(|e| format!("avvio installer: {e}"))?;
            Ok(UpdateOutcome::Quit)
        }
        #[cfg(target_os = "linux")]
        {
            let rpm = work.join("omarchy-control.rpm");
            download(download_url, &rpm)?;
            let out = Command::new("pkexec")
                .args(["dnf", "install", "-y"])
                .arg(&rpm)
                .output()
                .map_err(|e| format!("pkexec: {e}"))?;
            if !out.status.success() {
                return Err("installazione annullata o fallita (dnf)".into());
            }
            Ok(UpdateOutcome::Restart)
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        {
            let _ = download_url;
            Err("piattaforma non supportata".to_string())
        }
    })();
    let _ = fs::remove_dir_all(&work);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_versions() {
        assert!(is_newer("0.4.0", "0.3.9"));
        assert!(is_newer("v1.0", "0.9.9"));
        assert!(!is_newer("0.4.0", "0.4.0"));
        assert!(!is_newer("garbage", "0.1.0"));
    }

    /// Downloads the published macOS release and installs it over a scratch
    /// copy. `cargo test -- --ignored live_macos_update`.
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore]
    fn live_macos_update() {
        let info = check_for_updates("0.0.1", None).expect("manifest");
        let url = info.download_url.expect("download url");
        let work = work_dir().unwrap();
        let target = work.join("apps/Omarchy Control.app");
        fs::create_dir_all(target.join("Contents")).unwrap();
        fs::write(target.join("Contents/old-marker"), "old").unwrap();
        let dmg = work.join("update.dmg");
        download(&url, &dmg).expect("download");
        let outcome = install_macos(&dmg, &work, &target).expect("install");
        assert!(matches!(outcome, UpdateOutcome::Restart));
        assert!(!target.join("Contents/old-marker").exists(), "old bundle replaced");
        assert!(!target.join("Omarchy Control.app").exists(), "no nested copy");
        let version = Command::new("defaults")
            .arg("read")
            .arg(target.join("Contents/Info.plist"))
            .arg("CFBundleShortVersionString")
            .output()
            .unwrap();
        assert_eq!(String::from_utf8_lossy(&version.stdout).trim(), info.latest_version);
        assert!(!work.join("apps/.Omarchy Control.app.previous").exists());
        let _ = fs::remove_dir_all(&work);
    }

    #[test]
    fn refuses_foreign_download_urls() {
        let dest = std::env::temp_dir().join("omarchy-update-test.bin");
        let err = download("https://example.com/omarchy.dmg", &dest).unwrap_err();
        assert!(err.contains("non attendibile"));
    }
}
