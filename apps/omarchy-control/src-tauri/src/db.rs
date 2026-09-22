use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use rusqlite::{params, Connection};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

const VAULT_SALT: &str = "omarchy_pascal_gtx1050_vault_2026";

fn derive_encryption_key() -> [u8; 32] {
    let machine_seed = std::env::var("USER").unwrap_or_else(|_| "omarchy".into());
    let mut hasher = Sha256::new();
    hasher.update(VAULT_SALT.as_bytes());
    hasher.update(machine_seed.as_bytes());
    let result = hasher.finalize();
    let mut key = [0u8; 32];
    key.copy_from_slice(&result);
    key
}

pub fn encrypt_secret(plaintext: &str) -> Result<String, String> {
    if plaintext.is_empty() {
        return Ok(String::new());
    }
    let key_bytes = derive_encryption_key();
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);

    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let mut nonce_bytes = [0u8; 12];
    let ts_bytes = ts.to_be_bytes();
    for i in 0..12 {
        nonce_bytes[i] = ts_bytes[i % 16] ^ ((i as u8) * 17);
    }
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| format!("Errore cifratura secret: {e}"))?;

    let mut combined = Vec::with_capacity(12 + ciphertext.len());
    combined.extend_from_slice(&nonce_bytes);
    combined.extend_from_slice(&ciphertext);

    let mut hex = String::with_capacity(combined.len() * 2);
    for b in combined {
        use std::fmt::Write;
        let _ = write!(&mut hex, "{:02x}", b);
    }
    Ok(hex)
}

pub fn decrypt_secret(hex_str: &str) -> Result<String, String> {
    let clean = hex_str.trim();
    if clean.is_empty() {
        return Ok(String::new());
    }
    if clean.len() < 24 {
        return Err("Payload cifrato non valido".into());
    }

    let mut bytes = Vec::new();
    for i in (0..clean.len()).step_by(2) {
        if i + 2 <= clean.len() {
            if let Ok(b) = u8::from_str_radix(&clean[i..i + 2], 16) {
                bytes.push(b);
            } else {
                return Err("Formato esadecimale non valido".into());
            }
        }
    }

    if bytes.len() < 12 {
        return Err("Payload troppo corto".into());
    }

    let (nonce_slice, cipher_slice) = bytes.split_at(12);
    let key_bytes = derive_encryption_key();
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(nonce_slice);

    let decrypted = cipher
        .decrypt(nonce, cipher_slice)
        .map_err(|e| format!("Errore decifratura: {e}"))?;

    String::from_utf8(decrypted).map_err(|e| format!("Errore decodifica UTF-8: {e}"))
}

pub fn open_db(db_path: &Path) -> Result<Connection, String> {
    if let Some(parent) = db_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let conn = Connection::open(db_path).map_err(|e| format!("Apertura SQLite fallita: {e}"))?;

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS cluster_nodes (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            host TEXT NOT NULL,
            port INTEGER NOT NULL DEFAULT 22,
            user TEXT NOT NULL,
            encrypted_secret TEXT,
            allowed_users TEXT NOT NULL DEFAULT '[\"*\"]',
            is_active INTEGER NOT NULL DEFAULT 0,
            connection_state TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            api_port INTEGER DEFAULT 47995,
            api_token TEXT
        );",
    )
    .map_err(|e| format!("Inizializzazione tabella cluster_nodes fallita: {e}"))?;

    // Migrate table if existing
    let _ = conn.execute("ALTER TABLE cluster_nodes ADD COLUMN api_port INTEGER DEFAULT 47995;", []);
    let _ = conn.execute("ALTER TABLE cluster_nodes ADD COLUMN api_token TEXT;", []);
    let _ = conn.execute("ALTER TABLE cluster_nodes ADD COLUMN streaming_port INTEGER DEFAULT 47989;", []);
    let _ = conn.execute("ALTER TABLE cluster_nodes ADD COLUMN ddns_domain TEXT;", []);

    // Purge legacy non-gaming nodes (NAS and Proxmox hypervisor host) mistakenly added as gaming nodes
    let _ = conn.execute(
        "DELETE FROM cluster_nodes WHERE host = '192.168.0.39' OR id = 'omarchy-lan' OR host = '192.168.0.35' OR id = 'proxmox-host'",
        [],
    );

    // Ensure default gaming VM is restricted to admin/owner if previously set to '*'
    let _ = conn.execute(
        "UPDATE cluster_nodes SET allowed_users = '[\"admin\",\"owner\"]', name = 'Omarchy Gaming Host (omarchy.local)' WHERE id = 'omarchy-local' AND (allowed_users = '[\"*\"]' OR allowed_users = '[]' OR name = 'Omarchy VM (omarchy.local)')",
        [],
    );

    Ok(conn)
}

pub fn load_nodes(
    db_path: &Path,
    current_host: &str,
    default_user: &str,
) -> Vec<crate::NodeEntry> {
    let effective_user = if default_user.is_empty() || default_user == "dariusbogdan" {
        "daubog44"
    } else {
        default_user
    };

    let default_nodes = vec![
        crate::NodeEntry {
            id: "omarchy-local".into(),
            name: "Omarchy Gaming Host (omarchy.local)".into(),
            host: "omarchy.local".into(),
            user: effective_user.into(),
            is_active: current_host == "omarchy.local" || current_host.is_empty(),
            connection_state: None,
            allowed_users: vec!["admin".into(), "owner".into()],
            api_port: 47995,
            api_token: None,
            streaming_port: 47989,
            ddns_domain: Some("cloudgamingadrian.duckdns.org".into()),
        },
    ];

    let conn = match open_db(db_path) {
        Ok(c) => c,
        Err(_) => return default_nodes,
    };

    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM cluster_nodes", [], |row| row.get(0))
        .unwrap_or(0);

    if count == 0 {
        let _ = save_nodes(db_path, &default_nodes);
        return default_nodes;
    }

    let mut stmt = match conn.prepare(
        "SELECT id, name, host, user, allowed_users, is_active, connection_state, COALESCE(api_port, 47995), api_token, COALESCE(streaming_port, 47989), ddns_domain FROM cluster_nodes ORDER BY created_at ASC",
    ) {
        Ok(s) => s,
        Err(_) => return default_nodes,
    };

    let node_iter = stmt.query_map([], |row| {
        let id: String = row.get(0)?;
        let name: String = row.get(1)?;
        let host: String = row.get(2)?;
        let mut user: String = row.get(3)?;
        let allowed_json: String = row.get(4)?;
        let is_active_int: i32 = row.get(5)?;
        let connection_state: Option<String> = row.get(6)?;
        let api_port: i64 = row.get(7).unwrap_or(47995);
        let api_token: Option<String> = row.get(8).ok();
        let streaming_port: i64 = row.get(9).unwrap_or(47989);
        let ddns_domain: Option<String> = row.get(10).ok();

        if user.is_empty() || user == "dariusbogdan" {
            user = "daubog44".into();
        }

        let allowed_users = serde_json::from_str::<Vec<String>>(&allowed_json)
            .unwrap_or_else(|_| vec!["*".into()]);

        Ok(crate::NodeEntry {
            id,
            name,
            host: host.clone(),
            user,
            is_active: host == current_host || is_active_int == 1,
            connection_state,
            allowed_users,
            api_port: if api_port <= 0 { 47995 } else { api_port as u16 },
            api_token,
            streaming_port: if streaming_port <= 0 { 47989 } else { streaming_port as u16 },
            ddns_domain,
        })
    });

    match node_iter {
        Ok(iter) => {
            let mut result = Vec::new();
            for item in iter.flatten() {
                result.push(item);
            }
            if result.is_empty() {
                default_nodes
            } else {
                result
            }
        }
        Err(_) => default_nodes,
    }
}

pub fn save_nodes(db_path: &Path, nodes: &[crate::NodeEntry]) -> Result<(), String> {
    let mut conn = open_db(db_path)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    let tx = conn
        .transaction()
        .map_err(|e| format!("Transazione SQLite fallita: {e}"))?;

    for node in nodes {
        let allowed_json = serde_json::to_string(&node.allowed_users).unwrap_or_else(|_| "[\"*\"]".into());
        let active_int = if node.is_active { 1 } else { 0 };

        tx.execute(
            "INSERT INTO cluster_nodes (id, name, host, user, allowed_users, is_active, connection_state, created_at, updated_at, api_port, api_token, streaming_port, ddns_domain)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, ?9, ?10, ?11, ?12)
             ON CONFLICT(id) DO UPDATE SET
                 name = excluded.name,
                 host = excluded.host,
                 user = excluded.user,
                 allowed_users = excluded.allowed_users,
                 is_active = excluded.is_active,
                 connection_state = excluded.connection_state,
                 updated_at = excluded.updated_at,
                 api_port = excluded.api_port,
                 api_token = excluded.api_token,
                 streaming_port = excluded.streaming_port,
                 ddns_domain = excluded.ddns_domain;",
            params![
                node.id,
                node.name,
                node.host,
                node.user,
                allowed_json,
                active_int,
                node.connection_state,
                now,
                node.api_port as i64,
                node.api_token,
                node.streaming_port as i64,
                node.ddns_domain,
            ],
        )
        .map_err(|e| format!("Inserimento nodo fallito: {e}"))?;
    }

    tx.commit()
        .map_err(|e| format!("Commit SQLite fallito: {e}"))?;

    Ok(())
}

pub fn save_node_password(db_path: &Path, node_id: &str, password: &str) -> Result<(), String> {
    let conn = open_db(db_path)?;
    let encrypted = encrypt_secret(password)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    conn.execute(
        "UPDATE cluster_nodes SET encrypted_secret = ?1, updated_at = ?2 WHERE id = ?3;",
        params![encrypted, now, node_id],
    )
    .map_err(|e| format!("Salvataggio credenziale cifrata fallito: {e}"))?;

    Ok(())
}

pub fn get_node_password(db_path: &Path, node_id: &str) -> Option<String> {
    let conn = open_db(db_path).ok()?;
    let encrypted: Option<String> = conn
        .query_row(
            "SELECT encrypted_secret FROM cluster_nodes WHERE id = ?1;",
            params![node_id],
            |row| row.get(0),
        )
        .ok()?;

    encrypted.and_then(|enc| decrypt_secret(&enc).ok())
}

pub fn save_node_api_config(
    db_path: &Path,
    node_id: &str,
    api_port: u16,
    api_token: Option<&str>,
) -> Result<(), String> {
    let conn = open_db(db_path)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    conn.execute(
        "UPDATE cluster_nodes SET api_port = ?1, api_token = ?2, updated_at = ?3 WHERE id = ?4;",
        params![api_port as i64, api_token, now, node_id],
    )
    .map_err(|e| format!("Salvataggio configurazione API fallito: {e}"))?;

    Ok(())
}

pub fn get_node_token(db_path: &Path, node_id: &str) -> Option<String> {
    let conn = open_db(db_path).ok()?;
    conn.query_row(
        "SELECT api_token FROM cluster_nodes WHERE id = ?1;",
        params![node_id],
        |row| row.get(0),
    )
    .ok()
    .and_then(|val: Option<String>| val)
}

pub fn delete_node(db_path: &Path, node_id: &str) -> Result<(), String> {
    let conn = open_db(db_path)?;
    conn.execute("DELETE FROM cluster_nodes WHERE id = ?1;", params![node_id])
        .map_err(|e| format!("Cancellazione nodo fallita: {e}"))?;
    Ok(())
}

pub fn migrate_legacy_json(db_path: &Path, json_path: &Path) {
    if !json_path.is_file() {
        return;
    }
    if let Ok(contents) = fs::read_to_string(json_path) {
        if let Ok(nodes) = serde_json::from_str::<Vec<crate::NodeEntry>>(&contents) {
            let _ = save_nodes(db_path, &nodes);
            // Backup legacy json
            let bak = json_path.with_extension("json.migrated");
            let _ = fs::rename(json_path, bak);
        }
    }
}
