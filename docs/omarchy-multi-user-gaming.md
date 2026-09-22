# Omarchy multiutente: Sunshine, Wolf e limiti della GTX 1050 Mobile

Questo documento descrive la convivenza tra lo streaming proprietario a bassa latenza per l'Owner e le sessioni concorrenti per gli utenti secondari, tenendo conto dell'architettura hardware della GPU NVIDIA GP107M (GTX 1050 Mobile 4GB Pascal), della sicurezza tramite sandbox e dell'isolamento di rete.

## Ruoli e separazione dei flussi

L'infrastruttura differenzia nettamente i due scenari d'uso:

1. **Host Principale (Owner / Amministratore)**:
   - Utilizza **Sunshine** nativo su Hyprland headless con uscita virtuale `omarchy-gtx`.
   - Ha accesso completo e non mediato al desktop principale della VM.
   - Profilo ad alte prestazioni predefinito: **Full HD 60 FPS** (20 Mbps) o **4K 30 FPS** (40 Mbps).
   - Priorità assoluta sull'allocazione della memoria VRAM e sull'encoder NVENC.
   - **Poteri esclusivi**: monitoraggio live telemetria, controllo takeover delle sessioni, disconnessione forzata (kick), creazione account e **registrazione video delle sessioni su NAS Samba**.

2. **Sessioni Concorrenti (Guest / Utenti secondari)**:
   - Vengono eseguite tramite **Wolf** (Games on Whales) in ambienti containerizzati e isolati.
   - Ogni utente secondario ha:
     - Un account Linux senza shell di login.
     - Uno spazio di archiviazione dedicato in `/var/lib/omarchy-sessions/<username>`.
     - Un profilo Steam separato o una sessione Big Picture dedicata.
     - Un PIN di pairing personale inserito nell'app Moonlight del client.

## Sandbox di sicurezza per le sessioni Wolf

Ogni gioco o desktop di un ospite gira in un container Docker avviato da Wolf. Cosa separa davvero
l'ospite dall'admin e dagli altri ospiti:
- **Schermo, input e audio propri**: compositor Wayland virtuale di Wolf, tastiera/mouse/pad virtuali
  (uinput) e sink audio per sessione. Il desktop Hyprland dell'admin (Sunshine) non è visibile.
- **Nessun file della VM**: il container non monta cartelle dell'host oltre ai dati del proprio profilo
  Wolf (sotto `/etc/wolf`) e non ha il socket Docker.
- **Profilo per utente**: PIN, solo le app consentite, dati e salvataggi separati; il profilo "User"
  aperto di Wolf viene bloccato con un PIN casuale.
- **Rete isolata** (sezione seguente).

Limiti noti (accettati per non rompere Steam): i container mantengono i permessi con cui Games on
Whales li distribuisce (`SYS_ADMIN`, `NET_ADMIN`, seccomp/AppArmor `unconfined`, IPC dell'host),
necessari alla sandbox interna di Steam (pressure-vessel, usata anche da Proton). È un isolamento da
container, non da VM: kernel, driver NVIDIA e GPU sono condivisi. Adatto a ospiti di fiducia.

## Isolamento di rete (rete ospiti e firewall)

Gli ospiti devono poter scaricare giochi e giocare online, ma **non raggiungere la rete locale**.
`scripts/omarchy-wolf-network-isolation apply` (eseguito da `omarchy-wolf-install` e a ogni avvio da
`omarchy-wolf-network-isolation.service`):
- crea la rete Docker **`omarchy-guests`** (bridge `br-wolf-guest`, `10.99.50.0/24`) senza comunicazione
  tra container: gli ospiti non si vedono tra loro;
- il broker imposta `HostConfig.NetworkMode = omarchy-guests` su ogni app dei profili Wolf (solo se la
  rete esiste, così un gioco non resta mai senza rete);
- catena `OMARCHY-GUESTS`: DNS consentito; respinti `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
  (LAN, NAS, Proxmox, router), `100.64.0.0/10` (tailnet) e `169.254.0.0/16`; il resto (Internet)
  esce con il NAT di Docker;
- catena `OMARCHY-GUESTS-IN`: nessuna porta della VM raggiungibile dai container (SSH, broker,
  web UI di Sunshine, MediaMTX).

Lo streaming non passa dai container: Moonlight parla con Wolf, che usa la rete dell'host.
Verifica: `sudo omarchy-wolf-network-isolation status`.

## Registrazione sessioni su NAS Samba (`smb://192.168.0.39/nvme1`)

L'amministratore può avviare e fermare la registrazione video di qualsiasi sessione attiva direttamente dall'app desktop:
- **Punto di mount**: la share Samba di rete viene montata sulla VM Omarchy nel percorso `/mnt/nvme1-recordings` (configurazione in `config/samba-mount-nas.env.example`).
- **Formato file**: cattura video MP4 a 60 FPS con codifica **H.265 / HEVC ad alta efficienza** (`hevc_nvenc` con fallback `libx265`, tag nativo QuickTime `hvc1`) organizzata in `/mnt/nvme1-recordings/recordings/<username>/<timestamp>_<gioco>_hevc.mp4`.
- **Spool di emergenza**: se la share NAS non risulta momentaneamente montata, il broker reindirizza automaticamente la registrazione nello spool locale temporaneo (`/var/spool/omarchy-recordings/`) per evitare perdite di dati.
- **Controllo desktop**: un pulsante dedicato nella tabella sessioni live permette di avviare (**⏺ Registra**) o fermare (**⏹ Ferma Rec**) la registrazione, con badge rosso lampeggiante `● REC NAS`.

## Budget VRAM e limiti della GTX 1050 Mobile (4 GB)

La GPU fisica dispone di **4096 MiB di VRAM GDDR5**. La suddivisione delle risorse durante il gaming multi-utente e' la seguente:

| Elemento | Consumo VRAM stimato | Note |
| --- | --- | --- |
| Hyprland headless + driver NVIDIA base | ~350 MiB | Risorse fisse all'avvio |
| Sessione Owner (Sunshine + gioco 1080p) | ~1800 - 2200 MiB | Buffer di rendering + superfici frame grabber CUDA |
| Sessione Guest Wolf (Steam 720p/1080p leggero) | ~800 - 1100 MiB | Container isolato con allocazione video dedicata |
| **VRAM Totale impegnata** | **~3000 - 3650 MiB** | **Entro la soglia di sicurezza del 90%** |

### Limiti di concorrenza e Rimozione Blocco NVENC (nvidia-patch)
- **Driver Stock (senza patch)**: limitato dal driver NVIDIA a un massimo di **2 sessioni NVENC simultanee**.
- **Driver Patchato (`omarchy-patch-nvenc`)**: sblocca il limite a **sessioni illimitate** (gestite via Admission Control fino a 4 flussi concorrenti).
- **1 sessione Owner (Full HD) + 1 sessione Guest (1080p o 720p)**: funzionamento ottimale, FPS stabili a 60 FPS senza drop di fotogrammi.
- **Fino a 3 o 4 sessioni leggere (es. Minecraft / giochi 2D / retro)**: sostenibili con driver patchato (`omarchy-setup guest nvidia patch --apply`), a condizione di scalare la RAM della VM Proxmox a 12-14 GB (vedi sezione Minecraft).
- **Wolf Lobbies (Co-op / Party sullo stesso gioco)**: consente a più giocatori di partecipare alla stessa partita con gamepad separati impegnando **1 solo flusso NVENC**.

### Benchmark Istanze Multiple: Caso Minecraft
Minecraft (Java con Sodium/Fabric o Bedrock) ha un'impronta ideale per la virtualizzazione multi-utente:
- **VRAM per istanza**: ~350 - 550 MB a 1080p con 8-12 chunk di render distance. Su 4 GB di VRAM della GTX 1050, 3-4 istanze occupano ~1.5 - 2.2 GB.
- **RAM VM**: ogni istanza client richiede ~1.5 - 2 GB di memoria. Per 3-4 giocatori simultanei si raccomanda di aumentare la RAM della VM Proxmox da 8 GB a **12 GB o 14 GB** (es. `qm set 1002 -memory 12288`).
- **Throughput Encoder**: il silicio Pascal GP107 regge fino a ~250-300 FPS totali di compressione H.265. Con 3 flussi a 1080p60 o 720p60 il carico di encoding si attesta intorno al 60-70%.


## Controllo, Takeover e Ban (Omarchy Control)

Dall'applicazione desktop `omarchy-control`, l'Owner dispone del pannello di controllo unificato per:
- **Monitoraggio live**: visualizza FPS, risoluzione, bitrate effettivo e VRAM occupata per ciascuna sessione aperta.
- **Spectator / Affiancamento**: visualizzazione dello stream del guest senza interrompere i suoi comandi (utile per supporto o condivisione schermo).
- **Takeover esclusivo**: acquisizione del controllo della sessione con sospensione degli input remoti del client guest.
- **Disconnessione forzata (Kick)**: arresto immediato del container o del processo della sessione qualora la GPU raggiunga temperature elevate o saturazione VRAM.
- **Comando Ban / Unban**: consente all'amministratore di revocare all'istante l'accesso a un utente indesiderato, terminando forzatamente qualsiasi processo attivo ma **mantenendo intatta al 100% la cartella home e i salvataggi**. L'utente può essere sbannato in un click senza perdite di dati.

## Confronto Codec: H.264 vs HEVC (H.265) su Pascal GP107

Il chip NVIDIA Pascal GP107 integrato nella GTX 1050 Mobile possiede un encoder hardware **NVENC di 6ª generazione** con supporto nativo sia ad H.264 sia ad HEVC (H.265 Main e Main10 fino a 4K).

| Parametro | H.264 (AVC) | HEVC (H.265) | Raccomandazione Pascal GTX 1050 |
| --- | --- | --- | --- |
| **Efficienza di compressione** | Standard | +30% - 40% a parità di bitrate | **HEVC è superiore**: a 20 Mbps in 1080p60 azzera artefatti e sfocature su fogliame e movimenti rapidi |
| **Latenza di encoding NVENC** | ~2.5 - 4 ms | ~3.0 - 4.5 ms | Sostanzialmente identica su GP107 (differenza impercettibile < 1 ms) |
| **Supporto colore 10-bit** | Limitato/8-bit | Nativo Main10 (HDR ready) | HEVC garantisce gradienti più puliti senza banding |
| **Compatibilità Client** | Universale (100% dispositivi) | Ampia (Apple Silicon, PC recenti, Android/iOS) | H.264 rimane ideale come fallback per vecchi thin client o browser |
| **Overhead VRAM encoder** | ~45 MiB per istanza | ~65 MiB per istanza | Entrambi trascurabili sui 4 GB della scheda |

**Verdetto**: **HEVC è il codec consigliato** per Moonlight su tutti i client moderni (Mac M-series, PC Windows con GPU dedicata, smartphone recenti). Impostare H.264 solo come fallback di compatibilità per hardware client obsoleto che non decodifica HEVC via hardware.

## Funzionamento del Live Takeover e della Registrazione

### 1. Visualizza e Prendi Controllo

Le due azioni sono distinte e non richiedono variabili d'ambiente di Wolf: Wolf non ha un
interruttore di "session sharing". La condivisione di una sessione tra piu' client Moonlight si fa
con le **lobby** della sua API HTTP (socket `/var/run/wolf/wolf.sock`, `games-on-whales/wolf`
`api/unix_socket_server.cpp`).

- **Visualizza** (silenziosa, nessun input): video dallo stream gia' codificato. Sessioni Sunshine
  dall'output `omarchy-gtx`, sessioni Wolf dal tap `omarchy-wolf-live-tap`. Non viene inviato nulla a
  Wolf e l'ospite non riceve notifiche.
- **Prendi Controllo**:
  - Sunshine: lo stato diventa `shadowed`, l'ospite riceve la notifica `hyprctl notify` e l'Owner si
    collega con Moonlight allo stesso desktop.
  - Wolf: l'Owner deve avere **una sessione Moonlight gia' aperta verso Wolf** dallo stesso
    dispositivo (porta `49989`). Il broker trova la lobby in cui gioca l'ospite
    (`GET /api/v1/lobbies`, campo `connected_sessions`), individua la sessione dell'Owner dal suo IP
    (`GET /api/v1/sessions`) e la sposta nella lobby con `POST /api/v1/lobbies/join`
    (`{"lobby_id", "moonlight_session_id", "pin"}`). Da quel momento l'Owner vede lo stesso gioco e
    condivide mouse, tastiera e joypad: e' controllo condiviso, non osservazione passiva.
    `POST /api/sessions/<id>/release` (o `omarchy-session-broker release-session`) usa
    `/api/v1/lobbies/leave`.
  - Gli ospiti avviano i giochi da **Wolf UI**, che li esegue sempre come lobby. La Wolf UI ufficiale
    crea lobby single-user con "Start" (Wolf rifiuta il join: "Lobby is full"); Omarchy installa
    `omarchy/wolf-ui:coop` (`scripts/omarchy-wolf-ui-coop`: stesso commit upstream con una sola
    modifica, `MultiUser = true` in `OnStartPressed`), quindi ogni partita e' affiancabile.
    L'API di Wolf nasconde il profilo Moonlight, quindi `apply` cambia l'immagine direttamente in
    `/etc/wolf/cfg/config.toml` a Wolf fermo (backup `config.toml.omarchy-bak-*`).
    Lobby manuali: `omarchy-session-broker wolf-lobby-create --app-id <id> --name "Serata" [--pin 1234]`
    (o `POST /api/wolf/lobbies`), elenco con `wolf-lobbies`, arresto con `wolf-lobby-stop --id <lobby>`.

### Utenti e sandbox Wolf

Creando, modificando, bannando o eliminando un utente Omarchy il broker aggiorna il suo **profilo
Wolf** `omarchy-<utente>` (API `/api/v1/profiles/add|remove`, salvato da Wolf in `config.toml`):
PIN = PIN dell'utente, app = solo quelle consentite (`steam` -> Steam, `desktop` -> Desktop (xfce),
`retro` -> RetroArch ed EmulationStation, `firefox` -> Firefox). I salvataggi di ogni profilo stanno
in `profile-data/<profilo>/`, separati dagli altri. Il profilo generico "User" di Wolf (tutte le app,
nessun PIN) resta solo come catalogo e viene bloccato con un PIN casuale. Sincronizzazione completa
all'avvio del broker o con `omarchy-session-broker wolf-sync-profiles`.

Installazione completa del server con un solo comando: `sudo scripts/omarchy-setup guest multi-user deploy --apply`.

### 2. Registrazione video con FFmpeg
Il Session Broker gestisce la registrazione direttamente dal backend:
1. All'avvio della registrazione (**"⏺ Registra"**), il broker genera un processo in background `ffmpeg`.
2. FFmpeg intercetta il buffer grafico della sessione guest dal frame grabber PipeWire/DRM o via stream loopback, senza alcun impatto prestazionale per il giocatore.
3. Codifica il flusso in **MP4 H.265 / HEVC a 60 FPS** ad alta efficienza (`hevc_nvenc` hardware o `libx265`, con tag `hvc1` per compatibilità nativa macOS/iOS), riducendo l'impronta su disco e banda del 40% rispetto ad H.264.
4. Il flusso video viene scritto **in streaming continuo direttamente nel punto di mount Samba** (`/mnt/nvme1-recordings/recordings/<user>/...`).
5. Alla pressione di **"⏹ Ferma Rec"**, il broker invia un segnale `SIGINT` (non un `SIGKILL`) a FFmpeg: questo consente la corretta scrittura dell'atom `moov` finale dell'MP4, rendendo il file immediatamente riproducibile e non corrotto.

## Isolamento Account Steam e Ciclo di Vita dei Salvataggi

Ogni utente guest creato tramite il broker riceve un'infrastruttura completamente autonoma in `/var/lib/omarchy-sessions/<username>`:
- **Steam Separato**: ogni ospite esegue la propria istanza di Steam con le proprie credenziali personali (Steam Guard, token di sessione, lista amici, libreria giochi). Nessun ospite può accedere all'account dell'Owner né a quello di altri ospiti.
- **Prefissi Proton Isolati**: la cartella `compatdata/<appid>` (registro Windows virtuale, AppData) è confinata alla cartella home dell'utente con permessi restrittivi `0750`.
- **Steam Cloud**: i giochi che supportano Steam Cloud sincronizzano automaticamente i salvataggi sui server di Valve al termine di ogni sessione.

### Gestione dei Dati di Gioco: Ban vs Archiviazione vs Eliminazione

Per evitare la perdita accidentale di ore di gioco, il sistema prevede tre livelli distinti:

1. **Ban Utente (`ban-user`)**:
   - **Azione**: interrompe la sessione attiva, revoca i token di accoppiamento e blocca futuri avvii.
   - **Dati di gioco**: **Preservati al 100%**. La cartella home `/var/lib/omarchy-sessions/<username>` non viene toccata.
   - **Ripristino**: con il comando `unban-user`, l'ospite può riprendere a giocare esattamente da dove era rimasto.
2. **Archiviazione (`remove-user --archive`)**:
   - **Azione**: rimuove l'utente dalle autorizzazioni attive di Wolf e congela il profilo in SQLite (`status = 'archived'`).
   - **Dati di gioco**: la cartella home viene mantenuta integra o zippata in `/var/lib/omarchy-archives/<user>_<data>.tar.zst` per liberare spazio conservando i salvataggi.
3. **Eliminazione Completa (`remove-user` senza `--archive`)**:
   - **Azione**: cancellazione definitiva del profilo da SQLite e dell'utente Linux (`userdel`).
   - **Dati di gioco**: la cartella locale `/var/lib/omarchy-sessions/<username>` viene eliminata. Se il gioco utilizzava **Steam Cloud**, i salvataggi restano al sicuro sui server Steam del giocatore e torneranno disponibili ovunque egli effettui il login. Se il gioco non aveva cloud save, i file locali andranno persi.

## Come la Registrazione scrive sul NAS se il Bridge blocca la Rete?

Un dubbio frequente riguarda il motivo per cui la registrazione video riesca a comunicare con il NAS Samba (`smb://192.168.0.39/nvme1`) se il bridge `br-wolf-guest` blocca l'accesso alla subnet `192.168.0.0/16`.

La spiegazione risiede nella **separazione dei Network Namespace di Linux**:

```
+-------------------------------------------------------------------------+
|                  OMARCHY VM / HOST ROOT NAMESPACE                       |
|                                                                         |
|  [ Interfaccia Fisica: ens18 / eth0 ] ----> [ Rete Locale 192.168.0.x ] |
|                                                        |                |
|  - Demone Session Broker                               v                |
|  - Processo FFmpeg di Registrazione --------> [ NAS Samba 192.168.0.39 ]|
|  - Mount Point Locale /mnt/nvme1-recordings                             |
|                                                                         |
|  +-------------------------------------------------------------------+  |
|  |             GUEST CONTAINER NAMESPACE (ISOLATO)                   |  |
|  |                                                                   |  |
|  |  [ Interfaccia Virtuale: veth ] <---> [ Bridge br-wolf-guest ]    |  |
|  |                                                |                  |  |
|  |  - Gioco / Steam Big Picture                   v                  |  |
|  |  - IP: 10.99.50.x                    [ FIREWALL IPTABLES ]        |  |
|  |                                                |                  |  |
|  |        Verso 192.168.0.0/16 (NAS, PVE, Router) | ==> DROP / REJECT|  |
|  |        Verso WAN (Internet / Steam Store)     | ==> CONSENTITO   |  |
|  |        Verso Moonlight Client (UDP)           | ==> CONSENTITO   |  |
|  +-------------------------------------------------------------------+  |
+-------------------------------------------------------------------------+
```

1. **Il container del guest è isolato**: il gioco dell'utente guest vive all'interno di un proprio namespace di rete collegato alla rete Docker `omarchy-guests` (bridge `br-wolf-guest`, `10.99.50.0/24`). Le regole iptables si applicano a questo traffico e **bloccano ogni tentativo del guest di contattare il NAS a 192.168.0.39**, Proxmox o altri host LAN.
2. **FFmpeg e il Broker risiedono nel root namespace dell'host**: la registrazione non viene eseguita all'interno del container guest! Viene eseguita dall'host/VM madre, che ha accesso completo alla rete locale fisica (`ens18`).
3. **Flusso di registrazione**: FFmpeg cattura i fotogrammi dalla memoria grafica dell'host e scrive su `/mnt/nvme1-recordings`, che è una share CIFS montata dal sistema operativo host.
4. **Sicurezza totale garantita**: l'utente secondario non può né vedere né attaccare il NAS Samba, mentre il sistema di amministrazione archivia le registrazioni in tempo reale senza violare le regole di isolamento.

