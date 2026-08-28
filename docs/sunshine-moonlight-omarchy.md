# Omarchy, Sunshine e Moonlight: diagnosi e risultato

Questa pagina spiega **perche'** lo streaming iniziale era corrotto o lento e
cosa e' stato verificato. I file da applicare, il rollback e la configurazione
PVE/guest vivono nel solo [runbook Omarchy](omarchy-proxmox-guest-setup.md), per
evitare di mantenere due procedure quasi identiche.

## Risultato verificato

La VM Omarchy `1002` usa la GTX 1050 PCI passed-through per il desktop
headless e per la codifica. `vga: virtio` resta soltanto la console noVNC di
recupero: non e' il renderer di Hyprland.

```text
GTX /dev/dri/gtx1050
  -> Hyprland (render/compositing)
  -> output Wayland headless omarchy-gtx
  -> Sunshine riceve larghezza/altezza/FPS da Moonlight
  -> helper Lua `hl.monitor(...)` imposta l'output per quello stream
  -> Sunshine wlr/GBM -> FFmpeg h264_nvenc oppure hevc_nvenc -> NVENC GTX
  -> Moonlight
```

Durante il precedente stream valido le prove erano:

```text
Hyprland  ... G                    # processo grafico sulla GTX
sunshine  ... C+G ... enc=28       # NVENC in uso durante lo stream HEVC
Video stream: 1920x1200 60.19 FPS (Codec: HEVC)
Host processing latency min/max/average: 7.6/8.8/7.9 ms
Frames dropped by network connection: 0.00%
```

Il canary attivo oggi e' `/opt/sunshine-cuda12/bin/sunshine`. L'avvio ha
verificato sia `h264_nvenc` sia `hevc_nvenc`; senza un client Moonlight
connesso il contatore `enc` resta naturalmente vuoto. Non dichiariamo quindi
gia' provato il miglioramento di CPU del percorso CUDA.

Il valore `enc=28` non e' una stima: e' il motore encoder NVIDIA osservato da
`nvidia-smi pmon` nel processo `sunshine`. Il numero non deve essere 100: NVENC
e' un blocco dedicato e 28% e' compatibile con un flusso HEVC 1920x1200/60 su
questa GPU. La latenza host media di 7.9 ms e i drop rete nulli non giustificano
un passaggio da P3 a P2/P1: i preset piu' bassi privilegiano velocita' rispetto
alla compressione, ma non possono correggere bande nere o una superficie GBM
con risoluzione sbagliata.

## Cronologia: da RDP a HEVC/NVENC

Queste fasi sono collegate, ma non sono la stessa configurazione.

| Fase | Cosa e' stato provato | Esito e lezione |
| --- | --- | --- |
| 1. Ubuntu RDP Wayland | GNOME Remote Login/RDP, poi RDSTLS e correzione del hand-over. | Ha risolto il percorso RDP della VM Ubuntu; e' documentato in [RDP Wayland](rdp-wayland.md). Non e' un server per il desktop Hyprland di Omarchy. |
| 2. xrdp/Flashback X11 | Fallback X11 per aggirare schermate nere RDP. | E' stato poi rimosso: aggiungeva un secondo desktop e non rendeva Hyprland catturabile in modo corretto. |
| 3. Sunshine su VirtIO | Hyprland/Virtual-1 su VirtIO, Sunshine/NVENC sulla GTX. | Il DMA-BUF attraversava driver diversi e il video era corrotto o nero. |
| 4. Fallback RAM | Frame NV12/P010 in RAM, poi upload a NVENC. | Più stabile, ma la CPU doveva copiare/convertire frame. NVENC era comunque attivo: non era `libx264`. |
| 5. Headless GTX | `AQ_DRM_DEVICES`, `AQ_NO_KMS_REQUIREMENT=1`, output `omarchy-gtx`. | Hyprland, cattura e codifica hanno la stessa GPU; non si forza un HDMI fisicamente disconnesso. |
| 6. GBM/EGL esplicito | Patch Sunshine sul render node GTX. | Elimina l'ambiguita' del display Wayland implicito e rende visibile la dimensione GBM nel journal. |
| 7. CUDA 12.8 + HEVC | Build `sm_61`, intestazioni CUDA corrette e `hevc_nvenc` rilevato. | Il client ha mostrato HEVC 1920x1200/60 con NVENC `enc=28`. Il canary resta reversibile perche' la riduzione CPU va valutata con campioni comparabili. |

Quindi Hyprland **ha** un display headless: `omarchy-gtx`. Non e' una sessione
RDP a cui Moonlight si collega. E' l'output grafico virtuale del compositor;
Sunshine lo cattura via Wayland e Moonlight riceve il video codificato.

## Problema originale e correzione

All'inizio c'erano due GPU con ruoli incompatibili:

```text
GTX 1050 / card0       GPU reale, ma HDMI-A-1 disconnected
VirtIO / card1         output noVNC Virtual-1
```

Hyprland disegnava `Virtual-1` con VirtIO e Sunshine provava a importare quel
DMA-BUF nella GTX. Il passaggio tra driver diversi non era affidabile: il log
`Couldn't import RGB Image: 0000300C` corrispondeva a immagini corrotte o
nere. NVENC stava codificando, ma codificava un frame non valido.

La correzione non e' un EDID finto su HDMI: quel test (`drm.edid_firmware` e
`video=HDMI-A-1`) ha bloccato il guest ed e' stato rimosso. Il modello corretto
per una dGPU mobile senza uscita fisica e':

1. forzare Hyprland al DRM della GTX con `AQ_DRM_DEVICES`;
2. consentire l'avvio senza connettore KMS con `AQ_NO_KMS_REQUIREMENT=1`;
3. creare l'uscita Wayland headless `omarchy-gtx` **prima** di Sunshine;
4. fare cattura e codifica sulla stessa GTX.

Questo elimina il salto VirtIO -> NVIDIA. La dettagliata modifica al codice
GBM e al render node e' in [patch Sunshine/CUDA](sunshine-patch-breakdown.md).

## FFmpeg, NVENC e CUDA: tre cose diverse

`h264_nvenc` e `hevc_nvenc` sono encoder FFmpeg che usano l'API NVENC del
driver NVIDIA. Quando `nvidia-smi pmon` mostra `enc > 0`, la compressione e'
realmente nel blocco NVENC della GTX, non in `libx264` sulla CPU.

Il precedente build stabile aveva deliberatamente disabilitato l'input CUDA di
FFmpeg per aggirare `Couldn't scale frame: Invalid argument`. Era stabile ma
faceva:

```text
GTX -> RAM di sistema -> upload FFmpeg -> NVENC GTX
```

Il pacchetto Sunshine Arch ufficiale era un caso separato: non riusciva a
negoziare un profilo NVENC Pascal e cadeva su `libx264 [software]`. E' stato
rimosso il solo override temporaneo `26-official-sunshine.conf`; non e' il
servizio attivo.

Il canary CUDA 12.8 ripristina l'input `AV_HWDEVICE_TYPE_CUDA` e
`AV_PIX_FMT_CUDA` di FFmpeg. E' compilato per `sm_61`, la compute capability
della GTX 1050, con GCC 14 estratto e senza sostituire il compilatore, il driver
580 o il kernel di Omarchy. La prova di build e' il flag nvcc:

```text
--generate-code=arch=compute_61,code=[compute_61,sm_61]
```

CUDA 13 non puo' piu' produrre codice offline per Pascal, mentre CUDA 12.8
puo'. Questa e' una limitazione della toolchain moderna, non un limite di VFIO
o un difetto della GPU. Il canary e' reversibile con
`omarchy-sunshine-cuda12-canary rollback`.

## Codec consigliato per questa GTX

- **HEVC/H.265** e' la scelta preferita per Moonlight su Windows moderno: a
  parita' di bitrate e' normalmente piu' efficiente di H.264. Sunshine ora lo
  pubblicizza in modo automatico (`hevc_mode = 0`) e il probe ha trovato
  `hevc_nvenc` sulla GTX.
- **H.264** resta essenziale come fallback: e' il piu' compatibile con client,
  decoder e reti piu' vecchi. Non va rimosso.
- **AV1** resta disabilitato (`av1_mode = 1`): Pascal non ha un encoder AV1
  hardware. Forzarlo porterebbe a software encoding o al fallimento.

In Moonlight scegliere HEVC/preferire HEVC, **1920x1200**, 60 FPS e un bitrate
LAN iniziale di 30--50 Mbit/s. Il profilo Windows verificato il 2026-08-28 era
inizialmente a **23 Mbps** (`bitrate = 23000` in kilobit/s); e' stato portato a
**40 Mbps fissi** (`40000`, con `autoadjustbitrate = false`). Questo e' il
bitrate *richiesto* nella successiva negoziazione, non un contatore esatto dei
byte sul cavo: rate control e overhead possono far variare il traffico reale.
Chiudere e riaprire Moonlight dopo la modifica, perche' il processo gia'
avviato conserva le preferenze in memoria. Il valore e' riproducibile con
[`clients/moonlight-windows-settings.ps1`](../clients/moonlight-windows-settings.ps1):

```powershell
.\moonlight-windows-settings.ps1 -Show
.\moonlight-windows-settings.ps1 -BitrateMbps 40
```

Moonlight salva il bitrate in kbps e lo mostra come Mbps nell'interfaccia; il
suo sorgente conferma questa conversione e il fatto che l'auto-adjust puo'
modificare il target. [Moonlight streaming preferences](https://github.com/moonlight-stream/moonlight-qt/blob/master/app/settings/streamingpreferences.cpp),
[interfaccia bitrate](https://github.com/moonlight-stream/moonlight-qt/blob/master/app/gui/SettingsView.qml).
Non forzare HEVC se un client specifico non lo decodifica bene: H.264 e' il
fallback deliberato. Sunshine raccomanda il rilevamento automatico per HEVC/AV1
e documenta i compromessi dei preset NVENC.
[Configurazione Sunshine](https://docs.lizardbyte.dev/projects/sunshine/latest/md_docs_2configuration.html)

### P3: misurazione e decisione

P1, P2 e P3 non sono codec: sono preset NVENC. P1 e' il piu' rapido, P3 dedica
un po' piu' lavoro alla compressione e alla qualita'. Sunshine documenta che
numeri maggiori aumentano la latenza di encoding a fronte di migliore qualita'
a pari bitrate. Il campione visuale del 2026-08-28 riporta pero' **7.9 ms di
latenza host media**, massimo 8.8 ms, 60.19 FPS e 0% frame persi: e' un buon
risultato LAN a 60 Hz. Per questo la configurazione gestita esplicita
`nvenc_preset = 3`; non viene abbassata automaticamente.

Provare P2, poi P1, ha senso solo se una nuova misura mostra latenza host
stabilmente alta o frame persi **dopo** avere corretto risoluzione e rete. Non
risolve bande nere, schermata corrotta, client in finestra o latenza di rete.

### `enc`: il motore di codifica, non banda e non utilizzo GPU generale

La colonna `enc` di `nvidia-smi pmon` e NVTOP misura la percentuale di tempo
in cui e' occupato il blocco hardware **NVENC** nell'intervallo di
campionamento. Esempi osservati durante lo stream HEVC:

```text
sunshine ... enc=28      # primo campione pmon valido
sunshine ... enc=30      # campione successivo durante cattura 1920x1200
NVTOP enc=38%            # stessa metrica, finestra di campionamento diversa
```

`enc=28` e `enc=38%` non significano 28/38 Mbps, non sono FPS e non sono la
percentuale globale della GTX. Dicono invece che NVENC ha effettivamente
codificato frame nel campione: `enc > 0` e' una prova di hardware encoding.
Il valore varia con scena, codec, bitrate, frame rate e finestra di misura;
non deve essere 100% per avere uno stream corretto. `sm` e' il motore shader,
`mem` la memoria GPU e `enc` il blocco encoder dedicato. La qualita' e la
latenza vanno giudicate insieme all'overlay Moonlight (FPS, drop, host latency),
non da `enc` isolatamente.

### Risoluzione dinamica: Moonlight sceglie il formato del nuovo stream

La schermata iniziale aveva Moonlight impostato a 1920x1200 mentre la regola
Hyprland e i log `GBM request` erano ancora 1920x1080. Era un mismatch fra la
dimensione richiesta al client e la superficie realmente catturata: Sunshine
poteva scalare/letterboxare il desktop e lasciare aree nere. La modalita'
di fallback e' **1920x1200@60**, uguale al desktop Windows 16:10 usato nel
testo; non e' piu' obbligatorio configurarla manualmente per ogni client.

La build Sunshine attiva espone `SUNSHINE_CLIENT_WIDTH`,
`SUNSHINE_CLIENT_HEIGHT` e `SUNSHINE_CLIENT_FPS` al comando di preparazione
dell'app `Desktop`. Lo script installa in modo idempotente un solo hook in
`~/.config/sunshine/apps.json`:

```json
{
  "do": "/home/daubog44/.local/bin/omarchy-moonlight-mode apply",
  "undo": "/home/daubog44/.local/bin/omarchy-moonlight-mode restore"
}
```

Prima della cattura, `apply` valida i tre valori e chiama la API Lua richiesta
da Hyprland 0.55+:

```bash
hyprctl eval 'hl.monitor({ output = "omarchy-gtx", mode = "<W>x<H>@<FPS>", position = "0x0", scale = 1 })'
```

Il test runtime ha applicato 1920x1080@60 e ripristinato 1920x1200@60 senza
riavviare Hyprland. Alla chiusura di Desktop, `restore` riporta il display
headless alla modalita' fallback salvata. Quindi un notebook 16:10, un monitor
FHD e una TV 16:9 possono aprire **uno alla volta** Desktop con il proprio
formato richiesto. Sunshine documenta queste variabili per i prep command e
Hyprland documenta `hl.monitor` come sintassi Lua corrente. [Sunshine app
examples](https://github.com/LizardByte/Sunshine/blob/master/docs/app_examples.md),
[Hyprland monitors](https://wiki.hypr.land/Configuring/Basics/Monitors/).

Questo non crea due desktop indipendenti: un unico output `omarchy-gtx` ha una
sola modalita' attiva. Con due client simultanei, la prima sessione Desktop
mantiene l'output; un secondo client deve usare la stessa risoluzione oppure
chiudere il primo e riaprire Desktop. Non facciamo cambiare la modalita' sotto
un client gia' connesso, perche' causerebbe un salto visibile e una possibile
rinegoziazione del decoder.

Nel terminale Omarchy, dopo un nuovo login Bash o con il binario gia'
disponibile, usare:

```bash
# Funzione installata nei dotfiles (~/.bashrc). Imposta il fallback idle,
# non disabilita la scelta dinamica della prossima apertura Desktop.
omarchy_stream_resolution 1920x1200@60

# Per una TV FHD 16:9, fallback esplicito quando nessuno stream e' connesso:
omarchy_stream_resolution 1920x1080@60
omarchy-stream-resolution status

# Non eseguire `bash ~/.bashrc`: .bashrc e' un file da caricare, non uno script.
# Per rendere disponibili le funzioni nella shell corrente:
source ~/.bashrc
```

Il comando valida i limiti, riscrive soltanto il blocco delimitato in
`~/.config/hypr/monitors.lua`, ricarica Hyprland e riavvia Sunshine. E'
idempotente: rieseguirlo con la stessa modalita' non aggiunge regole duplicate.
L'errore `return: can only return from a function or sourced script` nello
screen e' dovuto a `bash ./.bashrc`: una `.bashrc` contiene intenzionalmente
`return` per interrompere le shell non interattive. Il file non era corrotto;
va usato `source ~/.bashrc` oppure si apre un nuovo terminale.

Se dopo la scelta dinamica restano bande, aprire **Desktop** una volta dopo
avere impostato risoluzione/FPS nel client Moonlight, poi controllare che
`GBM request`, `hyprctl monitors all` e l'overlay Moonlight riportino gli
stessi W×H e FPS. La modalita' "fill/stretch" del client puo' riempire il
pannello Windows, ma ritaglia o deforma: non e' una correzione lato server.

### Clipboard: il limite e' del protocollo Moonlight, non della GTX

Moonlight/Sunshine usa il protocollo GameStream. Esso non definisce una
clipboard bidirezionale: dalla tastiera Windows si puo' inviare testo al guest
con `Ctrl`+`Alt`+`Shift`+`V` (Moonlight lo *digita* nel guest), ma non copia il
clipboard del guest dentro Windows e non sincronizza file. Non c'e' una
opzione Sunshine che possa trasformarlo in sync bidirezionale. Il comportamento
e' confermato dal progetto Moonlight: supporta input text dal client verso host,
non clipboard host-verso-client. [Moonlight setup guide](https://github.com/moonlight-stream/moonlight-docs/wiki/Setup-Guide),
[limite GameStream discusso dal progetto](https://github.com/moonlight-stream/moonlight-qt/issues/554).

Per un clipboard bidirezionale reale serve un secondo canale. Il setup scelto
e' **KDE Connect**: `kdeconnect` 26.08.0 e' installato su Omarchy e
`kdeconnectd` ascolta TCP/UDP 1716; l'installer Windows richiede elevazione e
deve essere completato/accettato localmente. Poi avvia KDE Connect su Windows,
seleziona `omarchy`, invia la richiesta di pairing e accettala anche nel guest.
Abilita il plugin **Clipboard** su entrambi: da quel momento il testo copiato
in Windows arriva in Omarchy e viceversa, indipendentemente da Moonlight.

Il pairing e' deliberatamente manuale: equivale a fidare un dispositivo con
accesso agli appunti e richiede la conferma di entrambi i lati. KDE Connect usa
le porte TCP e UDP 1714--1764 per discovery e comunicazione; se Windows non
vede Omarchy, consentire l'app sulla rete privata nel firewall. Per file grandi
usare comunque cartella condivisa/SFTP: la clipboard e' per testo, non per
trasferimenti. [Download KDE Connect](https://kdeconnect.kde.org/download.html),
[clipboard e porte](https://userbase.kde.org/KDEConnect/en).

### TV: Moonlight, non DLNA

DLNA serve a inviare media registrati a un televisore; non trasporta input,
desktop interattivo, bassa latenza o la negoziazione NVENC/GameStream. Per
questa architettura la strada corretta e' un client **Moonlight** sulla TV
(Android/Google TV, Fire TV o Apple TV, se disponibile sul dispositivo),
aggiunto come un nuovo client Sunshine e associato con PIN. HEVC 1080p60 e' il
profilo iniziale sicuro per una GTX 1050; 4K deve essere provato a parte per
qualita', latenza e decoder della TV.

La TV vedra' lo **stesso** desktop headless: e' un secondo punto di vista
(mirror), non un secondo monitor indipendente. Per avere due desktop separati
servirebbero una seconda uscita headless e una seconda istanza/cattura Sunshine
con porte, app e risorse NVENC separate; non e' configurato qui, non e' stato
validato sull'hardware Pascal e potrebbe peggiorare la latenza. Prima prova
raccomandata: collegare la TV con Moonlight e lasciare che il nuovo Desktop
negozi 1920x1080@60, con il PC Windows scollegato.

## Verifica riproducibile dopo una modifica

```bash
# Nel guest, prima dello stream
sudo omarchy-gtx-primary status-runtime
sudo omarchy-sunshine-cuda12-canary status

# Aprire Desktop da Moonlight, aspettare alcuni secondi e poi:
omarchy_stream_health watch
ps -eo pid,nlwp,pcpu,pmem,rss,comm,args --sort=-pcpu | head -n 15
journalctl --user -u app-dev.lizardbyte.app.Sunshine.service --since '2 minutes ago' --no-pager \
  | grep -E 'GBM request|Found H.264|Found HEVC|CLIENT CONNECTED|libx264|scale frame'
```

`omarchy_stream_health watch` segnala in italiano e senza ambiguita': build
CUDA/stabile selezionata, ultima dimensione GBM, mismatch risoluzione,
`libx264`/errori di import recenti e stato runtime di `enc`. Se nessun client
e' connesso, `enc` assente viene esplicitamente classificato come *inattivo*,
non come fallback. Il risultato valido richiede contemporaneamente:
`omarchy-gtx` a 1920x1200/60, `Hyprland` sulla GTX, `sunshine` con `enc > 0`,
e codec HEVC/NVENC nell'overlay Moonlight. Confrontare il valore CPU del
processo intero, non sommare le righe-thread di `htop`.

## Dove e' ogni informazione

- [Runbook PVE/guest](omarchy-proxmox-guest-setup.md): applicazione, file,
  rollback e stato corrente.
- [Patch Sunshine/CUDA](sunshine-patch-breakdown.md): codice e motivazione
  riga per riga.
- [Tentativi ed esiti](attempts-and-outcomes.md): cronologia dei fallimenti,
  non una seconda procedura.
- [Architettura VFIO/ACPI](architecture.md): VBIOS OEM, SSDT, `_ROM` e `fw_cfg`.
