# Omarchy, Sunshine e Moonlight: desktop Wayland primario sulla GTX 1050

Questa nota descrive il risultato ottenuto sulla VM Omarchy (`1002`, guest `192.168.0.28`) il 28 agosto 2026. Il passthrough VFIO, VBIOS OEM, `fw_cfg` e SSDT ACPI erano gia' funzionanti: qui si documenta soltanto il percorso **desktop Wayland -> cattura -> NVENC -> Moonlight**.

## Risultato, stato e confini precisi

Il desktop Omarchy ora usa la GTX 1050 come GPU primaria del compositor Hyprland, senza richiedere un connettore HDMI/DP fisico della GPU mobile. Hyprland espone una uscita virtuale chiamata `omarchy-gtx`; Sunshine la cattura e Moonlight la riceve a **1920x1080, 60 Hz, scala 1**.

Evidenze raccolte durante il test end-to-end:

```text
$ hyprctl monitors all
Monitor omarchy-gtx (ID 0):
        1920x1080@60.00000 at 0x0
        scale: 1
        currentFormat: XRGB8888

$ nvidia-smi pmon -c 1       # mentre Moonlight e' connesso
# gpu ... type  sm  mem enc ... command
0       ...  G    4    0   -      Hyprland
0       ... C+G   39    5  12     sunshine

$ journalctl --user -u app-dev.lizardbyte.app.Sunshine.service
[wayland] GBM request: 1920x1080 fourcc=0x34325241
Found H.264 encoder: h264_nvenc [nvenc]
```

`Hyprland` nella tabella NVIDIA dimostra che non e' piu' un compositor VirtIO. `enc=12` assegnato a `sunshine` dimostra che NVENC della GTX sta codificando: non e' `libx264`, cioe' non e' codifica video software CPU.

Questa e' la topologia attuale:

```text
GPU PCI passthrough /dev/dri/gtx1050
        |
        +-- AQ_DRM_DEVICES + AQ_NO_KMS_REQUIREMENT
        |       |
        |       +-- Hyprland (render e compositing sulla GTX)
        |               |
        |               +-- output Wayland headless "omarchy-gtx"
        |                       1920x1080@60, scale 1
        |                       |
        +-----------------------+-- Sunshine: cattura GBM/Wayland
                                        |
                                        +-- h264_nvenc / NVENC GTX
                                                |
                                                +-- Moonlight Windows
```

La configurazione Proxmox conserva **per ora** `vga: virtio`: serve ancora come console noVNC di recupero e non viene scelta dal desktop, che e' limitato alla GTX. Dopo una prova utente stabile e ripetuta di Moonlight si puo' valutare `qm set 1002 --vga none`; non e' stato fatto automaticamente per non eliminare l'unica console di emergenza della VM.

## Perche' il percorso precedente era lento o corrotto

Prima la VM conteneva due GPU grafiche con ruoli incompatibili:

```text
GTX 1050 (card0)       -> GPU reale ma HDMI-A-1: disconnected
VirtIO/QEMU (card1)    -> Virtual-1, unico output visibile nel noVNC
```

Se Hyprland produceva `Virtual-1` con VirtIO ma Sunshine provava a catturare/importare quel buffer sulla GTX, il frame attraversava un confine DMA-BUF/GBM fra due driver. Il log `Couldn't import RGB Image: 0000300C` e le immagini corrotte in Moonlight erano la prova di quel fallimento; NVENC non era la causa.

L'alternativa corretta non e' simulare un monitor HDMI NVIDIA con un EDID kernel: sulla GTX mobile il connettore e' disconnesso. Hyprland/Aquamarine offre invece `AQ_NO_KMS_REQUIREMENT=1`, che consente una sessione senza un'uscita KMS fisica, e `hyprctl output create headless <nome>` per creare una vera uscita Wayland. E' il modello documentato da Hyprland per GPU virtuali/headless, non un finto monitor PCI. Vedi [Virtual GPU](https://wiki.hypr.land/Configuring/Advanced-and-Cool/Virtual-GPU/) e [hyprctl](https://wiki.hypr.land/Configuring/Advanced-and-Cool/Using-hyprctl/).

Un tentativo precedente con `drm.edid_firmware=... video=HDMI-A-1:...` ha reso il guest non raggiungibile (SSH e Guest Agent assenti). I due soli parametri Limine sono stati rimossi offline dall'ESP e il guest e' stato poi ripristinato; non sono presenti nella configurazione finale. Non e' stato osservato un kernel panic testuale che permetta di attribuire una causa piu' precisa.

## Cosa installa `omarchy-gtx-primary`

Lo script nel repository e sul guest e':

```text
scripts/omarchy-gtx-primary
/usr/local/sbin/omarchy-gtx-primary
```

E' idempotente: rieseguirlo non duplica righe, regole monitor o drop-in systemd. Salva una sola copia dei tre file utente originari e rimuove i file propri al rollback quando non esisteva un predecessore dell'utente.

`prepare-headless` esegue esattamente questi cambiamenti nel guest:

1. imposta `AQ_DRM_DEVICES="/dev/dri/gtx1050"` e `AQ_NO_KMS_REQUIREMENT=1` in `~/.config/uwsm/env-hyprland`;
2. imposta `adapter_name = /dev/dri/gtx1050` in Sunshine;
3. aggiunge in `~/.config/hypr/monitors.lua` una sola regola Lua per `omarchy-gtx` a 1920x1080/60 e scala 1;
4. installa `~/.local/bin/omarchy-headless-output`. Prima dell'avvio di Sunshine, esso scopre dinamicamente la firma della sessione Hyprland, crea `omarchy-gtx` solo se non esiste, ricarica la configurazione e verifica l'uscita;
5. aggiunge la drop-in `25-headless-output.conf` con `ExecStartPre=...omarchy-headless-output`.

Il punto 4 risolve il difetto piu' importante della prima versione headless: creare l'uscita a mano funzionava, ma non la rendeva disponibile in modo affidabile dopo logout, reboot o restart di Sunshine. Ora Sunshine non parte la cattura prima dell'output.

Lo script **non** modifica kernel, Limine, VFIO, VBIOS, SSDT, `fw_cfg`, host PCI o configurazione Proxmox.

### Comandi riproducibili

Dal guest come root:

```bash
sudo /usr/local/sbin/omarchy-gtx-primary prepare-headless
sudo /usr/local/sbin/omarchy-gtx-primary verify-headless

# Riavvio controllato di Sunshine dopo una modifica alla unit.
systemctl --user daemon-reload
systemctl --user restart app-dev.lizardbyte.app.Sunshine.service

# Stato runtime: output, unit e processi GPU.
sudo /usr/local/sbin/omarchy-gtx-primary status-runtime
```

L'output atteso da `status-runtime` contiene `Monitor omarchy-gtx`, `active` e una riga NVIDIA per `Hyprland`. Durante uno stream aggiunge una riga per `sunshine` e un valore `enc` maggiore di zero.

Per annullare soltanto questo layer guest:

```bash
sudo /usr/local/sbin/omarchy-gtx-primary rollback-guest
systemctl --user daemon-reload
systemctl --user restart app-dev.lizardbyte.app.Sunshine.service
```

Il rollback non tocca il passthrough della GTX. Se in futuro fosse stato scelto anche `vga: none`, il ripristino della console noVNC e' separato e intenzionale:

```bash
# Sul nodo Proxmox, non nel guest.
qm set 1002 --vga virtio
```

## Qualita', fullscreen e misura corretta della CPU

L'uscita fisica del server e' ora Full HD, non una immagine 960x540: il vecchio valore logico dimezzato veniva dalla scala 2. La modalita' supportata dall'output headless di questa versione Hyprland e' soltanto `1920x1080@60`; non dichiariamo falsamente 2K. In Moonlight impostare **1080p**, **60 FPS** e un bitrate LAN adeguato (ad esempio 30--50 Mbit/s); poi attivare il fullscreen dal pulsante di massimizzazione o dalle scorciatoie mostrate nelle impostazioni del client. Il server non puo' rendere a 2K se la sua uscita Wayland e' Full HD.

`htop` puo' mostrare molte righe di thread con lo stesso nome. Non si sommano: il dato da confrontare e' la riga del processo intero (`ps -eo pid,nlwp,pcpu,comm`). Durante il primo stream headless il processo Sunshine era circa al 51% di **una** CPU logica, non quattro processi da 51%. Hyprland era circa al 3--4% come processo intero.

Il 51% non e' comunque zero-copy. Il build Sunshine funzionante e' `0.0.0-14ffa6f-dirty`, compilato per il driver Pascal 580 e corretto con le patch locali. Nel suo `CMakeCache.txt` e' registrato:

```text
SUNSHINE_ENABLE_CUDA:BOOL=OFF
```

Inoltre la patch [`sunshine-linux-nvenc-system-memory-input.patch`](../patches/sunshine-linux-nvenc-system-memory-input.patch) seleziona esplicitamente frame di sistema/NV12 per non incorrere nel precedente `Couldn't scale frame: Invalid argument`. Il flusso e' quindi:

```text
cattura GTX -> RAM di sistema -> upload FFmpeg -> NVENC GTX
```

NVENC resta hardware, come prova `enc`, ma la copia/conversione richiede CPU. Questa e' la spiegazione esatta della CPU residua e della differenza fra “la GTX codifica” e “ogni pixel resta sempre in VRAM”.

### Alternative CUDA provate e limite attuale

Il pacchetto Sunshine Arch ufficiale `2026.516.143833-4` e' stato provato con la stessa uscita GTX. Ha rifiutato `h264_nvenc` sulla GTX 1050 con:

```text
Multiple reference frames are not supported by the device
Provided device doesn't support required NVENC features
Found H.264 encoder: libx264 [software]
```

E' stato immediatamente rimosso il solo override `26-official-sunshine.conf` e ripristinato il build compatibile: non rimane un fallback software attivo.

Ricompilare il build locale con CUDA eliminerebbe potenzialmente il passaggio RAM, ma non e' una semplice opzione da attivare qui. La sorgente richiede `nvcc`; il repository Arch offre CUDA 13.3 (2.20 GiB da scaricare, 4.71 GiB installati), mentre NVIDIA ha rimosso da CUDA 13 il supporto di compilazione offline per Pascal/compute capability 6.1. Per una GTX 1050 servirebbe una toolchain CUDA **12.x** conservata separatamente, una build sperimentale e una nuova prova di compatibilita'. Non e' stata installata: sarebbe una modifica grande e non verificata. [NVIDIA CUDA 13 release notes](https://docs.nvidia.com/cuda/archive/13.0.0/cuda-toolkit-release-notes/index.html) e [CUDA/driver/architecture matrix](https://docs.nvidia.com/datacenter/tesla/drivers/cuda-toolkit-driver-and-architecture-matrix.html).

Quindi il risultato onesto e':

| Proprietà | Stato |
| --- | --- |
| Desktop Hyprland renderizzato dalla GTX | verificato (`Hyprland` in `nvidia-smi pmon`) |
| Output e stream Full HD 60 | verificato (`omarchy-gtx`, richieste GBM 1920x1080) |
| Codifica NVIDIA | verificata (`h264_nvenc`, `enc>0`) |
| Zero-copy GTX -> NVENC | non ottenuto; CUDA e' disabilitato nel build compatibile |
| CPU nulla durante lo stream | non ottenuta; resta la copia RAM del build compatibile |
| 2K nativo | non supportato dall'output headless attuale |

## Verifica end-to-end dopo ogni aggiornamento

```bash
# Guest: controlli prima di aprire Moonlight.
sudo /usr/local/sbin/omarchy-gtx-primary status-runtime
journalctl --user -u app-dev.lizardbyte.app.Sunshine.service --since '2 minutes ago' --no-pager \
  | grep -E 'omarchy-gtx|h264_nvenc|GBM request|CLIENT CONNECTED'

# Aprire Desktop su Moonlight Windows, muovere una finestra per alcuni secondi,
# poi nel guest:
nvidia-smi pmon -c 1
ps -eo pid,nlwp,pcpu,pmem,rss,comm,args --sort=-pcpu | head -n 15
```

Atteso: `Hyprland` e `sunshine` sulla GPU 0; `sunshine` con `enc` non nullo mentre il client e' collegato. Se compare `libx264`, non e' accettabile come correzione: verificare quale binary esegue la unit con `systemctl --user status app-dev.lizardbyte.app.Sunshine.service` e ripristinare il build locale compatibile.

## Cosa non si deve dedurre

- Questa soluzione e' specifica a questa GTX 1050 Mobile, al driver 580, alla versione Omarchy/Hyprland e al build Sunshine indicato. Non e' una ricetta universale per tutte le GPU mobile.
- `vga: virtio` ancora presente in QEMU non prova che il desktop la usi; `AQ_DRM_DEVICES` e `nvidia-smi pmon` sono la prova del renderer reale.
- Non e' stato dichiarato un fix “magico” per CUDA. Il percorso zero-copy resta un lavoro futuro, che richiede CUDA 12.x e test separati; CUDA 13 non e' compatibile con Pascal per la compilazione offline.
- Il passthrough resta esclusivo: la GTX non puo' essere usata contemporaneamente da Omarchy e da un'altra VM.

Vedi anche [tentativi ed esiti](attempts-and-outcomes.md), [architettura VFIO/ACPI](architecture.md) e [runbook riproducibile](reproducible-runbook.md).
