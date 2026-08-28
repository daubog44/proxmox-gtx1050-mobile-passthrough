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
  -> output Wayland headless omarchy-gtx, 1920x1080@60, scale 1
  -> Sunshine wlr/GBM
  -> FFmpeg h264_nvenc oppure hevc_nvenc
  -> NVENC GTX
  -> Moonlight
```

Durante il precedente stream valido le prove erano:

```text
Hyprland  ... G                    # processo grafico sulla GTX
sunshine  ... C+G ... enc=12       # NVENC in uso durante lo stream
[wayland] GBM request: 1920x1080 ...
Found H.264 encoder: h264_nvenc [nvenc]
```

Il canary attivo oggi e' `/opt/sunshine-cuda12/bin/sunshine`. L'avvio ha
verificato sia `h264_nvenc` sia `hevc_nvenc`; senza un client Moonlight
connesso il contatore `enc` resta naturalmente vuoto. Non dichiariamo quindi
gia' provato il miglioramento di CPU del percorso CUDA.

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

In Moonlight scegliere HEVC/preferire HEVC, 1080p, 60 FPS e un bitrate LAN
iniziale di 30--50 Mbit/s. Non forzare HEVC se un client specifico non lo
decodifica bene: H.264 e' il fallback deliberato. Sunshine raccomanda il
rilevamento automatico per HEVC/AV1 e documenta i compromessi dei preset NVENC.
[Configurazione Sunshine](https://docs.lizardbyte.dev/projects/sunshine/latest/md_docs_2configuration.html)

## Verifica riproducibile dopo una modifica

```bash
# Nel guest, prima dello stream
sudo omarchy-gtx-primary status-runtime
sudo omarchy-sunshine-cuda12-canary status

# Aprire Desktop da Moonlight e muovere finestre per alcuni secondi, poi:
nvidia-smi pmon -c 1
ps -eo pid,nlwp,pcpu,pmem,rss,comm,args --sort=-pcpu | head -n 15
journalctl --user -u app-dev.lizardbyte.app.Sunshine.service --since '2 minutes ago' --no-pager \
  | grep -E 'GBM request|Found H.264|Found HEVC|CLIENT CONNECTED'
```

Il risultato valido richiede contemporaneamente: `omarchy-gtx` a 1080p/60,
`Hyprland` sulla GTX, `sunshine` con `enc > 0`, e il codec NVENC nel log.
Confrontare il valore CPU del processo intero, non sommare le righe-thread di
`htop`. Solo questo campione stabilira' se il canary CUDA ha ridotto davvero la
copia RAM e la latenza.

## Dove e' ogni informazione

- [Runbook PVE/guest](omarchy-proxmox-guest-setup.md): applicazione, file,
  rollback e stato corrente.
- [Patch Sunshine/CUDA](sunshine-patch-breakdown.md): codice e motivazione
  riga per riga.
- [Tentativi ed esiti](attempts-and-outcomes.md): cronologia dei fallimenti,
  non una seconda procedura.
- [Architettura VFIO/ACPI](architecture.md): VBIOS OEM, SSDT, `_ROM` e `fw_cfg`.
