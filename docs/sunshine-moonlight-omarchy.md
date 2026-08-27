# Omarchy, Sunshine e Moonlight: codifica hardware sulla GTX 1050

Questa nota riguarda la VM Omarchy (`192.168.0.28`) dopo che il passthrough della GTX 1050 Mobile era già funzionante. Non modifica VFIO, VBIOS, SSDT o la configurazione Proxmox: risolve soltanto la catena di **cattura desktop -> codifica video -> Moonlight**.

## Risultato verificato

Il 27 agosto 2026 è stato aperto il desktop Omarchy da Moonlight a 1920x1080/60 e l'immagine è rimasta corretta per più controlli successivi. Durante la sessione:

```text
$ journalctl --user -u app-dev.lizardbyte.app.Sunshine.service
Found H.264 encoder: h264_nvenc [nvenc]
New streaming session started [active sessions: 1]
CLIENT CONNECTED

$ nvidia-smi pmon -c 1
# gpu ... enc ... command
0       ...  4   ... sunshine
```

`h264_nvenc` è l'encoder hardware **NVENC** della GTX, non la codifica software CPU (`libx264`). Il valore `enc` di `nvidia-smi pmon` attribuito al processo `sunshine` è la prova runtime più utile: conferma che il motore di encoding della GTX sta lavorando. Il valore può essere basso perché il desktop statico produce poche differenze tra un frame e l'altro; non deve essere 100% per essere hardware.

## Il problema reale: due GPU con ruoli diversi

La VM espone due dispositivi DRM:

```text
/dev/dri/card0 = GTX 1050 passata con VFIO
/dev/dri/card1 = GPU VirtIO/QEMU che possiede l'uscita Virtual-1
```

In un test iniziale è stata resa primaria la GTX (`AQ_DRM_DEVICES=card0:card1`) e Sunshine è stato impostato a catturare da `card0`. Moonlight mostrava frame corrotti o neri. Il journal riportava anche `Couldn't import RGB Image: 0000300C`: è un fallimento dell'importazione del buffer Wayland/GBM fra GPU, non un fallimento di NVENC.

La configurazione stabile separa invece i ruoli:

```text
Hyprland -> card1 (VirtIO): compone e possiede Virtual-1
Sunshine -> card1: cattura Wayland/GBM dello stesso output
FFmpeg h264_nvenc -> GTX card0: codifica H.264 con NVENC
Moonlight -> decodifica sul client Windows
```

Questo è il motivo per cui non si deve forzare la GTX a essere contemporaneamente output virtuale, sorgente di cattura e encoder: su questa combinazione Hyprland + VirtIO + NVIDIA Pascal la condivisione di buffer DMA-BUF/GBM tra le due GPU non è affidabile. Tenere la cattura sul proprietario dell'output elimina il passaggio che corrompeva l'immagine, senza rinunciare a NVENC.

## Configurazione applicata

File `~/.config/uwsm/env-hyprland`:

```bash
# VirtIO deve venire prima: possiede Virtual-1.
export AQ_DRM_DEVICES="/dev/dri/card1:/dev/dri/card0"
```

File `~/.config/sunshine/sunshine.conf`:

```ini
capture = wlr
encoder = nvenc
adapter_name = /dev/dri/card1
```

`capture = wlr` usa il protocollo di screencopy di Hyprland/Wayland. `adapter_name` qui sceglie l'adapter usato per la cattura GBM, quindi deve essere la VirtIO che guida `Virtual-1`; non sceglie la scheda NVENC. `encoder = nvenc` sceglie invece il codec NVIDIA.

La documentazione Hyprland spiega che `AQ_DRM_DEVICES` decide priorità e fallback delle GPU e che, in presenza di GPU virtuale e fisica, vanno elencate entrambe. Sunshine documenta separatamente `capture`, `adapter_name` ed encoder. Vedi [Hyprland multi-GPU](https://wiki.hypr.land/Configuring/Advanced-and-Cool/Multi-GPU/), [Hyprland virtual GPU](https://wiki.hypr.land/Configuring/Advanced-and-Cool/Virtual-GPU/) e [opzioni Sunshine](https://docs.lizardbyte.dev/projects/sunshine/latest/md_docs_2configuration.html).

Per rendere effettivo `AQ_DRM_DEVICES` occorre riavviare la sessione grafica (logout/login; nel test è stato riavviato SDDM). Poi:

```bash
systemctl --user restart app-dev.lizardbyte.app.Sunshine.service
```

## Perché è stato necessario il binario Sunshine locale

L'FFmpeg di sistema dell'Omarchy corrente richiedeva NVENC API 13.1, mentre il driver proprietario Pascal compatibile della GTX 1050, `580.178.04`, espone API 13.0. Lanciare il pacchetto Sunshine di sistema falliva quindi prima dello streaming con un errore equivalente a:

```text
Driver does not support required nvenc API version. Required: 13.1 Found: 13.0
```

È stato quindi compilato Sunshine con il suo FFmpeg bundled, compatibile con il driver 580. Inoltre, il backend Wayland della revisione usata non apriva esplicitamente il render node scelto da `adapter_name` e VirtIO rifiutava talvolta il primo flag GBM. La patch [sunshine-wayland-virtio-gbm.patch](../patches/sunshine-wayland-virtio-gbm.patch) apre quel render node e ritenta con un DMA-BUF lineare. Il binario risultante viene avviato dalla drop-in utente:

```text
~/.config/systemd/user/app-dev.lizardbyte.app.Sunshine.service.d/20-virtio-gbm.conf
ExecStart=/home/daubog44/.local/lib/sunshine-gbm/sunshine
```

Il codice Linux upstream di Sunshine preferisce normalmente frame CUDA per NVENC. Il pacchetto/build in uso non contiene il convertitore CUDA; forzarlo portava a `Couldn't scale frame: Invalid argument`. La patch allegata [sunshine-linux-nvenc-system-memory-input.patch](../patches/sunshine-linux-nvenc-system-memory-input.patch) fa passare a `h264_nvenc` frame `NV12` in memoria di sistema. FFmpeg carica quindi i frame nella GTX e NVENC li codifica: la conversione/copia resta sul percorso CPU/RAM/PCIe, ma **la compressione video è hardware NVIDIA**, come dimostra `nvidia-smi pmon`.

Le due patch sono state verificate contro la sorgente locale da cui è stato compilato il binario in esecuzione; non sono una promessa di applicarsi immutate a ogni release Sunshine. Prima di aggiornare, applicarle con `patch --dry-run -p1 < ...`, ricompilare e rifare la verifica runtime, invece di sovrascrivere un pacchetto funzionante.

Non è stato installato il toolkit CUDA: avrebbe richiesto diversi gigabyte e avrebbe tentato di introdurre il ramo driver NVIDIA 610, incompatibile con la GTX 1050 Pascal in questa installazione. Per la compatibilità della GTX 1050 su Omarchy vedi la nota nel [README](../README.md#nota-essenziale-per-archomarchy-e-gtx-1050).

## Verifica riproducibile

1. Da Omarchy controllare che la GPU e il servizio siano pronti:

   ```bash
   nvidia-smi --query-gpu=name,driver_version --format=csv,noheader
   systemctl --user is-active app-dev.lizardbyte.app.Sunshine.service
   grep -E '^(capture|encoder|adapter_name)' ~/.config/sunshine/sunshine.conf
   ```

   Atteso: `NVIDIA GeForce GTX 1050`, ramo driver `580.178.04`, `active`, `wlr`, `nvenc`, `/dev/dri/card1`.

2. Aprire l'app `Desktop` dell'host Omarchy in Moonlight.

3. Mentre la sessione è connessa, eseguire dal terminale Omarchy:

   ```bash
   journalctl --user -u app-dev.lizardbyte.app.Sunshine.service --since '2 minutes ago' --no-pager \
     | grep -E 'h264_nvenc|New streaming session|CLIENT CONNECTED'
   nvidia-smi pmon -c 1
   nvidia-smi --query-gpu=utilization.encoder,utilization.gpu,memory.used --format=csv,noheader
   ```

   Atteso: `h264_nvenc`, sessione connessa e una riga `sunshine` con `enc` non nullo. Per un carico encoder più visibile, muovere finestre o riprodurre un video nel desktop: un'immagine ferma è compressa con pochi frame/differenze.

4. Per vedere le statistiche sul client Moonlight premere `Ctrl` + `Alt` + `Shift` + `S`; per il full screen usare `Ctrl` + `Alt` + `Shift` + `X` oppure il pulsante della finestra. I comandi sono documentati nelle [FAQ Moonlight](https://github.com/moonlight-stream/moonlight-docs/wiki/Frequently-Asked-Questions).

## Cosa non conclude questo test

- Non prova che Hyprland renderizzi il desktop sulla GTX: la configurazione deliberatamente usa VirtIO come GPU di composizione per evitare la corruzione del frame. Prova invece la codifica H.264 NVENC sulla GTX.
- Non trasforma la GTX 1050 in una GPU virtuale condivisibile: il passthrough resta esclusivo alla VM.
- Non rende questa soluzione universale. Schede, driver, compositori e GPU virtuali diversi possono richiedere un altro adapter, altro FFmpeg o nessuna patch.
- Se un aggiornamento di Sunshine/FFmpeg o del driver cambia l'ABI, ricompilare e ripetere la verifica sopra prima di dichiarare di nuovo NVENC funzionante.

## Ripristino prudente

Se un aggiornamento rompe lo stream, non cambiare VFIO né il passthrough. Prima riportare Sunshine alla configurazione che cattura il proprietario dell'output:

```bash
sed -i 's|^adapter_name = .*|adapter_name = /dev/dri/card1|' ~/.config/sunshine/sunshine.conf
systemctl --user restart app-dev.lizardbyte.app.Sunshine.service
```

Se si desidera solo diagnosticare la cattura, impostare temporaneamente `encoder = software`, riavviare il servizio, verificare l'immagine e poi ripristinare `encoder = nvenc`. Il fallback software è un diagnostico: non soddisfa l'obiettivo NVENC e torna a usare significativamente la CPU.
