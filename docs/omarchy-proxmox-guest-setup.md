# Setup riproducibile: Proxmox, Omarchy, Hyprland e Sunshine sulla GTX

Questa guida documenta la configurazione verificata per la VM Omarchy `1002`.
Il prerequisito e' che il passthrough mobile/Optimus sia gia' funzionante:
`nvidia-smi` deve rilevare la GPU. Per VBIOS, `fw_cfg`, SSDT e `_ROM` usare
[il runbook principale](reproducible-runbook.md); qui iniziano desktop headless
e streaming.

## Obiettivo e concetto chiave

La GTX 1050 Mobile MUXless non ha un monitor fisico collegato nel guest: il
connettore NVIDIA risulta `disconnected`. Non bisogna quindi simulare
`HDMI-A-1`; bisogna creare un output Wayland senza connettore fisico.

```text
GTX PCI passthrough
    -> Hyprland renderizza su /dev/dri/gtx1050
    -> output Wayland virtuale omarchy-gtx
    -> Sunshine cattura l'output
    -> NVENC H.264/HEVC della GTX codifica
    -> Moonlight riceve 1920x1200 a 60 Hz
```

La console noVNC e il desktop sono distinti: VirtIO puo' restare come recupero,
mentre Hyprland viene fissato esplicitamente alla GTX.

## 1. Configurazione PVE effettiva

Sul nodo controllare anzitutto lo stato senza modificarlo:

```bash
# [NODO PVE]
qm config 1002
qm status 1002
```

Le righe significative della VM testata sono:

```ini
agent: 1
machine: q35
cpu: host,hidden=1
hostpci0: 0000:02:00,pcie=1,rombar=0,romfile=gtx1050_hp_native.rom
args: -acpitable file=/usr/share/kvm/optimus-gpu-switch/ssdt-1002.aml -fw_cfg name=opt/com.lion328/nvidia-rom,file=/usr/share/kvm/gtx1050_hp_native.rom
vga: virtio
```

- `q35` fornisce la topologia PCIe virtuale da cui lo script ricava lo scope
  ACPI; `agent: 1` consente allo script di vedere lo stato del guest.
- `hostpci0` passa la GTX fisica; `pcie=1` usa PCIe. `rombar=0` e' intenzionale:
  la sola finestra ROM PCI non soddisfa il driver mobile.
- `romfile` e `fw_cfg` espongono lo stesso VBIOS OEM. La SSDT in `-acpitable`
  implementa `_ROM(offset, length)` e lo serve al driver: e' il pezzo che
  manca al semplice passthrough PCI in questo laptop.
- `hidden=1` e' il valore gestito dallo switch per minimizzare segnali palesi
  di virtualizzazione.
- `vga: virtio` e' soltanto la console noVNC di emergenza, non prova che il
  desktop la stia usando. Non passare a `vga: none` finche' Moonlight non e'
  stato verificato ripetutamente.

Non aggiungere `drm.edid_firmware` o `video=HDMI-A-1:...` a Limine: il
connettore e' fisicamente assente per questa topologia e quel tentativo ha
bloccato il guest. L'output corretto e' Wayland headless.

## 2. Controlli minimi nella VM

```bash
# [GUEST]
nvidia-smi
readlink -f /dev/dri/gtx1050
test -r /dev/dri/gtx1050 && echo 'alias DRM GTX disponibile'
```

Nella VM verificata si ottengono `NVIDIA GeForce GTX 1050`, driver
`580.178.04` e `/dev/dri/gtx1050 -> /dev/dri/card0`. Se `nvidia-smi` fallisce,
fermarsi: Sunshine non puo' correggere un problema di VBIOS/SSDT/VFIO/driver.

## 3. File guest e loro significato

Il programma idempotente
[`omarchy-gtx-primary`](../scripts/omarchy-gtx-primary) crea e conserva i
backup di questi file; non e' necessario scriverli manualmente.

`~/.config/uwsm/env-hyprland`:

```bash
export AQ_DRM_DEVICES="/dev/dri/gtx1050"
export AQ_NO_KMS_REQUIREMENT=1
```

`AQ_DRM_DEVICES` impedisce a Hyprland di scegliere VirtIO. Con
`AQ_NO_KMS_REQUIREMENT=1` la sessione puo' esistere anche senza un connettore
KMS NVIDIA: e' cosi' che la GTX diventa la GPU del compositor headless.

`~/.config/sunshine/sunshine.conf`, sole chiavi rilevanti:

```ini
capture = wlr
encoder = nvenc
hevc_mode = 0
av1_mode = 1
adapter_name = /dev/dri/gtx1050
nvenc_preset = 3
```

`wlr` cattura Wayland; `adapter_name` seleziona la GTX; `encoder = nvenc`
richiede l'encoder NVIDIA. La richiesta non e' una prova: la prova reale e'
`h264_nvenc` nel journal e `enc > 0` in `nvidia-smi pmon` durante uno stream.

`hevc_mode = 0` e' il rilevamento automatico raccomandato da Sunshine: il
client puo' scegliere HEVC/H.265 soltanto dopo il probe del driver. Nel guest
questo probe ha trovato `hevc_nvenc`, quindi Moonlight puo' usare HEVC per una
qualita' migliore allo stesso bitrate. H.264 rimane il fallback piu'
compatibile. `av1_mode = 1` disabilita AV1: la GTX 1050 Pascal non possiede
un encoder AV1 hardware; pubblicizzarlo causerebbe un fallback software.
`nvenc_preset = 3` mantiene qualita' a pari bitrate senza penalizzare il
campione misurato: HEVC ha mostrato 7.9 ms di latenza host media e 0% drop.
P1/P2 sono opzioni per un problema reale di encoding, non una cura per bande
nere dovute a una risoluzione diversa dalla superficie catturata.

`~/.config/hypr/monitors.lua` riceve un blocco gestito unico:

```lua
-- BEGIN sunshine-virtual-display (managed locally)
-- GTX-only Wayland output for Sunshine/Moonlight; no VirtIO display ownership.
hl.monitor({ output = "omarchy-gtx", mode = "1920x1200@60", position = "0x0", scale = 1 })
-- END sunshine-virtual-display
```

La drop-in utente
`~/.config/systemd/user/app-dev.lizardbyte.app.Sunshine.service.d/25-headless-output.conf` e':

```ini
# Managed by omarchy-gtx-primary.
[Service]
ExecStartPre=/home/daubog44/.local/bin/omarchy-headless-output
```

L'helper attende la sessione Hyprland, ricava la firma dinamica della sessione,
crea `omarchy-gtx` solo se assente, ricarica le regole e verifica l'output
prima di permettere a Sunshine di partire. Questo evita la gara di avvio che
causava catture nere/corrotte dopo boot o restart.

`prepare-headless` installa anche due funzioni nel blocco gestito di
`~/.bashrc` e i rispettivi eseguibili in `~/.local/bin`:

```bash
# Cambio persistente/idempotente: aggiorna omarchy-gtx e riavvia Sunshine.
# Il Desktop Moonlight corrente viene chiuso e va riaperto.
omarchy_stream_resolution 1920x1200@60

# Durante Desktop Moonlight: rende visibili NVENC, GBM e fallback.
omarchy_stream_health watch
```

Il comando statico definisce il fallback dopo una disconnessione. Alla prossima
apertura di Desktop, `omarchy-moonlight-mode apply` legge le variabili
`SUNSHINE_CLIENT_WIDTH`, `HEIGHT` e `FPS`, poi applica la modalita' richiesta
all'output `omarchy-gtx` tramite l'API Lua di Hyprland. Non riavvia Sunshine e
non tocca VirtIO; una sola uscita significa una sola modalita' condivisa, non
due schermi indipendenti per client simultanei. Eseguire di nuovo
`prepare-headless` non duplica ne' l'hook Desktop ne' regole; per usare il
comando con trattini senza riaprire la shell:
`omarchy-stream-resolution 1920x1200@60`. La `.bashrc` va caricata con
`source ~/.bashrc`, non eseguita con `bash ~/.bashrc`: il suo `return` per le
shell non interattive e' previsto.

### Bitrate, NVENC e clipboard nel client Windows

Il bitrate e' deciso dal **client Moonlight**, non da `sunshine.conf`. Nel
profilo Windows di questo laboratorio il valore iniziale era 23 Mbps e il
target e' stato impostato a 40 Mbps fissi per 1920x1200/60 HEVC. Il file
[`clients/moonlight-windows-settings.ps1`](../clients/moonlight-windows-settings.ps1)
mostra o imposta il valore in modo riproducibile; Moonlight va chiuso e
riaperto prima di riconnettersi.

`enc > 0` in `nvidia-smi pmon` o NVTOP prova che Sunshine sta usando NVENC:
e' la percentuale di occupazione del motore encoder nel suo intervallo di
misura, non Mbps e non l'utilizzo totale della GTX. In questo setup sono stati
osservati `enc=28`, `enc=30` e `NVTOP enc=38%`, valori compatibili tra loro.

Moonlight non possiede clipboard bidirezionale; KDE Connect e' il canale
separato scelto. Il lato Omarchy e' installato e in ascolto sulla porta 1716.
Completare l'installazione elevata di KDE Connect su Windows, fare pairing
reciproco e abilitare il plugin Clipboard. La guida con le considerazioni di
fiducia, firewall e privacy e' in
[Sunshine/Moonlight su Omarchy](sunshine-moonlight-omarchy.md).

## 4. Applicazione, verifica e rollback

```bash
# [GUEST] dopo avere copiato scripts/omarchy-gtx-primary nella VM
sudo install -m 0755 ./omarchy-gtx-primary /usr/local/sbin/omarchy-gtx-primary
sudo /usr/local/sbin/omarchy-gtx-primary prepare-headless
sudo /usr/local/sbin/omarchy-gtx-primary verify-headless

# Riavviare la sessione grafica o la VM; poi in una sessione Omarchy:
systemctl --user daemon-reload
systemctl --user restart app-dev.lizardbyte.app.Sunshine.service
sudo /usr/local/sbin/omarchy-gtx-primary status-runtime
```

Il programma e' idempotente: sostituisce le due export, riscrive soltanto il
blocco monitor delimitato, non duplica la drop-in e conserva un solo backup in
`/root/omarchy-gtx-headless-backup`. Non modifica VBIOS, SSDT, `fw_cfg`, VFIO,
Limine, kernel o configurazione Proxmox.

Per annullare solo il layer desktop/streaming:

```bash
sudo /usr/local/sbin/omarchy-gtx-primary rollback-guest
systemctl --user daemon-reload
systemctl --user restart app-dev.lizardbyte.app.Sunshine.service
```

Per disassegnare invece la GPU e assegnarla a un'altra VM, usare sul nodo
`gpu-vm-switch --vm <VMID>`; lo switch effettua il cleanup di `hostpci`, ROM,
SSDT e `fw_cfg` della sorgente prima della destinazione.

## 5. Prova end-to-end riproducibile

Impostare Moonlight a 1920x1200/60, aprire `Desktop` e muovere finestre per
alcuni secondi. Dopo un cambio modalita' lo stream viene chiuso
intenzionalmente: riaprire Desktop prima della verifica. Quindi nel guest:

```bash
sudo /usr/local/sbin/omarchy-gtx-primary status-runtime
journalctl --user -u app-dev.lizardbyte.app.Sunshine.service --since '2 minutes ago' --no-pager \
  | grep -E 'GBM request|h264_nvenc|hevc_nvenc|CLIENT CONNECTED|libx264|scale frame'
omarchy_stream_health watch
ps -eo pid,nlwp,pcpu,pmem,rss,comm,args --sort=-pcpu | head -n 15
```

Atteso:

```text
Monitor omarchy-gtx ... 1920x1200@60 ... scale 1
Hyprland ... G                   # compositor sulla GPU 0
sunshine  ... C+G ... enc > 0    # cattura e NVENC durante stream
Found H.264 encoder: h264_nvenc [nvenc]
Found HEVC encoder: hevc_nvenc [nvenc]
```

`enc > 0` prova che NVENC, un blocco hardware della GTX, codifica il flusso.
Le righe ripetute in `htop` sono thread e non vanno sommate: confrontare il
processo intero in `ps` con `nvidia-smi pmon`.

## 6. CUDA, RAM e limite del build stabile precedente

Il build stabile precedente usava NVENC ma gli passava un frame NV12 in RAM:

```text
GTX -> RAM di sistema -> upload FFmpeg -> NVENC GTX
```

Questo **non** e' `libx264`: in `libx264` la CPU comprimerebbe il video e
`enc` NVIDIA resterebbe zero. `libx264` e' apparso solo nel test del pacchetto
Arch ufficiale; la relativa drop-in temporanea e' stata rimossa e non e' il
servizio attivo.

CUDA non serve ad attivare NVENC - che e' gia' hardware - ma a lasciare a
Sunshine superfici di cattura CUDA in VRAM, evitando potenzialmente la copia
in RAM. FFmpeg usa la GTX quando seleziona `h264_nvenc` o `hevc_nvenc`: quei
codec consegnano la compressione al blocco NVENC del driver NVIDIA. Il guadagno
di CPU/latency del percorso CUDA e' una possibilita' da misurare, non una
promessa. La GTX 1050 e' Pascal `sm_61`: CUDA 13 non puo' compilare offline
per quell'architettura.

Il canary verificato usa CUDA 12.8 e GCC 14 isolati in `/var/tmp`, compila
`cuda.cu`, e installa il risultato separatamente in
`/opt/sunshine-cuda12/bin/sunshine`. Una drop-in idempotente lo rende attivo
solo dopo che il journal conferma `Found H.264 encoder: h264_nvenc [nvenc]`.
Il probe attuale ha inoltre confermato `Found HEVC encoder: hevc_nvenc [nvenc]`.
Lo script [`omarchy-sunshine-cuda12-canary`](../scripts/omarchy-sunshine-cuda12-canary)
gestisce la scelta reversibile:

```bash
sudo omarchy-sunshine-cuda12-canary status
sudo omarchy-sunshine-cuda12-canary activate
sudo omarchy-sunshine-cuda12-canary rollback  # torna al binario precedente
```

L'help installato nella VM e' questo:

```text
Uso: omarchy-sunshine-cuda12-canary <activate|status|rollback>

  activate  seleziona il canary CUDA, riavvia Sunshine e richiede h264_nvenc.
  status    mostra drop-in, eseguibile, log encoder e processi NVIDIA.
  rollback  rimuove soltanto la drop-in gestita e riavvia Sunshine stabile.
```

`activate` ripristina automaticamente il servizio precedente se Sunshine non
diventa attivo o non rileva `h264_nvenc`. Anche con il canary attivo, la prova
del vero percorso CUDA e della CPU inferiore richiede un stream Moonlight
reale; build e avvio da soli non la dimostrano.

Per la storia dei frame corrotti VirtIO--NVIDIA, dello stream 1920x1200/HEVC e dei
limiti verificati, vedere [Sunshine/Moonlight su Omarchy](sunshine-moonlight-omarchy.md).
Le modifiche di codice, una per una, sono in
[patch Sunshine e CUDA](sunshine-patch-breakdown.md).
