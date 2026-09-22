use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

pub const DEFAULT_ADMIN_USERNAME: &str = "admin";
pub const MIN_PASSWORD_LEN: usize = 10;
const AUTH_FILE: &str = "omarchy-admin.auth";

/// Record written by versions <= 0.3.0 on first run: a fixed salt plus the
/// hash of a password that was hard-coded in the app and printed in the docs.
/// It is not a secret chosen by anyone, so it is treated as "no password set"
/// and the admin is asked to choose one. Only the hash is kept here.
const LEGACY_DEFAULT_SALT: &str = "omarchy_pascal_salt_2026";
const LEGACY_DEFAULT_HASH: &str = "0ddcc0473e65438235cdc191ba0bef2b76127bf0c34d1da7280e9093361faa60";

static ACTIVE_SESSIONS: Mutex<Option<HashMap<String, AuthSession>>> = Mutex::new(None);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthRecord {
    pub username: String,
    pub salt: String,
    pub password_hash: String,
    /// "pbkdf2-sha256" for current records; missing on records written by
    /// <= 0.3.x, which used a single salted SHA-256 (upgraded at next login).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub algo: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub iterations: Option<u32>,
}

const PBKDF2_ALGO: &str = "pbkdf2-sha256";
/// OWASP recommendation for PBKDF2-HMAC-SHA256 (2023).
#[cfg(not(test))]
const PBKDF2_ITERATIONS: u32 = 600_000;
#[cfg(test)]
const PBKDF2_ITERATIONS: u32 = 1_000;

/// HMAC-SHA256 keyed once: the padded inner/outer hash states are cloned
/// for every message instead of being rebuilt (PBKDF2 calls this 600k times).
struct HmacSha256 {
    inner: Sha256,
    outer: Sha256,
}

impl HmacSha256 {
    fn new(key: &[u8]) -> Self {
        const BLOCK: usize = 64;
        let mut key_block = [0u8; BLOCK];
        if key.len() > BLOCK {
            key_block[..32].copy_from_slice(&Sha256::digest(key));
        } else {
            key_block[..key.len()].copy_from_slice(key);
        }
        let mut inner = Sha256::new();
        inner.update(key_block.map(|b| b ^ 0x36));
        let mut outer = Sha256::new();
        outer.update(key_block.map(|b| b ^ 0x5c));
        Self { inner, outer }
    }

    fn mac(&self, message: &[u8]) -> [u8; 32] {
        let mut inner = self.inner.clone();
        inner.update(message);
        let mut outer = self.outer.clone();
        outer.update(inner.finalize());
        outer.finalize().into()
    }
}

/// PBKDF2-HMAC-SHA256 (RFC 8018), 32-byte output, hex encoded.
pub fn pbkdf2_sha256_hex(password: &str, salt: &str, iterations: u32) -> String {
    let prf = HmacSha256::new(password.as_bytes());
    let mut first = salt.as_bytes().to_vec();
    first.extend_from_slice(&1u32.to_be_bytes()); // single block: dkLen = hLen
    let mut u = prf.mac(&first);
    let mut out = u;
    for _ in 1..iterations {
        u = prf.mac(&u);
        for (o, b) in out.iter_mut().zip(u.iter()) {
            *o ^= b;
        }
    }
    out.iter().map(|b| format!("{b:02x}")).collect()
}

fn record_matches(record: &AuthRecord, password: &str) -> bool {
    let computed = match record.algo.as_deref() {
        Some(PBKDF2_ALGO) => pbkdf2_sha256_hex(password, &record.salt, record.iterations.unwrap_or(PBKDF2_ITERATIONS)),
        None => hash_password(password, &record.salt),
        Some(_) => return false,
    };
    // Length-independent comparison of the hex digests.
    computed.len() == record.password_hash.len()
        && computed.bytes().zip(record.password_hash.bytes()).fold(0u8, |acc, (a, b)| acc | (a ^ b)) == 0
}

fn write_record(config_dir: &Path, record: &AuthRecord) -> Result<(), String> {
    fs::create_dir_all(config_dir).map_err(|e| format!("Impossibile creare {}: {e}", config_dir.display()))?;
    let json = serde_json::to_string_pretty(record).map_err(|e| e.to_string())?;
    let path = config_dir.join(AUTH_FILE);
    let tmp = config_dir.join(format!("{AUTH_FILE}.tmp"));
    fs::write(&tmp, json).map_err(|e| format!("Impossibile salvare la password: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600));
    }
    fs::rename(&tmp, &path).map_err(|e| format!("Impossibile salvare la password: {e}"))
}

fn new_record(password: &str) -> Result<AuthRecord, String> {
    let salt = random_hex(16)?;
    Ok(AuthRecord {
        username: DEFAULT_ADMIN_USERNAME.to_string(),
        password_hash: pbkdf2_sha256_hex(password, &salt, PBKDF2_ITERATIONS),
        salt,
        algo: Some(PBKDF2_ALGO.to_string()),
        iterations: Some(PBKDF2_ITERATIONS),
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthSession {
    pub token: String,
    pub username: String,
    pub role: String,
    pub expires_at: u64,
}

pub fn hash_password(password: &str, salt: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(salt.as_bytes());
    hasher.update(password.as_bytes());
    let result = hasher.finalize();
    let mut hex = String::with_capacity(64);
    for byte in result {
        use std::fmt::Write;
        let _ = write!(&mut hex, "{:02x}", byte);
    }
    hex
}

fn now_epoch_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// Hex string of `bytes` bytes from the OS CSPRNG.
fn random_hex(bytes: usize) -> Result<String, String> {
    let mut buf = vec![0u8; bytes];
    getrandom::getrandom(&mut buf).map_err(|e| format!("Generatore casuale non disponibile: {e}"))?;
    Ok(buf.iter().map(|b| format!("{b:02x}")).collect())
}

/// Session tokens are 256 random bits: nothing derived from user, time or pid.
fn generate_token() -> Result<String, String> {
    random_hex(32)
}

pub fn cache_users(config_dir: &Path, users: &[crate::broker::UserRecord]) {
    let file = config_dir.join("users_cache.json");
    if let Ok(json) = serde_json::to_string_pretty(users) {
        let _ = fs::write(file, json);
    }
}

pub fn get_cached_users(config_dir: &Path) -> Vec<crate::broker::UserRecord> {
    let file = config_dir.join("users_cache.json");
    if let Ok(contents) = fs::read_to_string(file) {
        if let Ok(users) = serde_json::from_str::<Vec<crate::broker::UserRecord>>(&contents) {
            return users;
        }
    }
    crate::broker::fallback_overview().users
}

fn is_legacy_default(record: &AuthRecord) -> bool {
    record.salt == LEGACY_DEFAULT_SALT && record.password_hash == LEGACY_DEFAULT_HASH
}

/// The stored admin credential, if a real one exists. Missing, unreadable and
/// legacy-default records all mean "no password set yet".
pub fn load_auth_record(config_dir: &Path) -> Option<AuthRecord> {
    let contents = fs::read_to_string(config_dir.join(AUTH_FILE)).ok()?;
    let record = serde_json::from_str::<AuthRecord>(&contents).ok()?;
    if record.salt.is_empty() || record.password_hash.is_empty() || is_legacy_default(&record) {
        return None;
    }
    Some(record)
}

/// True until the admin has chosen a password on this machine.
pub fn needs_setup(config_dir: &Path) -> bool {
    load_auth_record(config_dir).is_none()
}

/// First-run setup: store the admin password with a fresh random salt.
/// Refused once a real password exists, so it cannot be used to overwrite it.
pub fn set_initial_password(config_dir: &Path, password: &str) -> Result<(), String> {
    if !needs_setup(config_dir) {
        return Err("La password amministratore è già impostata.".into());
    }
    if password.chars().count() < MIN_PASSWORD_LEN {
        return Err(format!("La password deve avere almeno {MIN_PASSWORD_LEN} caratteri."));
    }
    if password.trim() != password {
        return Err("La password non può iniziare o finire con spazi.".into());
    }
    write_record(config_dir, &new_record(password)?)
}

pub fn verify_credentials(
    config_dir: &Path,
    username: &str,
    password: &str,
) -> Result<bool, String> {
    let u = username.trim();
    let p = password.trim();

    if u.is_empty() || p.is_empty() {
        return Ok(false);
    }

    // Explicit operator override (e.g. provisioning scripts); opt-in only.
    if let Ok(env_pwd) = std::env::var("OMARCHY_ADMIN_PASSWORD") {
        if !env_pwd.is_empty() && (u == DEFAULT_ADMIN_USERNAME || u == "owner") && p == env_pwd {
            return Ok(true);
        }
    }

    // No password chosen yet: nothing to compare against (the UI shows setup).
    let Some(record) = load_auth_record(config_dir) else {
        return Ok(false);
    };

    // Support both "admin" and "owner" as administrative logins
    let valid_user = u == record.username || (record.username == DEFAULT_ADMIN_USERNAME && u == "owner");
    if !valid_user {
        return Ok(false);
    }

    if !record_matches(&record, p) {
        return Ok(false);
    }
    // Transparently upgrade legacy single-SHA-256 records to PBKDF2.
    if record.algo.is_none() {
        if let Ok(upgraded) = new_record(p) {
            let upgraded = AuthRecord { username: record.username.clone(), ..upgraded };
            let _ = write_record(config_dir, &upgraded);
        }
    }
    Ok(true)
}

pub fn login(config_dir: &Path, username: &str, password_or_pin: &str) -> Result<AuthSession, String> {
    let u = username.trim();
    let p = password_or_pin.trim();

    if u.is_empty() || p.is_empty() {
        return Err("Inserisci nome utente e password o PIN".into());
    }

    // 1. Try administrative login (admin / owner)
    if verify_credentials(config_dir, u, p)? {
        let token = generate_token()?;
        let expires_at = now_epoch_secs() + 86400 * 7;
        let session = AuthSession {
            token: token.clone(),
            username: u.to_string(),
            role: "admin".to_string(),
            expires_at,
        };

        let mut lock = ACTIVE_SESSIONS.lock().unwrap();
        let map = lock.get_or_insert_with(HashMap::new);
        map.insert(token, session.clone());

        return Ok(session);
    }

    // 2. Try registered guest users via username and PIN
    let cached_users = get_cached_users(config_dir);
    if let Some(user) = cached_users.iter().find(|user| user.username.eq_ignore_ascii_case(u)) {
        if user.status == "banned" {
            return Err(format!("L'account '{u}' e stato sospeso dall'amministratore."));
        }
        if user.pin == p {
            let token = generate_token()?;
            let expires_at = now_epoch_secs() + 86400 * 7;
            let session = AuthSession {
                token: token.clone(),
                username: user.username.clone(),
                role: if user.role.is_empty() { "guest".into() } else { user.role.clone() },
                expires_at,
            };

            let mut lock = ACTIVE_SESSIONS.lock().unwrap();
            let map = lock.get_or_insert_with(HashMap::new);
            map.insert(token, session.clone());

            return Ok(session);
        }
    }

    Err("Credenziali non valide: controlla username e password/PIN.".into())
}

pub fn get_session(token: &str) -> Option<AuthSession> {
    let t = token.trim();
    if t.is_empty() {
        return None;
    }
    let lock = ACTIVE_SESSIONS.lock().unwrap();
    lock.as_ref().and_then(|map| map.get(t).cloned())
}

pub fn validate_session(token: &str) -> bool {
    get_session(token).is_some()
}

pub fn is_admin_session(token: &str) -> bool {
    get_session(token)
        .map(|s| s.role == "admin" || s.role == "owner")
        .unwrap_or(false)
}

pub fn logout(token: &str) -> bool {
    let mut lock = ACTIVE_SESSIONS.lock().unwrap();
    if let Some(map) = lock.as_mut() {
        map.remove(token.trim()).is_some()
    } else {
        false
    }
}
