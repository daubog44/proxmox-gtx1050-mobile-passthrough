# Omarchy Control desktop

`apps/omarchy-control` e' il pannello desktop Tauri per il setup client di un
desktop Omarchy remoto. Non sostituisce PVE o Sunshine: rende visibili i tre
contesti distinti e avvia la procedura nel contesto giusto.

| Area | Cosa fa l'app |
| --- | --- |
| Client locale | Salva il file `omarchy.env` privato, rileva rete e dipendenze, mostra il comando di installazione corretto e avvia l'automazione Windows/Fedora. Su macOS installa e avvia Moonlight, ma non espone un setup microfono incompleto. |
| VM Omarchy | Verifica l'accesso SSH e il receiver RTP. Una password temporanea puo' autorizzare la chiave dedicata; da Fedora puo' anche riallineare idempotentemente driver NVIDIA 580xx, Sunshine headless e receiver. |
| PVE | Non invia comandi al nodo: GPU/VFIO restano un'operazione amministrativa esplicita del nodo, non una pressione accidentale nella GUI client. |

## Uso

I comandi di installazione diretta per Fedora, Windows, macOS Apple Silicon e
macOS Intel sono nel [README](../README.md#installare-omarchy-control). Tutti i
pacchetti correnti sono pubblicati nelle release GitHub del progetto.

In condizioni normali bastano **hostname Omarchy** e **utente SSH**. L'app:

1. risolve il nome, per esempio `omarchy.local`, nell'IP LAN corrente;
2. determina l'IP del client dalla route usata per raggiungere la VM;
3. usa `40100/UDP` e la sorgente PipeWire predefinita come valori portabili;
4. controlla Moonlight, OpenSSH, FFmpeg/Opus, PipeWire e KDE Connect;
5. per ogni dipendenza mancante mostra il comando adatto a Windows, Fedora o
   macOS e lo apre nel terminale nativo. Su macOS rileva Homebrew anche nei
   percorsi Apple Silicon e Intel, non soltanto nel `PATH` della GUI.

**Salva localmente** scrive soltanto indirizzi e preferenze. Tutti i pulsanti
nel form sono esplicitamente `type=button`: il salvataggio non invia il form,
non ricarica la WebView e non produce piu' il flash nero della versione 0.1.1.

## Password SSH e receiver

Il receiver puo' essere sbloccato in tre modi, in ordine di precedenza:

1. password inserita nel campo della GUI, mantenuta soltanto in memoria;
2. variabile del processo `OMARCHY_SSH_PASSWORD`;
3. stessa variabile aggiunta deliberatamente dall'utente al file locale
   `omarchy.env`, protetto con permessi `0600` su Unix.

La GUI non scrive e non mostra mai la password. Se password SSH, `sudo` della
VM e `sudo` del client Fedora coincidono, il campo **Password temporanea SSH +
sudo** basta per tutto l'onboarding: su Fedora il backend esegue direttamente
lo script, senza passare da un terminale grafico gia' aperto che potrebbe
perdere le variabili del nuovo processo. Configura
`SSH_ASKPASS` sul solo processo figlio: OpenSSH richiama lo stesso eseguibile in
modalita' helper, riceve la password dall'ambiente e autorizza la chiave SSH
dedicata. Lo stesso segreto viene fornito tramite stdin a `sudo -S`, mai nella
riga di comando. La stessa credenziale alimenta `sudo` locale e remoto via
stdin: non compaiono altri prompt e il campo viene svuotato al termine. Se le password sono diverse, l'esecuzione
manuale puo' distinguere `OMARCHY_SSH_PASSWORD`, `OMARCHY_SUDO_PASSWORD` e
`OMARCHY_LOCAL_SUDO_PASSWORD`; non vanno aggiunte alla repository.

Il pulsante **Prova accesso SSH** distingue tre casi: receiver pronto,
autenticazione riuscita ma receiver mancante, oppure credenziale/host non
valido. Dopo il primo onboarding la verifica usa la stessa chiave SSH ristretta
del microfono e il solo comando in lettura `voxtype-remote-mic-status`. La
chiave non puo' aprire una shell o eseguire comandi arbitrari. In precedenza la
GUI provava invece un comando shell non autorizzato dalla chiave: il receiver
restava attivo, ma al ritorno del focus appariva falsamente disconnesso.
La chiave dedicata ha sempre precedenza sull'eventuale testo rimasto nel campo
password: una credenziale temporanea non puo' piu' sostituire e bloccare un
controllo receiver gia' funzionante. Al termine del setup la GUI attende il
risultato e aggiorna lo stato, evitando il controllo intermedio mentre i file
guest vengono riallineati.

**Configura questo client** salva prima i valori rilevati, poi apre il wizard
`onboard`. Su Fedora il wizard limita automaticamente le porte KDE
Connect al solo IP della VM, scopre i dispositivi e invia richieste di pairing
incrociate usando la sessione SSH gia' autenticata. In questo modo il consenso
e' ristretto ai due ID appena rilevati senza chiedere una seconda password o un
clic; se il demone KDE remoto non risponde, l'app mostra il fallback manuale con
notifica sul desktop Omarchy. Su macOS il pulsante di setup completo e' disabilitato
con una spiegazione, mentre installazione e avvio Moonlight funzionano; il tunnel
microfono RTP macOS non e' ancora implementato.

Su Fedora il wizard abilita inoltre il servizio firewalld `mdns`: apre soltanto
`5353/UDP` verso i gruppi multicast `224.0.0.251` e `ff02::fb`. Questo consente
a Moonlight di ricevere l'annuncio Sunshine `_nvstream._tcp`. Senza la regola,
le porte Sunshine potevano essere raggiungibili via IP ma la GUI restava su
“ricerca di host compatibili”. **Apri Moonlight** non crea piu' istanze duplicate
se il Flatpak e' gia' in esecuzione.

Il pulsante Fedora **Sincronizza Omarchy** trasferisce in una directory
temporanea privata della VM gli script inclusi nel pacchetto e avvia via SSH
`omarchy-setup guest all --apply`. La stessa operazione puo' essere ripetuta:
la guardia NVIDIA 580xx, l'output Sunshine/Hyprland headless e il receiver
microfono vengono verificati e aggiornati senza duplicare file o regole. La
directory temporanea viene eliminata al termine. Non viene usato Ansible:
l'orchestratore idempotente del progetto esiste gia' e resta l'unica fonte di
verita'. Il pulsante non modifica PVE, VFIO, VBIOS, SSDT, vTPM o LUKS.

Su Windows l'app cerca Moonlight, FFmpeg e KDE Connect anche nei percorsi
WinGet, Chocolatey e `Program Files`, quindi un'installazione appena conclusa
non resta erroneamente gialla per il `PATH` non aggiornato. Prima del wizard
ricarica inoltre il `PATH` macchina+utente. Se Moonlight non e' mai stato aperto
e il profilo Registry non esiste, il setup lascia i valori predefiniti e spiega
di aprirlo una volta, senza interrompere microfono e chiave SSH.

Dopo l'installazione l'app compare nel menu grafico come **Omarchy Control**.
I pacchetti contengono gia' gli script necessari: Node, Rust e Git non servono
sul computer client.

## Gaming, schermo 4K e risoluzione dinamica

La sezione **Gaming** legge gli schermi fisici dal sistema operativo tramite
Tauri. Se il portatile Fedora e' collegato via HDMI a una TV, nell'elenco
compaiono per esempio `eDP-1 — 1920×1080` e `HDMI-A-1 — 3840×2160`: non sono
output della VM. L'utente sceglie dove verra' mostrato Moonlight e uno dei due
profili:

- **Prestazioni 1080p**, consigliato per la GTX 1050: 1920×1080@60 e bitrate
  automatico Moonlight da 20 Mbps. La TV 4K esegue l'upscaling senza bande,
  perche' il formato resta 16:9.
- **Qualita' nativa**: usa i pixel fisici fino a 3840×2160@60 e 80 Mbps. E'
  adatto al desktop e ai giochi leggeri; un gioco moderno deve renderizzare
  quattro volte i pixel del 1080p e puo' non mantenere 60 FPS sulla GTX 1050.

Il pulsante chiude Moonlight, crea una sola copia di backup del profilo, cambia
soltanto le preferenze `[General]`/Registry/defaults e riavvia il client. Host,
certificati e pairing restano intatti. Abilita V-Sync, frame pacing,
ottimizzazioni gioco, keep-awake e bitrate automatico; codec e decoder restano
automatici, mentre HDR, YUV 4:4:4 e audio sull'host restano spenti. Le scelte
sono applicate su Linux Flatpak, Windows e macOS con il rispettivo archivio
nativo delle preferenze.

Quando parte lo stream, Moonlight passa larghezza, altezza e FPS a Sunshine.
Il modulo guest installa lo stesso hook `omarchy-moonlight-mode` su **tutte** le
app Sunshine, compresa Steam Big Picture: Hyprland porta l'output virtuale
`omarchy-gtx` alla stessa modalita' prima della cattura e lo ripristina a
1920×1080@60 alla chiusura. La risoluzione e' quindi dinamica tra una sessione
e la successiva, non durante uno stream gia' aperto. Dopo aver creato una nuova
app Sunshine, **Sincronizza Omarchy** applica idempotentemente lo stesso hook.

## Perche' Moonlight non e' incorporato

Moonlight Qt e' un client completo Qt/C++ GPL-3.0: gestisce decoder hardware,
codec, HDR, audio, input e windowing sui tre sistemi. Integrarlo direttamente
in una WebView Tauri richiederebbe fork, build Qt/SDL/FFmpeg per ogni
piattaforma e distribuzione compatibile GPL. Omarchy Control quindi rileva e
apre l'installazione ufficiale di Moonlight: il client di streaming resta
aggiornabile e responsabile della propria GPU, mentre l'app controlla setup e
diagnostica.

## Sviluppo e build

```powershell
cd apps/omarchy-control
npm install
npm run build
npm run tauri build -- --bundles nsis
```

Il backend Rust espone soltanto operazioni nominate: ispezione, discovery,
elenco schermi, profilo gaming Moonlight, verifica receiver, salvataggio, avvio Moonlight, installazione di una
dipendenza conosciuta, onboarding e sincronizzazione guest. L'installer accetta solo identificatori
presenti nella lista interna e non espone un comando shell arbitrario alla
WebView.

Tauri produce bundle nativi dalla stessa sorgente. La pipeline di release crea
RPM x86_64, NSIS x64 e DMG macOS per Apple Silicon e Intel sulla rispettiva
piattaforma CI. Prima di impacchettare esegue build TypeScript, test Rust sulla
piattaforma nativa, parser di tutti gli script PowerShell su Windows e `bash -n`
degli script client Linux su Linux/macOS. I DMG usano una firma ad-hoc e non
sono notarizzati da Apple; la CI non sostituisce una prova di microfono su un
Mac fisico.

## Confine multi-utente

Il setup corrente e' **multi-client ma a sessione singola**: piu' PC possono
essere autorizzati, ma Sunshine trasmette il desktop Hyprland dell'utente
Omarchy gia' autenticato. Un guest read-only, un amministratore e stream
simultanei richiedono un livello diverso: identita' separate, policy Sunshine,
sessioni grafiche isolate e routing del microfono verso la sessione corretta.
Non e' sicuro ottenerlo riusando la stessa password o lo stesso desktop. Questo
resta una fase successiva esplicita, non una capacita' nascosta della release.
