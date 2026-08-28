# Patch Sunshine e CUDA: cosa cambia, riga per riga

Questa e' la spiegazione del codice usato nel laboratorio Omarchy. Non sono
patch generiche per ogni laptop: si applicano alla sorgente Sunshine indicata
nel runbook e alla GTX 1050 Pascal passata alla VM.

## 1. Prima: il problema non era NVENC

La VM aveva due DRM device: la GTX e VirtIO. Hyprland produceva il desktop
VirtIO `Virtual-1`, mentre Sunshine tentava di aprire/copiare quel DMA-BUF con
la GTX. Due driver diversi non garantiscono che un buffer DMA-BUF possa essere
importato dall'altro: il log era `Couldn't import RGB Image: 0000300C` e
Moonlight mostrava frame corrotti o neri.

Il fix strutturale e' il setup guest, non questa patch: Hyprland e' fissato a
`/dev/dri/gtx1050`, senza connettore fisico grazie a
`AQ_NO_KMS_REQUIREMENT=1`, e crea l'uscita headless `omarchy-gtx`. Quindi la
cattura nasce gia' sulla GTX.

## 2. Patch GBM/Wayland conservata nel build

File: [`sunshine-wayland-virtio-gbm.patch`](../patches/sunshine-wayland-virtio-gbm.patch).

### `src/platform/linux/wayland.cpp`

```cpp
current_bo = gbm_bo_create(..., GBM_BO_USE_RENDERING);
if (!current_bo) {
  current_bo = gbm_bo_create(..., GBM_BO_USE_LINEAR);
}
```

- Il primo tentativo chiede un buffer GBM renderizzabile: e' la scelta normale.
- Alcuni buffer screencopy esportabili da VirtIO rifiutano quel flag ma
  accettano il layout lineare. Il secondo tentativo evita un fallimento senza
  cambiare formato o inventare una GPU.
- Il log `GBM request: larghezzaxaltezza fourcc=...` e' diagnostica: permette
  di associare una richiesta di Sunshine alla risoluzione reale.

### `src/platform/linux/wlgrab.cpp`

```cpp
const auto render_path = platf::resolve_render_device();
render_fd = open(render_path.c_str(), O_RDWR | O_CLOEXEC);
gbm.reset(gbm::create_device(render_fd));
egl_display = egl::make_display(gbm.get());
```

- `resolve_render_device()` sceglie il render node dichiarato dalla sessione:
  qui la GTX, non il display VirtIO ereditato.
- `open(..., O_CLOEXEC)` apre solo il DRM render node: non prende il controllo
  di un connettore né modifica KMS.
- `gbm::create_device(render_fd)` crea il contesto GBM corretto.
- `egl::make_display(gbm.get())` associa EGL a quel contesto. Prima usava il
  display Wayland implicito, che poteva appartenere a VirtIO.
- Il distruttore aggiunto chiude `render_fd` e libera GBM, evitando di perdere
  file descriptor a ogni restart.

Questa patch risolve robustezza e attribuzione del device; non e' una promessa
che tutti i buffer di ogni coppia di driver possano essere condivisi.

## 3. Patch storica che usa la RAM - e perche' il canary NON la usa

File: [`sunshine-linux-nvenc-system-memory-input.patch`](../patches/sunshine-linux-nvenc-system-memory-input.patch).

Nel build stabile, in `src/video.cpp`, la lista degli input preferiti cambia
cosi':

```diff
- AV_HWDEVICE_TYPE_CUDA, AV_HWDEVICE_TYPE_NONE, AV_PIX_FMT_CUDA,
+ AV_HWDEVICE_TYPE_NONE, AV_HWDEVICE_TYPE_NONE, AV_PIX_FMT_NONE,
  AV_PIX_FMT_NV12, AV_PIX_FMT_P010
```

Significato: Sunshine smette deliberatamente di creare un input CUDA/`AV_PIX_FMT_CUDA`
per FFmpeg e usa immagini NV12/P010 in memoria di sistema. La patch aggirava
`Couldn't scale frame: Invalid argument`; NVENC restava attivo, ma il frame
faceva `GTX -> RAM -> upload FFmpeg -> NVENC`.

Il canary CUDA 12 e' stato compilato **senza questa patch**: ripristina
`AV_HWDEVICE_TYPE_CUDA`, `AV_PIX_FMT_CUDA` e
`cuda_init_avcodec_hardware_input_buffer`. E' il passaggio che rende possibile
il percorso VRAM/CUDA, non un cambio magico del codec.

## 4. Patch di compilazione Pascal, non patch dell'applicazione

File: [`sunshine-cuda12-pascal-sm61.patch`](../patches/sunshine-cuda12-pascal-sm61.patch).

Sunshine recente prova a costruire molte architetture CUDA. CUDA 12.8 puo'
ancora produrre codice per Pascal, CUDA 13 no. La patch sostituisce l'elenco
predefinito con `61` e imposta esplicitamente:

```cmake
set(CMAKE_CUDA_ARCHITECTURES 61)
```

`61` e' la compute capability della GTX 1050. La prova reale e' nel comando
`nvcc` generato dalla build:

```text
--generate-code=arch=compute_61,code=[compute_61,sm_61]
```

Questo non fa la GPU piu' moderna: evita solo di compilare codice inutile e
permette di usare l'ultima toolchain CUDA che supporta Pascal.

## 5. Compatibilita' CUDA 12.8 con glibc 2.44

File: [`cuda-12.8-glibc-2.44-noexcept.patch`](../patches/cuda-12.8-glibc-2.44-noexcept.patch).

glibc 2.44 dichiara alcune funzioni matematiche con `noexcept`; le intestazioni
CUDA 12.8 estratte non avevano la stessa specifica. Il compilatore rifiuta due
dichiarazioni diverse della stessa funzione. La patch aggiunge solo
`noexcept(true)` a `sinpi`, `cospi`, `sinpif`, `cospif`, `rsqrt` e varianti,
allineando le firme C++.

La patch e' stata applicata **alla copia estratta** di CUDA in `/var/tmp`, con
backup `.orig`; non a `/usr`, al driver NVIDIA, al kernel o al firmware della
VM. Prima di riusarla, eseguire un dry-run su CUDA 12.8 esatta:

```bash
cd "$CUDA_ROOT/targets/x86_64-linux/include"
patch --dry-run -p1 < cuda-12.8-glibc-2.44-noexcept.patch
```

Se il dry-run non applica pulito, fermarsi: una versione CUDA o glibc diversa
richiede una nuova revisione, non forzare la patch.

## 6. Cosa usa la GTX oggi

1. Hyprland usa la GTX per rendering/compositing; `nvidia-smi pmon` mostra
   `Hyprland` come processo `G`.
2. Sunshine canary e' il binario `/opt/sunshine-cuda12/bin/sunshine`, compilato
   con `SUNSHINE_ENABLE_CUDA=ON` e `src/platform/linux/cuda.cu`.
3. FFmpeg/Sunshine seleziona `h264_nvenc` e, dopo il probe HEVC, anche
   `hevc_nvenc`: FFmpeg consegna la codifica al blocco NVENC della GTX.
4. Finche' Moonlight non e' connesso, `nvidia-smi pmon` non puo' mostrare un
   valore `enc` significativo. Un vero stream deve ancora misurare CPU e
   confermare il percorso CUDA senza copia RAM.

## 7. Riproduzione e rollback

Il setup dei file guest e' nel [runbook PVE/guest](omarchy-proxmox-guest-setup.md).
Il cambio binario e' intenzionalmente separato e idempotente:

```bash
sudo omarchy-sunshine-cuda12-canary status
sudo omarchy-sunshine-cuda12-canary rollback  # ritorna al build stabile
sudo omarchy-sunshine-cuda12-canary activate  # prova di nuovo il canary
```

Il rollback non tocca Hyprland, Proxmox, VFIO, VBIOS, SSDT, `fw_cfg` o la ROM.
