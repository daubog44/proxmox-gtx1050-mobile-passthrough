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
  -> output Wayland headless omarchy-gtx, 1920x1200@60, scale 1
  -> Sunshine wlr/GBM
  -> FFmpeg h264_nvenc oppure hevc_nvenc
  -> NVENC GTX
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
LAN iniziale di 30--50 Mbit/s. Non forzare HEVC se un client specifico non lo
decodifica bene: H.264 e' il fallback deliberato. Sunshine raccomanda il
rilevamento automatico per HEVC/AV1 e documenta i compromessi dei preset NVENC.
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

### Risoluzione: evitare bande nere da formati diversi

La schermata iniziale aveva Moonlight impostato a 1920x1200 mentre la regola
Hyprland e i log `GBM request` erano ancora 1920x1080. Era un mismatch fra la
dimensione richiesta al client e la superficie realmente catturata: Sunshine
poteva scalare/letterboxare il desktop e lasciare aree nere. La modalita'
gestita e' ora **1920x1200@60**, uguale al desktop Windows 16:10 usato nel
testo. Dopo il cambio lo stream viene chiuso deliberatamente: riaprire
`Desktop` da Moonlight affinche' client, output Wayland e GBM negozino la stessa
modalita'.

Nel terminale Omarchy, dopo un nuovo login Bash o con il binario gia'
disponibile, usare:

```bash
# Funzione installata nei dotfiles (~/.bashrc); equivale al comando con trattini.
omarchy_stream_resolution 1920x1200@60

# Altri esempi validi:
omarchy_stream_resolution 1920x1080@60
omarchy-stream-resolution status
```

Il comando valida i limiti, riscrive soltanto il blocco delimitato in
`~/.config/hypr/monitors.lua`, ricarica Hyprland e riavvia Sunshine. E'
idempotente: rieseguirlo con la stessa modalita' non aggiunge regole duplicate.
Se il client Windows ha un monitor con rapporto diverso da 16:10, Moonlight
puo' ancora mantenere il rapporto con bande nere: in quel caso scegliere la
stessa risoluzione del monitor Windows oppure la sua modalita' di riempimento,
sapendo che questa puo' deformare o ritagliare l'immagine.

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
