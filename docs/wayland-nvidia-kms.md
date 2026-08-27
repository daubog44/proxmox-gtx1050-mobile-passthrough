# Wayland, Xwayland e NVIDIA DRM KMS: correzione riproducibile

Questa pagina descrive un problema distinto dal passthrough VFIO e dalla VBIOS. La GPU era gia' assegnata correttamente: `nvidia-smi` vedeva la GTX 1050. Cio' non garantisce che le applicazioni grafiche del desktop Wayland la usino.

## Il sintomo reale

Prima della correzione, nella sessione Wayland dell'utente il comando seguente restituiva software rendering:

```bash
# [VM Ubuntu, dal terminale del desktop remoto]
glxinfo -B | grep -E 'OpenGL vendor|OpenGL renderer'
# OpenGL vendor string: Mesa
# OpenGL renderer string: llvmpipe (...)
```

`nvidia-smi` continuava a mostrare la GTX 1050 e GNOME Shell compariva tra i client NVIDIA. Non e' una contraddizione: `nvidia-smi` prova che il driver puo parlare con la GPU; `glxinfo` prova quale renderer OpenGL ha scelto una concreta applicazione Xwayland.

## Causa: un vecchio override KMS

NVIDIA ha un modulo kernel chiamato `nvidia_drm`. Il parametro `modeset` abilita il **Kernel Mode Setting** (KMS): permette al kernel e a Mutter/GNOME di trattare la GPU NVIDIA come un dispositivo DRM/KMS moderno. Per Wayland e Xwayland accelerati questo e' necessario.

Il pacchetto NVIDIA 580 aveva gia' il valore corretto in `/etc/modprobe.d/nvidia-graphics-drivers-kms.conf`:

```text
options nvidia_drm modeset=1
```

Ma due file locali piu' vecchi lo sovrascrivevano:

```text
/etc/modprobe.d/nvidia-custom.conf     options nvidia_drm modeset=0
/etc/modprobe.d/nvidia.conf            options nvidia_drm modeset=0
```

Quei file provenivano da tentativi manuali precedenti (sono presenti nella history del guest), **non** dalla versione originaria di `gpu-vm-switch`: lo script Proxmox gestiva VFIO, QEMU, SSDT e installazione driver, ma non scriveva opzioni `nvidia_drm` nel guest.

Con `modeset=0` il desktop poteva comunque partire come sessione Wayland, ma Xwayland sceglieva `llvmpipe`, cioe' OpenGL eseguito dalla CPU. Questo spiega perche' un valore FPS o una percentuale vista in `nvtop` non erano, da soli, una prova sufficiente.

## Fix applicato il 2026-08-27

Sono state cambiate **solo** le due righe `modeset=0` in `modeset=1`, con copie di rollback in `/root/nvidia-wayland-kms-backup-20260827-011200/`. Poi e' stato ricreato l'initramfs e riavviata la VM.

```bash
# [VM Ubuntu, root]
grep -Hn '^options nvidia_drm modeset=' \
  /etc/modprobe.d/nvidia-custom.conf /etc/modprobe.d/nvidia.conf
sudo update-initramfs -u -k all
sudo reboot
```

Verifica dopo il riavvio:

```bash
cat /sys/module/nvidia_drm/parameters/modeset
# atteso: Y

glxinfo -B | grep -E 'OpenGL vendor|OpenGL renderer'
# atteso:
# OpenGL vendor string: NVIDIA Corporation
# OpenGL renderer string: NVIDIA GeForce GTX 1050/PCIe/SSE2

nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader
# atteso: NVIDIA GeForce GTX 1050, 580.173.02, 4096 MiB
```

Il journal del boot corretto contiene anche segnali indipendenti:

```bash
journalctl -b | grep -E 'Running GNOME Shell.*Wayland|nvidia-drm.*atomic|selected as primary'
# atteso: GNOME Shell ... as a Wayland display server
# atteso: Added device ... (nvidia-drm) using atomic mode setting
# atteso: GPU /dev/dri/card1 selected as primary
```

Questa e' una sessione **Wayland**. Xwayland e' il server di compatibilita interno che permette a un'app X11 come `glxgears` di apparire dentro quel desktop; non cambia il tipo della sessione principale.

## Perche' `glxgears` ora si ferma a circa 60 FPS

L'output:

```text
Running synchronized to the vertical refresh.
300 frames in 5.0 seconds = 59.9 FPS
```

e' normale. `glxgears` sta aspettando il **vertical refresh** (VSync) del monitor virtuale RDP a 60 Hz: presenta un frame per refresh, quindi circa 300 frame in 5 secondi. E' un comportamento desiderabile, non un limite della GTX 1050.

Per dimostrare il renderer, non confrontare il numero FPS con un benchmark: usare `glxinfo -B` e osservare il processo in `nvidia-smi`/`nvtop`. Per curiosita' si puo' togliere VSync soltanto per vedere un contatore non limitato:

```bash
__GL_SYNC_TO_VBLANK=0 glxgears
```

Quel numero non e' un benchmark di gioco e non va usato per stimare prestazioni reali: misura anche quanto rapidamente l'app, Xwayland e il display virtuale riescono a presentare frame senza sincronizzazione.

## Il display Xorg `:2`

`Xorg :2` non e' il desktop Wayland dell'utente. E' un server X11 NVIDIA **headless** creato come supporto diagnostico per eseguire GLX via SSH, dove non esiste un canvas grafico. E' avviato dal servizio `nvidia-benchmark-x.service` con:

```text
/etc/X11/xorg.conf.nvidia-benchmark
  Driver "nvidia"
  BusID "PCI:1:0:0"
  Option "AllowEmptyInitialConfiguration" "True"
  Option "UseDisplayDevice" "None"
```

Il wrapper `/usr/local/bin/nvidia-glxgears` fa semplicemente `DISPLAY=:2 glxgears`. `glxinfo -B` su `:2` ha confermato NVIDIA, ma il suo FPS puo' variare molto perche' il server non ha un'uscita fisica. Il controllo piu' significativo per il desktop e' quello nel display Wayland/Xwayland attivo sopra.

## APT autoremove: perche' era rischioso e correzione

APT distingue i pacchetti installati **manuali** dai pacchetti installati come dipendenze automatiche. Un driver puo' funzionare oggi ma essere marcato automatico: se viene rimossa la sua radice manuale, `apt autoremove` puo' proporre anche il metapacchetto NVIDIA, i moduli o le utilita'. Non e' una prova che il driver fosse gia' rotto; era un avviso a non lanciare un autoremove alla cieca dopo il cleanup di xrdp.

L'autoremove non e' stato eseguito. Sono stati marcati manuali i pacchetti driver attivi e la simulazione risulta pulita:

```bash
sudo apt-mark manual nvidia-driver-580 nvidia-utils-580
apt-mark showmanual | grep -E '^(nvidia-driver-580|nvidia-utils-580)$'
sudo apt-get -s autoremove | grep -Ei 'nvidia|linux-modules-nvidia' || true
```

La versione aggiornata di `gpu-vm-switch` applica lo stesso principio dopo l'installazione driver: su Ubuntu/Debian/Kali marca manuali i pacchetti NVIDIA gia' installati; su Arch usa pacchetti espliciti; su Fedora/RHEL usa il mark di DNF. Non rimuove pacchetti e una seconda esecuzione non cambia il risultato.

Inoltre lo script cerca nei file `/etc/modprobe.d/*.conf` un override esplicito `nvidia_drm modeset=0`, lo corregge in `1`, rigenera il relativo initramfs e riavvia la VM **soltanto se ha cambiato qualcosa**. Se la configurazione e' gia' corretta, resta idempotente.

## RDP e audio

Il profilo Windows [windows-rdstls-template.rdp](../clients/windows-rdstls-template.rdp) e' un file Unicode UTF-16 LE, leggibile dal client Windows preinstallato `mstsc.exe`. Oltre a RDSTLS contiene:

```ini
audiomode:i:0          ; riproduci l'audio remoto sul PC Windows
audiocapturemode:i:0   ; non inviare il microfono del PC Windows
```

GNOME Remote Desktop installato include canali RDP audio basati su PipeWire (playback e input). Il profilo richiede quindi l'audio di riproduzione sul client locale. La riproduzione effettiva e' stata ascoltata e confermata manualmente dall'utente sul PC Windows: playback riuscito. Il microfono resta disabilitato dal profilo (`audiocapturemode:i:0`) e non e' stato testato.
