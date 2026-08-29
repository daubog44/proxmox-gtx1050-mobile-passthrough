# Microfono Windows in VoxType via Moonlight

Moonlight/Sunshine inoltrano input, video e audio prodotto dalla VM, ma non
creano una sorgente microfono PipeWire nella VM dal microfono del PC client.
Il trasporto realtime predefinito colma quel confine:

```text
Microfono Windows -> FFmpeg -> RTP/Opus (20 ms UDP)
  -> voxtype-remote-mic-rtp-receive -> PipeWire voxtype_remote_mic.monitor
  -> VoxType -> testo nella sessione Moonlight

VM demand (PTT VoxType oppure app che cattura la sorgente)
  -> SSH ristretto active/idle -> avvia/arresta FFmpeg Windows
```

RTP evita la coda di TCP: se un pacchetto arriva tardi viene scartato, non
trascritto dopo. Apre una sola porta UDP, ma la regola firewall e' limitata
all'IP del PC Windows. Lo storico `voxtype-windows-mic-tunnel.ps1` su SSH resta
nel repository come fallback cifrato, non e' il trasporto attivo.

Il processo Windows non cattura stabilmente il microfono: resta in attesa
finche' Moonlight e' in streaming e poi apre FFmpeg solo se VoxType e' armato/
in registrazione oppure se un'app della VM apre `voxtype_remote_mic.monitor`.
Questo include Discord in chiamata vocale. Il controllo usa una connessione SSH
in uscita dal PC Windows con chiave `restrict`: trasporta esclusivamente le
parole `active` e `idle`, mai audio o una shell remota.

## Come viene rilevata la richiesta del microfono (a livello di codice)

Windows non puo' sapere direttamente se un'app nella VM vuole il microfono.
La VM pubblica sempre una sorgente PipeWire vuota,
`voxtype_remote_mic.monitor`, e comunica la domanda al PC Windows tramite una
sola connessione SSH di controllo. Moonlight serve solo a tenere attivo quel
canale durante lo streaming; non trasporta il microfono.

1. Il watcher Windows controlla che il processo `Moonlight` abbia una
   connessione verso `-VmAddress` (`Test-MoonlightConnection`), su TCP oppure
   su UDP. Solo allora avvia `ssh ... voxtype-remote-mic-control-follow`.
2. Nella VM `voxtype-remote-mic-control-follow` calcola ogni 100 ms se serve
   audio. Emette `active` se VoxType e' in stato `recording`, oppure se il PTT
   ha creato `remote-mic-demand`, oppure se `pactl list short source-outputs`
   mostra un'app collegata alla sorgente `voxtype_remote_mic.monitor`.
   Quest'ultimo e' il segnale generico per Discord e per ogni altro client
   PipeWire: non dipende dal nome dell'applicazione.
3. Il binding Hyprland `SUPER + H` crea il file di domanda con
   `voxtype-remote-mic-demand arm`, aspetta 180 ms e avvia la registrazione.
   Al rilascio arresta VoxType e rimuove il file con `disarm`.
4. Lo script Windows legge solo le righe `active`/`idle`. Con `active` avvia
   un unico FFmpeg DirectShow sul microfono configurato; con `idle` usa
   `taskkill /T` sul PID noto per chiudere sia il wrapper sia il vero
   `ffmpeg.exe`. Un mutex impedisce che due watcher catturino lo stesso
   microfono; all'avvio e all'uscita elimina anche eventuali vecchi processi
   diretti **solo** all'endpoint RTP configurato.
5. FFmpeg codifica mono Opus a 16 kHz in frame RTP/UDP da 20 ms verso
   `-VmAddress:-RtpPort`. Il servizio VM riceve la porta, decodifica e invia
   PCM a `pw-cat`, che alimenta il null sink; il suo monitor e' appunto la
   sorgente che usano VoxType e Discord.

Quindi, a microfono non richiesto, il ricevitore VM resta in ascolto UDP ma
**non** esiste alcun processo Windows che apre il dispositivo fisico. Quando
Moonlight termina, il watcher chiude FFmpeg e la connessione SSH; il `trap`
del controllo rimuove il file di sessione nella VM, impedendo a un PTT rimasto
armato di riaccendere il microfono alla sessione successiva.

## Preparazione della VM

Il ricevitore deve esistere in `~/.local/bin/voxtype-remote-mic-receive` per
l'utente che esegue Hyprland e VoxType. Copiare lo script del repository e
renderlo eseguibile:

```bash
scp scripts/voxtype-remote-mic-receive daubog44@<host-vm>:/tmp/
ssh daubog44@<host-vm> '
  install -d -m 0755 ~/.local/bin &&
  install -m 0755 /tmp/voxtype-remote-mic-receive ~/.local/bin/voxtype-remote-mic-receive
'
```

In `~/.config/voxtype/config.toml` usare il backend `pipewire` e configurare
VAD con numeri TOML, quindi riavviare il servizio. Il ricevitore imposta
`voxtype_remote_mic.monitor` come sorgente PipeWire predefinita a ogni
connessione:

```toml
[audio]
device = "pipewire"
max_duration_secs = 150

[vad]
enabled = true
backend = "auto"
threshold = 0.50

[output.notification]
on_recording_start = true
on_recording_stop = true
on_transcription = true
```

Per dettatura italiana la configurazione corrente usa `model = "small"`:
occupa circa 465 MB su disco e 487 MB di VRAM, ma e' piu' accurato di `base`.
`base` (141 MB) e' invece il modello piu' rapido e leggero, con una perdita di
accuratezza. Sulla GTX 1050 da 4 GB `small` e' un compromesso consigliato.
La configurazione richiesta mantiene `on_demand_loading = true` e
`gpu_isolation = true`: il worker carica il modello solo mentre trascrive e
rilascia la VRAM al termine. A riposo resta solo l'OSD delle notifiche (circa
3 MB di VRAM), non il modello; e' normale avere un breve ritardo alla prima
pressione del PTT.

Non usare `device = "voxtype_remote_mic.monitor"`: quel nome e' una sorgente
Pulse/PipeWire, mentre VoxType accetta qui il backend `pipewire` (o `default`).
Con il nome della sorgente VoxType abortisce subito la registrazione con
`Audio device not found`.

```bash
voxtype setup vad
systemctl --user restart voxtype.service
```

`threshold = "0.50"` e `volume = "0.70"` sono invalidi: le virgolette li
trasformano in stringhe. Se il TUI di VoxType resta aperto dopo un errore,
premere `r` oppure uscire senza salvare e riaprirlo: il file gia' corretto
mostrera' VAD su `yes`.

## Automazione Windows

Per una nuova installazione o un secondo PC, il percorso consigliato e' la
[CLI centralizzata](centralized-setup-cli.md): legge IP, porta, utente e nome
del microfono da `config/omarchy.env`, file locale ignorato da Git. I comandi
manuali seguenti restano documentazione avanzata del trasporto sottostante.

### RTP/Opus realtime (installazione attiva)

Nella VM installare ricevitore e unita' utente, poi autorizzare **solo** l'IP
del PC Windows (qui `192.168.0.90`) sulla porta scelta (`40100`):

```bash
install -d -m 0755 ~/.local/bin ~/.config/systemd/user
install -m 0755 scripts/voxtype-remote-mic-rtp-receive ~/.local/bin/
install -m 0755 scripts/voxtype-remote-mic-control-follow ~/.local/bin/
install -m 0755 scripts/voxtype-remote-mic-demand ~/.local/bin/
install -m 0755 scripts/voxtype-remote-mic-ssh-dispatch ~/.local/bin/
install -m 0644 systemd/voxtype-remote-mic-rtp.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now voxtype-remote-mic-rtp.service
sudo loginctl enable-linger "$USER"
sudo ufw allow from 192.168.0.90 to any port 40100 proto udp \
  comment 'Voxtype RTP microphone Windows'
```

`enable-linger` mantiene vivo il systemd utente anche prima del login grafico:
dopo un reboot della VM il ricevitore RTP torna disponibile da solo. Non apre
il microfono Windows; quello viene aperto esclusivamente dal watcher Windows
quando riceve `active`.

La chiave SSH dedicata del PC Windows deve avere questa riga in
`~/.ssh/authorized_keys` (sostituire la parte pubblica con quella del PC):

```text
restrict,command="/home/daubog44/.local/bin/voxtype-remote-mic-ssh-dispatch" ssh-ed25519 AAAA... voxtype-windows-mic-tunnel
```

Sul PC Windows il launcher automatico e' configurabile per IP, porta e
microfono. Parte al login ma manda RTP solo quando Moonlight e' in streaming:

```powershell
.\clients\voxtype-windows-mic-rtp.ps1 -InstallAutostart `
  -VmAddress 192.168.0.28 -VmHost 192.168.0.28 -RtpPort 40100 `
  -Device 'Microphone (USB Audio Device)'
```

Per un secondo PC usare un'altra porta e una regola UFW limitata al suo IP,
oppure aggiornare la regola esistente se sostituisce il primo PC. Non avviare
insieme questo launcher e quello SSH: entrambi scriverebbero sulla stessa
sorgente PipeWire.

Per il PTT, Hyprland arma prima il microfono, attende 180 ms che DirectShow e
RTP siano pronti e poi avvia VoxType. Al rilascio ferma prima la registrazione
e poi la cattura Windows. Questa breve attesa evita di perdere la prima
sillaba senza mantenere il microfono attivo. Discord non usa il pre-roll: la
sua richiesta PipeWire viene rilevata automaticamente e apre il microfono per
la durata della chiamata.

Il watcher usa un mutex per impedire due istanze contemporanee e, all'avvio o
all'uscita, chiude soltanto gli alberi FFmpeg diretti alla porta RTP configurata.
Il controllo SSH crea inoltre un file di sessione e lo rimuove con `trap`: un
PTT rimasto armato dopo la chiusura improvvisa di Moonlight non riattiva il
microfono alla sessione successiva.

### Fallback SSH cifrato

Sul PC Windows sono necessari Windows PowerShell 5.1 (gia' incluso), OpenSSH
Client e FFmpeg. Lo script
elenca i microfoni DirectShow disponibili:

```powershell
.\clients\voxtype-windows-mic-tunnel.ps1 -ListDevices
```

Per misurare il segnale che FFmpeg riceve **prima** del tunnel (utile se VAD
vede solo silenzio), eseguire mentre si parla nel microfono:

```powershell
.\clients\voxtype-windows-mic-tunnel.ps1 -TestInput -TestSeconds 8
```

Un picco come `-21.6 dBFS` conferma che Windows consegna voce a FFmpeg; `-inf`
o un valore molto basso indica mute, dispositivo errato o assenza di segnale
già sul PC Windows.

Per isolare il trasferimento, `-TestTone` invia un tono artificiale; `-TestTunnel`
invia invece il microfono per un tempo limitato. Il primo deve produrre segnale
nella sorgente VM anche senza parlare; il secondo verifica l'intera catena con
la voce reale:

```powershell
.\clients\voxtype-windows-mic-tunnel.ps1 -TestTone -TestSeconds 8
.\clients\voxtype-windows-mic-tunnel.ps1 -TestTunnel -TestSeconds 12
```

I due indirizzi sono intenzionalmente distinti e configurabili:

- `-VmHost` e' il nome DNS/SSH oppure l'IP usato dal tunnel SSH.
- `-VmAddress` e' l'IPv4 esatta della VM associata allo stream: il watcher la
  cerca nel canale TCP di Moonlight e, per gli stream che usano solo UDP,
  riconosce i socket UDP posseduti dal processo Moonlight.

Per il setup corrente la VM usa `192.168.0.28`; non e' codificato nello script.
Per installare una nuova chiave limitata per questo PC e il task automatico:

```powershell
.\clients\voxtype-windows-mic-tunnel.ps1 -InstallKey -VmHost 192.168.0.28
.\clients\voxtype-windows-mic-tunnel.ps1 -InstallAutostart `
  -VmHost 192.168.0.28 -VmAddress 192.168.0.28
```

Il launcher per-utente `Omarchy VoxType microphone tunnel.cmd` viene creato
nella cartella Startup di Windows e parte al login, senza richiedere UAC.
Resta inattivo finche' Moonlight non apre il trasporto dello stream: una
connessione TCP verso `-VmAddress` oppure socket UDP del processo Moonlight.
Allora avvia il tunnel. Quando lo stream termina, chiude FFmpeg e SSH. Non
occorre lanciare manualmente alcuno script per ogni stream. Se SSH o Wi-Fi
cadono temporaneamente, il watcher resta in esecuzione e ritenta mentre
Moonlight mantiene lo stream.

La VM mantiene `ufw limit ssh`: è corretto, ma impedisce molti tentativi SSH
ravvicinati. Il watcher attende 15 secondi dopo un errore proprio per non
auto-bloccarsi. Non avviare copie manuali aggiuntive dello script: se il tunnel
è appena caduto, lascia lavorare il launcher e attendi circa 30 secondi.

Se il PC dispone di piu' microfoni, passare quello desiderato in entrambi i
comandi di installazione:

```powershell
.\clients\voxtype-windows-mic-tunnel.ps1 -InstallAutostart `
  -VmHost 192.168.0.28 -VmAddress 192.168.0.28 `
  -Device 'Microphone (USB Audio Device)'
```

Per cambiare IP o microfono, rieseguire `-InstallAutostart` con i nuovi
parametri: aggiorna lo stesso launcher. Su un secondo PC copiare lo script,
eseguire `-InstallKey` e poi `-InstallAutostart` con il suo microfono; ogni PC
riceve una propria chiave limitata.

## Verifica

Con Moonlight Desktop aperto, controllare nella VM:

```bash
pactl list short sources | grep voxtype_remote_mic
```

Durante lo stream la sorgente deve essere `RUNNING`; fuori dallo stream e'
normale che sia `SUSPENDED`. In questa installazione il Caps Lock fisico del
PC Windows e' rimappato a `Super`, che da solo non produce un evento bindabile
in Hyprland: tenere quindi `Caps Lock + H`, parlare, rilasciare `H` e infine
Caps Lock. Hyprland usa `SUPER + H` per inviare `voxtype record start/stop`.
`Home` resta un'alternativa; `F9` e' il fallback standard di Omarchy se il
portatile lo inoltra come vero F9 anziche' tasto funzione multimediale.

Se il launcher non parte, sul PC Windows:

```powershell
Get-Content (Join-Path ([Environment]::GetFolderPath('Startup')) 'Omarchy VoxType microphone tunnel.cmd')
```

Verificare inoltre che `-VmHost` e `-VmAddress` indichino la VM corretta. Lo
stream Moonlight puo' risultare solo UDP: in quel caso Windows non espone il
remote IP del socket, ma il watcher riconosce il socket del processo Moonlight.

## Notifica OSD e testo

In VoxType impostare su `yes` almeno **On recording start** e **On recording
stop**. Sono notifiche della VM: compaiono nella sessione Omarchy/Moonlight,
non come toast nativo di Windows. Tenere `Caps Lock + H`, parlare, poi
rilasciare `H`; se il VAD riconosce parlato, il testo viene scritto
nell'applicazione che ha il focus nella VM. Per vedere anche il risultato
nell'OSD, impostare **Show transcribed text** su `yes`.

Se non compare nulla e non viene scritto testo, distinguere prima l'innesco
dall'audio:

```bash
voxtype record start
sleep 2
voxtype status       # deve riportare recording
voxtype record cancel
```

Se torna immediatamente `idle`, controllare `journalctl --user -u
voxtype.service -n 30 --no-pager`. L'errore `Audio device not found:
'voxtype_remote_mic.monitor'` si risolve con `device = "pipewire"`, non con il
nome della sorgente. Con il dispositivo corretto i log mostrano `Using audio
device: pipewire` e l'OSD `showing`; durante la prova remota entrambi sono
stati verificati.

Se la registrazione dura alcuni secondi ma VAD termina con `Final speech
segments after filtering: 0`, eseguire prima `-TestInput`. Se Windows mostra
un picco normale ma nella VM il livello è circa `-91 dB`, la voce arriva a
FFmpeg ma il tunnel non è ancora collegato: attendere il backoff SSH e
controllare in VM `pgrep -af pw-cat`. Se anche `-TestInput` è silenzioso,
aprire **Impostazioni Windows > Sistema > Audio > Input**, selezionare il
microfono usato da FFmpeg e parlare: l'indicatore deve muoversi. Se resta
fermo, controllare mute fisico/tasto microfono del PC, livello di input,
dispositivo selezionato e accesso al microfono per le app desktop.

## Verifica effettuata il 29 agosto 2026

Con il tunnel automatico attivo sono stati misurati nella VM 30 secondi di
microfono Windows a `mean -34.2 dB`, `max -14.4 dB`. Una registrazione VoxType
successiva ha rilevato 31 segmenti VAD e ha completato la trascrizione. Questo
conferma la catena completa Windows -> RTP/Opus -> PipeWire -> VoxType; SSH
trasporta soltanto il controllo `active`/`idle`. Non serve più un comando
giornaliero sul PC Windows.
