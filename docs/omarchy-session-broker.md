# Omarchy Session Broker

`scripts/omarchy-session-broker` e' il componente di orchestrazione e telemetria per il multi-utente su Omarchy. Gestisce le sessioni concorrenti isolate avviate tramite **Wolf**, lasciando la sessione proprietaria principale a **Sunshine**.

## Architettura e sicurezza

Il broker e' progettato per garantire il principio del minimo privilegio:
1. **Database SQLite dedicato**: memorizza utenti, PIN di accoppiamento, permessi applicativi (desktop Wayland, Steam Big Picture o singole app) e audit log in `/var/lib/omarchy/sessions.db`.
2. **Nessun accesso root diretto per i client**: la GUI desktop `omarchy-control` interagisce con il broker tramite SSH limitato o comando autorizzato, senza necessitare di una shell root interattiva.
3. **Controllo socket Wolf**: dialoga con il demone Wolf via socket UNIX (`/var/run/wolf/wolf.sock`), consentendo di monitorare client accoppiati, sessioni in streaming ed eseguire disconnessioni forzate.
4. **Telemetria GPU integrata**: interroga `nvidia-smi` per telemetria VRAM (usata/totale), frequenza, temperatura e carico dell'encoder hardware NVENC (`nvidia-smi pmon`).

## Tabella comandi CLI

| Comando | Descrizione | Output |
| --- | --- | --- |
| `status-json` | Restituisce lo stato globale del multi-utente, telemetria GPU e lista sessioni | JSON strutturato |
| `list-sessions` | Elenca le sessioni Wolf/guest attualmente attive con risoluzione, FPS e bitrate | JSON array |
| `list-users` | Elenca tutti gli utenti registrati, i rispettivi PIN e i permessi applicativi | JSON array |
| `add-user --username <user> --display <name> --pin <pin> [--storage-gb <GB>]` | Registra un utente e prepara il profilo Wolf persistente con quota; `0` = illimitato | Esito JSON |
| `edit-user --username <user> --storage-gb <GB>` | Cambia subito il limite della home Wolf (desktop e giochi) senza riavviare la sessione; rifiuta limiti sotto lo spazio occupato | Esito JSON |
| `remove-user --username <user> [--archive]` | Elimina l'utente (o ne archivia lo stato) e rimuove i container associati | Esito JSON |
| `ban-user --username <user>` | Banna l'utente interrompendo sessioni/processi attivi, preservando al 100% i salvataggi e la cartella home | Esito JSON |
| `unban-user --username <user>` | Riabilita un utente bannato ripristinando lo stato attivo e la possibilità di avviare giochi | Esito JSON |
| `kill-session --id <session-id>` | Interrompe forzatamente una sessione in streaming, rilascia il contesto NVENC; alla fine della sessione Wolf il broker fa il backup automatico dei salvataggi | Esito JSON |
| `shadow-session --id <session-id>` | Abilita l'Owner ad affiancare o prendere il controllo della sessione | Parametri stream JSON |
| `start-recording --id <session-id>` | Registra sul NAS Samba (`smb://192.168.0.39/nvme1`) lo stesso flusso H.265 GPU del video live, in MP4 frammentato | Esito JSON |
| `stop-recording --id <session-id>` | Conclude e finalizza in modo pulito il file MP4 registrato | Esito JSON |
| `wolf-tap-socket --id <session-id>` | Restituisce il socket video Wolf realmente in ascolto, ignorando i socket abbandonati dopo una riconnessione | Percorso, errore se il tap non è attivo |
| `get-settings` | Restituisce tutte le impostazioni Enterprise del broker in formato JSON | JSON dictionary |
| `set-setting --key <k> --value <v>` | Aggiorna un parametro di sistema (limiti NVENC, retention, percorsi NAS) | Esito JSON |
| `check-admission [--vram <MB>]` | Verifica disponibilità VRAM ed encoder Pascal GP107 per nuovi flussi | Esito JSON |
| `sync-saves --username <u> [--direction push\|pull]` | Esegue la sincronizzazione Dual-Tier tra NVMe locale e archivio Samba NAS | Esito JSON |
| `list-saves [--username <u>]` | Elenca tutti gli snapshot dei salvataggi salvati su Samba NAS | JSON array |
| `prune-nas [--dry-run]` | Applica giorni e numero di copie configurati, escludendo video attivi; `0` disattiva la rispettiva pulizia | Esito JSON |
| `vpn-peer-add --username <u> --client-name <n>` | Alloca IP Mesh, genera chiavi Curve25519 e crea il file `.conf` WireGuard | Parametri e conf base64 |
| `vpn-peer-list [--username <u>]` | Elenca i peer WireGuard configurati | JSON array |
| `vpn-peer-del --id <peer-id>` | Revoca ed elimina un peer WireGuard | Esito JSON |
| `install-backend` | Inizializza cartelle, permessi e schema database | Riepilogo installazione |

## Schema del database SQLite

```sql
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    pin TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'guest',
    allowed_apps TEXT NOT NULL DEFAULT '["steam","desktop"]',
    max_bitrate_mbps INTEGER NOT NULL DEFAULT 20,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    allowed_nodes TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE cluster_nodes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER NOT NULL DEFAULT 22,
    user TEXT NOT NULL,
    encrypted_secret TEXT,
    allowed_users TEXT NOT NULL DEFAULT '["admin", "owner"]',
    is_active INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE active_sessions (
    session_id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    client_ip TEXT NOT NULL,
    app_name TEXT NOT NULL,
    resolution TEXT NOT NULL DEFAULT '1920x1080',
    fps INTEGER NOT NULL DEFAULT 60,
    bitrate_kbps INTEGER NOT NULL DEFAULT 20000,
    vram_mb INTEGER NOT NULL DEFAULT 600,
    started_at INTEGER NOT NULL,
    state TEXT NOT NULL DEFAULT 'running',
    takeover_by TEXT,
    is_recording INTEGER NOT NULL DEFAULT 0,
    recording_pid INTEGER,
    recording_file TEXT
);

CREATE TABLE system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE vpn_peers (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    client_name TEXT NOT NULL,
    public_key TEXT NOT NULL,
    private_key TEXT,
    ip_address TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE savegame_manifests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    snapshot_name TEXT NOT NULL,
    storage_type TEXT NOT NULL,
    file_path TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    details TEXT NOT NULL
);
```

## Video live e registrazioni

Un solo encode H.265 sulla GPU per sessione, condiviso da tutti i consumatori:

```text
Sunshine: gpu-screen-recorder -w portal   (PipeWire dmabuf -> shader OpenGL -> NVENC HEVC, 30 FPS CBR, keyframe 1 s)
   | fallback: wf-recorder + hevc_nvenc (conversione colore su CPU)
Wolf:     NVENC di Wolf ! tee ! (Moonlight invariato) + queue leaky ! mpegtsmux ! shmsink /tmp/sockets
   v  MPEG-TS -> ffmpeg -c copy -> RTSP 127.0.0.1:8554/live/<session_id>
MediaMTX (omarchy-mediamtx.service, avvio/arresto on-demand)
   |-- WebRTC/WHEP  -> Omarchy Control (segnalazione via broker, media su 8189 UDP/TCP)
   |-- RTSP -> ffmpeg -c copy -> fMP4 via HTTP   (fallback se WebRTC non si connette)
   `-- RTSP -> ffmpeg -c copy -> fMP4 sul NAS    (registrazioni, identiche al live)
```

- `omarchy-gtx` e' un output headless di Hyprland: non ha un CRTC DRM, quindi la cattura KMS
  non lo vede. gpu-screen-recorder usa il portale ScreenCast; `omarchy-capture-picker` risponde
  al picker di xdg-desktop-portal-hyprland scegliendo sempre l'output in streaming.
- Sessioni Wolf: il gioco gira nel compositor del container, invisibile all'host.
  `omarchy-wolf-live-tap` aggiunge a `default_sink` di Wolf un `tee` che copia lo stream gia'
  codificato (nessuna seconda codifica) in un socket `shmsink`; la coda leaky garantisce che il
  giocatore non venga mai rallentato. Imposta anche un GOP finito (120 frame) sugli encoder NVENC,
  altrimenti chi si collega a meta' sessione non riceverebbe mai un keyframe. Le sessioni sono lette
  da `GET /api/v1/sessions` sul socket di Wolf (id `wolf-<session_id>`) e terminate con
  `POST /api/v1/sessions/stop`. Installazione:
  `sudo scripts/omarchy-setup guest multi-user wolf-live-tap --apply`, poi riavvio di Wolf.
- Installazione di Wolf: `sudo scripts/omarchy-setup guest multi-user wolf --apply`
  (`scripts/omarchy-wolf-install`, compose in `packaging/wolf/docker-compose.yml`). Segue la
  quickstart NVIDIA ufficiale (volume driver `gow/nvidia-driver`) con tre adattamenti: porte proprie
  (HTTP 49989, HTTPS 49984, RTSP 50010, UDP 49999/50100/50200) perche' Sunshine usa quelle standard,
  `WOLF_RENDER_NODE` sul nodo NVIDIA (il default `renderD128` e' la GPU virtio della VM) e
  `/tmp/sockets` + `/var/run/wolf` condivisi con l'host. In Moonlight: `<ip-vm>:49989`.
  Wolf non ha variabili di "session sharing": la condivisione tra client usa le lobby dell'API
  (vedi `docs/omarchy-multi-user-gaming.md`, "Visualizza e Prendi Controllo").
- Pascal / NVIDIA 580xx: la gpu-screen-recorder di Arch richiede l'API NVENC 13.1 (driver >= 610,
  mai disponibile per Pascal). `scripts/omarchy-build-gsr-legacy-nvenc` la ricompila contro
  `/opt/ffmpeg-nvenc` (API 13.0): cattura portale -> NVENC al 25% di CPU su 2880x1800.
  Se il portale non negozia, controllare WirePlumber (`assertion 'core != NULL' failed` nel journal).
- ffmpeg non codifica mai nel percorso principale: sposta solo i pacchetti tra contenitori
  (MPEG-TS -> RTSP, RTSP -> MP4 frammentato).
- Fallback wf-recorder: i frame arrivano a NVENC in BGRx e la conversione colore la fa NVENC
  (46% di CPU invece del 207% con `yuv420p` su CPU); librerie NVENC da `/opt/ffmpeg-nvenc`.
- HLS (`.m3u8`) non e' usato: segmenti da 1-6 s danno 2-10 s di ritardo, adatti a molti
  spettatori via CDN, non al controllo di una sessione.
- Installazione: `sudo scripts/omarchy-setup guest multi-user live-video --apply` (MediaMTX: `yay -S mediamtx-bin`).

## Pairing, dispositivi e registrazioni

- **Due server Moonlight**: Sunshine (porta `47989`) trasmette il desktop e lo Steam
  dell'amministratore; Wolf (porta `49989`) crea sandbox isolate per gli ospiti. L'invito dell'app
  usa la porta in base al ruolo e il messaggio contiene sempre `host:porta`: senza porta Moonlight
  usa `47989` e un ospite finirebbe sul desktop dell'amministratore.
- **`POST /api/pair`** `{pin, name, target: auto|sunshine|wolf, username, client_ip?}`
  (CLI: `pair --target --username`). Wolf viene accoppiato con la sua API (`GET /api/v1/pair/pending`
  -> `{pair_secret, client_ip}`, `POST /api/v1/pair/client`). `auto` sceglie Wolf se c'e' un pairing
  Wolf in attesa. Un ospite non viene mai accoppiato a Sunshine (errore esplicito).
- **Credenziali API di Sunshine**: il broker le legge a ogni pairing da `/etc/omarchy/sunshine-api.env`
  (root, `0600`; modello in `config/sunshine-api.env.example`) e non le scrive mai nei log. Il file
  lo crea `guest multi-user install --apply` con una password casuale applicata tramite
  `sunshine --creds`; `guest multi-user sunshine-api-creds --apply` la ruota. Sunshine ha un solo
  account web, quindi e' anche la password della sua web UI. La CLI del broker eseguita da utente non
  puo' leggere il file: il pairing Sunshine passa dal servizio.
- **Dispositivi** (`client_devices`): l'IP del client accoppiato viene legato all'utente (da Wolf in
  modo esatto; con Sunshine dal client connesso alle porte di pairing, se unico). `GET/POST
  /api/devices`, CLI `devices` e `map-device --ip --username`. Le sessioni Sunshine e Wolf prendono
  l'utente da qui; un IP sconosciuto appare come `sconosciuto@<ip>`.
- **Registrazione automatica**: parte solo se l'utente del dispositivo e' attivo, ha `auto_record`
  e il setting globale `auto_record_enabled` e' attivo (default `1`). Prima ogni sessione Sunshine
  veniva attribuita al primo utente del database.
- **Registrazioni**: `GET /api/recordings[?username=]` (metadati via ffprobe, in cache),
  `GET /api/recordings/stream?id=` con `Range`/206 per il seek, `DELETE /api/recordings?id=`
  (rifiutato se la registrazione e' in corso). Gli `id` sono opachi (`<radice>:<percorso relativo>`)
  e non possono uscire dalle cartelle delle registrazioni. L'app li riproduce tramite il protocollo
  Tauri `omarchy-rec://`, che inoltra le richieste Range al broker a blocchi di 4 MB.

## Integrazione con Omarchy Control

Dall'app desktop `omarchy-control`, la scheda **Sessioni** invoca periodicamente `status-json` per mostrare in tempo reale:
- Utilizzo VRAM e avviso di saturazione.
- Utenti connessi con IP client, gioco/app in esecuzione e bitrate.
- Pulsanti di azione rapida per **Prendere il controllo** (spectator/takeover) o **Disconnettere** la sessione.
- Modale dedicata per la creazione di nuovi account guest con PIN istantaneo.
