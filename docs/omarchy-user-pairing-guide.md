# Guida al Pairing e Configurazione Nuovi Utenti (Wolf & Moonlight)

Questa guida illustra la procedura completa per creare un nuovo profilo utente sulla workstation **Omarchy** e accoppiare il client di streaming **Moonlight** su qualsiasi dispositivo (PC, Mac, smartphone, tablet o TV) tramite **Wolf**, garantendo il completo isolamento e la massima efficienza in **H.265/HEVC**.

---

## Panoramica Architetturale

* **Owner / Admin (Sunshine)**:
  * Utilizza il desktop nativo principale accelerato dalla GPU NVIDIA GTX 1050 mobile.
  * Accesso diretto e privilegiato tramite Sunshine alla massima frequenza e qualità.
* **Utenti Ospiti / Secondari (Wolf)**:
  * Si collegano a stanze streaming indipendenti gestite da Wolf.
  * Ciascun utente dispone di un proprio account Linux sandbox (`/home/<utente>`), credenziali isolate e un proprio account Steam.
  * Nessun accesso al desktop o ai file personali dell'Owner o degli altri ospiti.
  * Banda e encoder video limitati per garantire stabilità e assenza di lag per tutti.

---

## Procedura Passo-Passo per il Pairing

```
+---------------------------+       +---------------------------+       +---------------------------+
|  1. ADMIN (Omarchy App)   |       |    2. OSPITE (Moonlight)  |       |    3. SERVER (Wolf)       |
|  Crea utente con PIN      | ----> |    Trova Host su LAN/VPN  | ----> |    Valida Pairing         |
|  (es. "mario", PIN: 4821) |       |    Inserisce IP/PIN       |       |    Associa Certificato    |
+---------------------------+       +---------------------------+       +---------------------------+
                                                                                  |
                                                                                  v
                                                                        +---------------------------+
                                                                        | 4. SESSIONE ISOLATA       |
                                                                        | Avvio Steam Big Picture   |
                                                                        | Encoding H.265 / HEVC     |
                                                                        +---------------------------+
```

---

### Fase 1: Creazione dell'Utente da Omarchy Control (Admin)

1. Apri l'applicazione desktop **Omarchy Control**.
2. Accedi come amministratore:
   * **Username**: `admin`
   * **Password**: quella che hai scelto al primo avvio. Non esiste una password predefinita:
     al primo avvio (o aggiornando da una versione <= 0.3.0) l'app mostra la schermata
     **"Imposta la password"** (almeno 10 caratteri). Per reimpostarla, chiudi l'app ed elimina
     `omarchy-admin.auth` dalla cartella di configurazione dell'app.
3. Nel menu laterale, seleziona la scheda **"03 Gestione Utenti"**.
4. Clicca sul pulsante in alto a destra: **"+ Aggiungi Nuovo Utente"**.
5. Compila la modale:
   * **Username Linux/Wolf**: ad esempio `mario` (tutto minuscolo, senza spazi o caratteri speciali).
   * **Nome visualizzato**: ad esempio `Mario Rossi`.
   * **PIN di accoppiamento**: clicca su **"Genera"** per ottenere un PIN casuale a 4 cifre (es. `4821`) oppure digitalo manualmente. *Comunica questo PIN all'utente ospite.*
   * **Limite Bitrate**: seleziona `15 Mbps` o `20 Mbps` (valore ottimale per 1080p a 60 FPS in H.265 senza saturare l'encoder NVENC della GTX 1050).
   * **Applicazioni assegnate**: spunta le app che l'utente può avviare (es. `Steam Big Picture` e/o `Desktop Isolato`).
6. Clicca **"Crea Profilo Utente"**.
   * Il backend crea automaticamente l'ambiente isolato, la home directory `/home/mario`, la configurazione Wolf e registra il PIN nel database SQLite.

---

### Fase 2: Configurazione sul Dispositivo del Nuovo Utente (Client)

1. L'utente ospite installa **Moonlight Game Streaming** sul proprio dispositivo:
   * **PC / Laptop**: Windows, macOS o Linux (disponibile su [moonlight-stream.org](https://moonlight-stream.org) o Flatpak).
   * **Mobile**: Android (Google Play) o iOS/iPadOS (App Store).
   * **TV**: Apple TV, Android TV / Google TV o LG webOS.
   * **Handheld**: Steam Deck, ROG Ally, Lenovo Legion Go.
2. Il dispositivo dell'ospite deve essere connesso alla **stessa rete locale** (LAN cablata o Wi-Fi 5GHz) del server Omarchy, oppure tramite VPN (es. WireGuard o Tailscale).

---

### Fase 3: Rilevamento Host ed Esecuzione del Pairing

1. Apri **Moonlight** sul dispositivo ospite.
2. **Rilevamento Automatico**:
   * Se l'host `Omarchy` o `Wolf` compare automaticamente nell'elenco computer, cliccaci sopra.
3. **Aggiunta Manuale** (se non compare automaticamente):
   * Clicca sull'icona **"+"** (Aggiungi Host) in alto a destra.
   * Inserisci l'indirizzo IP della VM Omarchy (es. `192.168.0.x`).
4. **Handshake e Inserimento PIN**:
   * Cliccando sull'host, Moonlight mostrerà un dialogo di accoppiamento:
     * **Modalità Diretta**: Se richiesto, inserisci il PIN a 4 cifre generato al punto 1 (es. `4821`).
     * **Modalità Certificato Client**: Se Moonlight visualizza un codice generato dal dispositivo (es. `8520`), l'admin può validarlo su Wolf tramite il comando:
       ```bash
       wolf pair --pin 8520 --user mario
       ```
5. Al termine dell'handshake, l'icona del computer in Moonlight mostrerà un lucchetto aperto e diventerà subito cliccabile.

---

### Fase 4: Avvio del Gioco in Streaming

1. Clicca sull'host Omarchy sbloccato in Moonlight.
2. Appariranno le sole applicazioni abilitate dall'amministratore (es. **Steam Big Picture**).
3. Cliccando su **Steam Big Picture**:
   * Wolf genera un container con Wayland isolato dedicato all'utente.
   * La sessione si avvia con streaming video compresso in **H.265/HEVC hardware** a bassissima latenza.
   * L'utente inserisce le proprie credenziali Steam personali ed è pronto a giocare con la propria libreria, salvataggi Steam Cloud e impostazioni private.

---

### Fase 5: Monitoraggio e Controllo dall'App Amministratore

Durante la sessione di gioco dell'ospite, l'Admin può:
* **Monitorare la VRAM e GPU**: controllare in tempo reale nella scheda **"01 Dashboard"** l'utilizzo della memoria VRAM e la temperatura della GTX 1050.
* **Affiancare la sessione (Takeover / Spectator)**: nella scheda **"02 Sessioni Live"**, cliccare su **"Prendi Controllo"** per assistere l'ospite o visualizzare il gameplay in tempo reale.
* **Registrare la sessione su NAS Samba**: cliccare su **"⏺ Registra"** per avviare la cattura automatica in MP4 H.265 direttamente sulla share di rete `smb://192.168.0.39/nvme1/omarchy-recordings`.
* **Disconnettere o Bannare l'utente**: cliccare su **"Disconnetti"** per terminare immediatamente la lobby e liberare VRAM, oppure su **"Banna"** nella scheda Utenti per revocare l'accesso preservando tutti i suoi dati di gioco.
