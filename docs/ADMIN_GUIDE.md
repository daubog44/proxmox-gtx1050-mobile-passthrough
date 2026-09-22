# Guida Amministratore: Onboarding, Gestione Nodi Cluster e Utenti su Omarchy Control

Questa guida illustra nel dettaglio tutte le procedure operative per l'amministratore del cluster **Omarchy**: come creare nuovi account per giocatori/ospiti, generare profili di connessione **WireGuard On-Demand**, montare lo storage NAS di rete, monitorare la telemetria della GPU e gestire cluster multi-nodo.

---

## 🏛️ 1. Architettura del Control Plane

Omarchy è progettato secondo i principi di **Zero-SSH Native REST API** e **Least Privilege**:

```mermaid
flowchart TD
    subgraph Admin ["Amministratore (Tu)"]
        ControlApp["Omarchy Control Desktop App"]
        TailscaleDNS["Tailscale MagicDNS (pve.tail65d87d.ts.net)"]
    end

    subgraph ClusterNode ["Nodo Cluster Omarchy (VM / Server)"]
        Daemon["omarchy-session-broker (:47995 TCP)"]
        AuthFilter["Bearer Token (omarchy_sec_...)"]
        DB[(SQLite omarchy-sessions.db)]
        NVENC["Encoder Hardware NVIDIA Pascal (GTX 1050)"]
        Wolf["Wolf / Sunshine Streaming (:47984-48010)"]
        WireGuard["WireGuard Server (wg0: 10.66.0.1)"]
    end

    subgraph Storage ["Archiviazione di Rete"]
        NAS["NAS Samba / CIFS (//192.168.0.39/nvme1)"]
    end

    subgraph Players ["Giocatori / Utenti Finali"]
        UserDevice["Moonlight (iOS / Android / PC / Steam Deck)"]
        WGClient["WireGuard On-Demand (10.66.0.x)"]
    end

    ControlApp -->|REST API < 5ms / Bearer Token| Daemon
    TailscaleDNS -.-> ControlApp
    Daemon --> DB
    Daemon --> NVENC
    Daemon --> WireGuard
    Daemon -->|Mount sicuro /etc/omarchy/nas-credentials| NAS

    UserDevice --> WGClient
    WGClient -->|Streaming Gaming con PIN (Nessun Token)| Wolf
```

- **Amministratore**: Si autentica sul daemon REST (`porta 47995`) tramite **Bearer Token** (`omarchy_sec_...`). Gestisce nodi, quote, registrazioni, utenti e storage.
- **Utenti / Ospiti**: Si collegano a WireGuard tramite profilo On-Demand generato dall'app e si associano a Moonlight tramite un **PIN numerico**. Non conoscono né hanno bisogno di password SSH, token di sistema o permessi di root.

---

## 👤 2. Procedura di Onboarding di un Nuovo Utente (Passo-Passo)

La creazione e abilitazione di un nuovo giocatore richiede **meno di 1 minuto** direttamente dall'applicazione desktop **Omarchy Control**.

### Passo 1: Crea l'account giocatore
1. Apri **Omarchy Control**.
2. Spostati nella scheda **"Utenti & Policy"** (o sezione Utenti).
3. Clicca su **"+ Aggiungi Utente"**:
   - **Username**: identificativo univoco (es. `mario`, `ospite-1`).
   - **Nome Visualizzato**: nome leggibile (es. `Mario Rossi`).
   - **PIN di Associazione**: PIN a 4-8 cifre (es. `1234`).
   - **Ruolo**: seleziona **Guest** (oppure *Admin* solo per utenti fidati che devono gestire il cluster).
   - **Bitrate Massimo (Mbps)**: es. `20 Mbps` (consigliato 20-30 Mbps per non saturare la banda di upload di casa).
   - **Applicazioni Abilitate**: seleziona le app consentite (es. `steam`, `desktop`, `retroarch`).
   - **Nodi Assegnati**: lascia `*` per consentire l'accesso a tutti i nodi, oppure specifica l'ID del nodo (es. `omarchy-local`).
4. Clicca su **"Crea Utente"**.

---

### Passo 2: Condividi l'Accesso con il pulsante "🔗 Invito 1-Click" (Zero-VPN)
Nella scheda **"Utenti & Sandbox"**, ogni scheda utente presenta il pulsante dedicato **"🔗 Invito 1-Click"**:
1. Clicca su **"🔗 Invito 1-Click"** sulla scheda del giocatore.
2. Si aprirà la finestra di invito rapido:
   - **Host Consigliato (Default)**: `cloudgamingadrian.duckdns.org` (accessibile da qualunque rete internet senza installare VPN o client Tailscale).
   - Mostra il **Link Diretto**: `moonlight://cloudgamingadrian.duckdns.org`
   - Pulsante **"⚡ Approva Codice 4 Cifre del Giocatore"**: per accoppiare subito il dispositivo dell'amico senza accedere al web manager di Sunshine.
   - Mostra il **Codice QR**: inquadrabile con la normale fotocamera di iOS / Android per aprire direttamente l'app Moonlight.
   - Menu di selezione alternativo: LAN locale (`192.168.0.28`), IP Pubblico diretto WAN, o Tailscale MagicDNS (`pve.tail65d87d.ts.net` per chi è già nella tua tailnet).
3. Clicca su **"💬 Copia Messaggio Pronto per WhatsApp / Telegram"**.
4. Incolla il messaggio all'amico:
   - L'amico tocca il link su WhatsApp o scansiona il QR.
   - Moonlight si apre automaticamente collegandosi al server.
   - Moonlight mostra al giocatore un codice PIN temporaneo di 4 cifre.
   - L'amico ti comunica il codice: clicca su **"⚡ Approva Codice 4 Cifre del Giocatore"** (o sul pulsante *Accoppia PIN Dispositivo* in testata), inserisci le 4 cifre ed è sbloccato per sempre!

---

### 🌐 3. Dynamic DNS (DuckDNS) & UPnP
- **Cos'è UPnP?** (Universal Plug and Play) È il protocollo che permette all'host di gaming di richiedere al modem di casa l'apertura temporanea e automatica delle porte necessarie a Moonlight (TCP 47984, 47989; UDP 47998-48010) senza dover configurare manualmente il router.
- **Come fa DuckDNS a conoscere il tuo IP pubblico dalla LAN?** Quando il demone di background invia una richiesta HTTP GET a `duckdns.org`, la richiesta attraversa il modem di casa. Il modem esegue il **NAT** (Source NAT), sostituendo l'indirizzo interno privato (`192.168.0.28`) con il tuo vero **IP pubblico WAN** (es. `101.58.7.26`). DuckDNS legge l'IP pubblico del mittente della connessione TCP e aggiorna il record DNS globale `cloudgamingadrian.duckdns.org`!
- **Demone di sincronizzazione**: Gestito automaticamente dal timer systemd `omarchy-ddns.timer` ogni 5 minuti sul server, e gestibile visivamente dalla sezione Enterprise dell'app.

---

### In Alternativa: Profilo WireGuard On-Demand (Per Reti Blindate o NAT Rigido)
Se la connessione dell'amico si trova sotto una rete aziendale o scolastica che blocca le porte UDP:
1. Spostati nella scheda **"Enterprise"** (sottosezione **VPN & Accesso Remoto**).
2. Clicca su **"Nuovo Peer WireGuard"**, seleziona l'utente e genera il QR code.
3. L'utente scansiona il QR e attiva l'opzione **On-Demand: Rete Dati e Wi-Fi** nell'app WireGuard.

---

## 📁 4. Gestione e Montaggio NAS Samba da Desktop

Per archiviare i gameplay registrati e i salvataggi Steam Cloud centralizzati, il server Omarchy si collega a uno share Samba di rete.

### Come configurare e montare il NAS da Omarchy Control:
1. Nella scheda **Enterprise ➜ Sezione Storage**, individua il riquadro *Stato Storage NAS*.
2. Clicca sul pulsante **"📁 Configura & Monta"**.
3. Compila i campi della finestra modale:
   - **Server / IP NAS**: indirizzo IP o hostname del NAS (es. `192.168.0.39`).
   - **Nome Condivisione (Share)**: nome dello share (es. `nvme1`).
   - **Punto di Mount**: percorso sul nodo Linux (default: `/mnt/nvme1-recordings`).
   - **Nome Utente & Password**: credenziali di accesso allo share Samba.
4. Clicca su **"⚡ Testa Connessione NAS"**:
   - Il broker esegue un test socket non invasivo sulle porte SMB (445/139) e misura la latenza di risposta in tempo reale (es. `~2.1ms`).
5. Se il test è positivo, clicca su **"💾 Monta e Salva in fstab"**:
   - Il broker scrive le credenziali nel file protetto `/etc/omarchy/nas-credentials` con permessi `chmod 600` (leggibile solo da root, **mai in chiaro in fstab**).
   - Esegue il comando `mount -t cifs`.
   - Aggiunge la riga persistente in `/etc/fstab` con opzioni resilienti `_netdev,nofail`.
   - Ricarica automaticamente la telemetria mostrando lo spazio totale e libero in GB.

### Policy di Retention e Pulizia Automatica Gameplay:
- Nel pannello **Enterprise ➜ Retention & Pulizia NAS**:
  - Imposta il periodo di conservazione massimo dei video `.mp4` (es. `30 giorni`).
  - Clicca su **"Simula"** (Dry Run) per vedere quanti file e gigabyte verrebbero liberati.
  - Clicca su **"Esegui Pulizia"** per eliminare i file scaduti e recuperare spazio.

---

## 📊 4. Monitoraggio e Controllo Live delle Sessioni

Nel pannello principale di **Omarchy Control** hai il controllo in tempo reale:

- **Telemetria Hardware Pascal**:
  - Utilizzo GPU (%) e temperatura in °C.
  - VRAM utilizzata vs totale (con avvisi visivi warning/critical se supera l'85%).
  - Numero di sessioni di encoding hardware NVENC attive simultaneamente (limite massimo simultaneo gestito dall'Admission Controller).
  - Percentuale utilizzo CPU del nodo e consumo di memoria RAM di sistema.

- **Azioni sulle Sessioni dei Giocatori**:
  - **Avvia Registrazione NAS**: avvia la registrazione video H.265 del gameplay in corso salvandola direttamente su `/mnt/nvme1-recordings/recordings/<session_id>.mp4`.
  - **Takeover / Spectator**: visualizza o affianca lo stream del giocatore per assistenza o visione condivisa.
  - **Kill Session**: forza la chiusura immediata della sessione in caso di blocco o termine del tempo di gioco.
  - **Ban Utente**: revoca istantaneamente la sessione in corso ed esclude l'utente da qualsiasi stream futuro.

---

## 🌐 5. Gestione Multi-Nodo e Tailscale MagicDNS

Omarchy supporta l'aggregazione di molteplici macchine fisiche o VM in un unico pool.

### Collegamento di un Nuovo Nodo tramite MagicDNS:
1. In alto a destra, clicca sull'indicatore del nodo attivo (o apri la finestra nodi dal pulsante delle impostazioni).
2. Nel riquadro **"🌐 Rete Tailscale / MagicDNS"**:
   - Clicca su **"Rileva"**: l'app elenca tutti i nodi attivi sulla tua tailnet (es. `pve • pve.tail65d87d.ts.net`).
   - Seleziona il nodo desiderato dal menu a tendina: il campo host viene popolato automaticamente con il nome di dominio MagicDNS.
   - Inserisci la porta del daemon (default: `47995`) e il Bearer Token del nodo.
3. Clicca su **"⚡ Testa Connessione REST API"**: l'app verifica la latenza di rete e la versione del daemon.
4. Clicca su **"Salva Configurazione e Connetti"**.

### Roaming Trasparente Casa / Fuori Casa:
- L'app desktop implementa il **Dual-Homed Auto-Failover**:
  - Quando sei a casa, interroga il nodo sulla LAN locale ad altissima velocità.
  - Quando sei fuori casa, instrada automaticamente le richieste tramite il dominio MagicDNS o il gateway WireGuard `10.66.0.1`.
  - Tu e i tuoi utenti non dovrete mai modificare indirizzi IP manualmente.

---

## 🛠️ 6. Riferimento Comandi Rapidi da Riga di Comando (CLI sul Server)

Se accedi tramite shell SSH o console al server Omarchy, puoi utilizzare il comando integrato:

```bash
# Mostra il Bearer Token attivo dell'API REST
omarchy-session-broker token

# Rigenera un nuovo Bearer Token casuale
omarchy-session-broker token --reset

# Mostra lo stato di utenti, sessioni e storage in formato JSON
omarchy-session-broker status

# Avvia il daemon manualmente in ascolto su tutte le interfacce
omarchy-session-broker daemon --port 47995 --bind 0.0.0.0

# Controlla lo stato del servizio di sistema
sudo systemctl status omarchy-session-broker.service

# Riavvia il servizio del broker
sudo systemctl restart omarchy-session-broker.service
```

---

## ⚡ 7. Sblocco Sessioni NVENC Hardware e Scalabilità RAM (Proxmox)

### Rimozione del limite hardware a 2 sessioni NVENC:
I driver NVIDIA GeForce per Pascal limitano artificialmente a 2 il numero di flussi di codifica hardware simultanei. Omarchy include uno strumento automatizzato per rimuovere questa restrizione sia sul sistema host che nel volume container di Wolf:

```bash
# Verifica lo stato della patch NVENC
omarchy-patch-nvenc status
# oppure tramite setup:
scripts/omarchy-setup guest nvidia patch

# Applica la patch e sblocca l'Admission Controller a 4 stream
sudo omarchy-patch-nvenc apply
# oppure tramite setup:
sudo scripts/omarchy-setup guest nvidia patch --apply
```

- **Persistenza garantita**: Viene installato un hook Pacman (`/etc/pacman.d/hooks/99-omarchy-nvidia-nvenc-patch.hook`) che riapplica automaticamente la patch in caso di reinstallazione o aggiornamento del driver NVIDIA.
- **Sincronizzazione Wolf**: Il volume Docker `nvidia-driver-vol` viene sincronizzato all'istante e il container `wolf` riavviato automaticamente.

### Scalabilità RAM su Host Proxmox (Fino a 3-4 Istanze di Gioco):
L'host Proxmox fisico dispone di 16 GB di RAM. Se desideri eseguire 3 o 4 istanze di giochi come Minecraft per utenti differenti:

> [!IMPORTANT]
> A causa del passthrough PCIe hardware (`hostpci0`), la memoria della VM viene interamente bloccata (pinned) dal kernel host per la gestione DMA / IOMMU. Il memory ballooning dinamico non deve essere utilizzato (`-balloon 0`). L'impostazione ideale è 12 GB (12288 MB), lasciando circa 3,8 GB a Proxmox per il sistema base e la cache ZFS.

```bash
# Sul nodo Proxmox (shell PVE):
# Alloca 12 GB fissi alla VM 1002 disattivando il ballooning:
qm set 1002 -memory 12288 -balloon 0
```
La modifica è permanente e richiede il riavvio della VM per il riallineamento delle pagine IOMMU.

---

## 🧹 8. Bonifica Automatica Risorse & Manutenzione Server On-Demand

Omarchy include uno strumento di manutenzione automatica periodica (`omarchy-resource-reaper`) per prevenire accumuli di log, file temporanei e processi orfani senza mai interferire con il desktop dell'amministratore:

* **Perimetro di sicurezza**: I processi del desktop admin (`Hyprland`, `Sunshine`, `QuickShell`, `PipeWire`, `WirePlumber`, browser e giochi attivi) sono esplicitamente protetti e **mai toccati**.
* **Cosa bonifica lo script**:
  1. **Menu orfani in spin-loop**: Intercetta script bash di menu popup (`omarchy-menu-*`) rimasti appesi per più di 10 minuti con sleep ad alta frequenza.
  2. **Monitor terminale orfani**: Termina eventuali processi `htop` o `nvtop` rimasti attivi su pseudoterminali (PTS) chiusi da oltre 1 ora.
  3. **File temporanei e socket obsoleti**: Rimuove file SDP e buffer di preview più vecchi di 30-60 minuti in `/tmp`.
  4. **Container e immagini Docker dangling**: Esegue `docker container prune` e `docker image prune` per liberare spazio su disco.
  5. **Compattazione Systemd Journal**: Esegue il vacuuming dei log a massimo 100 MB e 7 giorni di retention (`journalctl --vacuum-size=100M --vacuum-time=7d`).
  6. **Buffer Sync**: Sincronizza i blocchi disco per garantire la consistenza del filesystem.

### Gestione Reaper CLI e Timer Systemd:

```bash
# Esecuzione manuale o simulata (dry-run):
omarchy-resource-reaper --dry-run --verbose
omarchy-resource-reaper --verbose

# Gestione tramite setup centrale:
scripts/omarchy-setup guest multi-user reaper --apply

# Verifica del timer periodico (eseguito ogni 30 minuti):
systemctl list-timers omarchy-resource-reaper.timer
```


