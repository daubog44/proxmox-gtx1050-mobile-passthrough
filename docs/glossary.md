# Glossario del laboratorio

Questo glossario separa termini che spesso vengono confusi. I riferimenti nel testo si riferiscono al caso HP Pavilion 15-cs1xxx/GTX 1050 Mobile documentato in questo repository.

## Hardware e PCIe

| Termine | Significato pratico |
| --- | --- |
| **BDF** | *Bus:Device.Function*, indirizzo PCI. Con il dominio completo è `0000:02:00.0`: dominio `0000`, bus `02`, device `00`, funzione grafica `0`. La funzione `.1`, se presente, è spesso l'audio HDMI/DP. Lo script chiede il BDF senza funzione (`0000:02:00`) perché usa la funzione grafica `.0`. |
| **PCI ID** | Coppia vendor:device nel formato `10de:1c8d`. `10de` è NVIDIA; `1c8d` identifica questa GTX 1050 Mobile. È diverso dal BDF: l'ID dice *che dispositivo è*, il BDF *dove è collegato*. |
| **PCIe** | Bus ad alta velocità che collega GPU, rete e dischi al processore/chipset. Il passthrough assegna una funzione PCIe reale a QEMU. |
| **IOMMU group** | Gruppo di dispositivi che l'hardware può isolare insieme per la DMA. Non basta vedere la GPU in `lspci`: il suo gruppo deve essere adatto al passthrough. |
| **DMA** | Accesso diretto di un dispositivo alla RAM. Senza IOMMU una GPU potrebbe leggere/scrivere memoria oltre i limiti della VM. |
| **IOMMU / VT-d / AMD-Vi** | Hardware e firmware che traducono/isola la DMA. Intel la chiama normalmente VT-d, AMD AMD-Vi. È il prerequisito di sicurezza del passthrough. |
| **VFIO** | Infrastruttura del kernel Linux che espone un dispositivo reale a QEMU in modo controllato. |
| **vfio-pci** | Driver Linux che “possiede” la GPU per QEMU invece del driver grafico dell'host. Sul nodo verificato `lspci -nnk` mostra `Kernel driver in use: vfio-pci`. |
| **GP107M / Pascal** | GP107M è il chip mobile NVIDIA della famiglia Pascal usato dalla GTX 1050 del caso. La `M` indica mobile; non implica che qualunque GP107M usi la stessa VBIOS. |
| **VRAM / GDDR5** | Memoria fisica della GPU. Qui `nvidia-smi` ha mostrato 4096 MiB. Non è RAM della VM. |

## Firmware, boot e virtualizzazione

| Termine | Significato pratico |
| --- | --- |
| **VBIOS** | Firmware che inizializza e descrive una GPU. Nel caso è la versione `86.07.5F.00.2C`. |
| **ROM / file `.rom`** | In questo progetto è il file binario che contiene la VBIOS. “ROM” può anche significare una finestra ROM PCI hardware: il contesto decide quale dei due significati vale. |
| **ROM PCI option** | Formato firmware PCI che inizia spesso con `55 aa` e contiene header `PCIR`; l'estrattore usa queste firme per trovare la VBIOS nel payload HP. |
| **GOP** | *Graphics Output Protocol*, porzione UEFI della VBIOS; una ROM può contenere sia immagine legacy sia GOP UEFI. |
| **OEM** | *Original Equipment Manufacturer*. Una VBIOS OEM è quella preparata per quel modello/laptop; può incorporare dettagli di alimentazione, display e scheda madre. |
| **BIOS / UEFI** | Firmware della macchina virtuale. SeaBIOS è legacy BIOS; OVMF è UEFI per QEMU. Lo script non converte una VM dall'uno all'altro. |
| **OVMF** | Firmware UEFI open source usato da QEMU/Proxmox. Le sue variabili persistenti stanno in `efidisk0`. |
| **efidisk0** | Disco piccolo Proxmox che conserva le variabili UEFI. Non è il disco del sistema operativo. Sostituirlo può cambiare le chiavi Secure Boot e le voci di boot. |
| **Q35** | Chipset virtuale moderno di QEMU con root port PCIe. In questo progetto è obbligatorio perché la discovery PCI/ACPI e il passthrough sono basati su quella topologia. |
| **QEMU Guest Agent (QGA)** | Servizio nel guest che consente a Proxmox di eseguire controlli come `lspci`, `mokutil` e `nvidia-smi` senza dipendere dalla rete SSH. |
| **QEMU** | Emulatore/virtualizzatore che esegue la VM. Proxmox genera per QEMU la configurazione scelta con `qm set`. |
| **`hostpci`** | Chiave della configurazione Proxmox che collega una funzione PCI fisica alla VM. |
| **`romfile`** | Opzione `hostpci` che indica un file ROM a QEMU. In questo caso viene mantenuta per la configurazione PCI, ma da sola non basta per il driver Optimus. |
| **`rombar`** | Opzione che espone (`1`) o nasconde (`0`) la finestra ROM PCI al guest. Qui è volutamente `0`: il percorso affidabile è ACPI `_ROM`, non la ROM BAR PCI. |
| **`fw_cfg`** | Piccolo canale QEMU per fornire blob al firmware/guest. Questo progetto passa il file `.rom` come `opt/com.lion328/nvidia-rom`; `fw_cfg` non interpreta il firmware. |

## ACPI: la parte che risolve Optimus

| Termine | Significato pratico |
| --- | --- |
| **ACPI** | Standard firmware che descrive device, alimentazione e metodi al sistema operativo. Nei laptop è fondamentale per la GPU discreta e Optimus. |
| **DSDT** | Tabella ACPI principale fornita dal firmware QEMU/OVMF/SeaBIOS. Contiene device esistenti come `\_SB.PCI0`. Non viene modificata dal progetto. |
| **SSDT** | Tabella ACPI aggiuntiva. Lo script ne genera una per VM e QEMU la carica con `-acpitable`. Aggiunge `_ROM` alla GPU senza sostituire la DSDT. |
| **ASL** | *ACPI Source Language*: sorgente testuale leggibile, estensione `.asl`. È ciò che lo script genera per primo. |
| **AML** | *ACPI Machine Language*: bytecode compilato, estensione `.aml`, prodotto da `iasl`. È ciò che QEMU carica davvero. |
| **iasl / ACPICA** | Compilatore/disassemblatore ASL/AML. `gpu-vm-switch --self-test` crea, compila e disassembla una SSDT di prova. |
| **Scope** | Ramo della gerarchia ACPI in cui una dichiarazione vive. Il `_ROM` deve essere nello scope della GPU corretta, non semplicemente in `PCI0`. |
| **`\_SB.PCI0`** | Device ACPI tipico: system bus e root PCI virtuale. È il punto di partenza dello scope della GPU. |
| **`External`** | Dichiarazione ASL di un oggetto che esiste già in un'altra tabella; permette alla SSDT di riferirsi al device PCI della DSDT. |
| **`DeviceObj`** | Tipo dell'oggetto ACPI dichiarato da `External`: un device già esistente. |
| **`Method`** | Funzione AML eseguibile dal firmware/driver. `_ROM` è un metodo con due argomenti. |
| **`_ROM(offset, length)`** | Metodo ACPI standard: il driver chiede una porzione di VBIOS partendo da `offset` per `length` byte. Il workaround lo implementa usando il buffer letto da `fw_cfg`. |
| **`OperationRegion` / `Field`** | ASL usato per dichiarare una zona leggibile e i suoi registri. Qui descrivono i registri I/O da cui la SSDT legge il catalogo QEMU `fw_cfg`. |
| **`RWRD`, `RDWD`, `RBUF`** | Metodi AML di supporto creati dalla SSDT: leggono rispettivamente word, dword e buffer dal canale `fw_cfg`. |
| **`RINT`** | Metodo AML di inizializzazione: trova una volta il file `fw_cfg` e lo salva nel buffer `FWBI`. |
| **`FWBI`** | Buffer AML che conserva in memoria la VBIOS OEM letta da `fw_cfg`. |
| **`Mid`** | Operazione AML che restituisce un segmento di un buffer. `_ROM` usa `Mid(FWBI, offset, length)`. |
| **PCI -> ACPI** | `lspci -PP` mostra il percorso PCI del guest, per esempio `00:1c.0/01:00.0`. Per ogni hop lo script calcola `slot * 8 + funzione`: `1c.0 -> 0xe0 -> SE0`, `00.0 -> S00`; lo scope diventa `\_SB.PCI0.SE0.S00`. |

## Driver, grafica e Optimus

| Termine | Significato pratico |
| --- | --- |
| **Optimus / muxless** | Design laptop in cui il pannello fisico è cablato alla iGPU; la NVIDIA renderizza e passa i frame attraverso la grafica integrata. È perché il driver può dipendere da ACPI/VBIOS della piattaforma. |
| **render-only** | GPU utile per calcolo/rendering ma senza un proprio output display assegnabile alla VM. Non è un errore se manca un connettore DRM fisico. |
| **CRTC** | Blocco hardware che guida un output video. Una GPU render-only può non esporne uno utile nel guest. |
| **DKMS** | Sistema che ricompila automaticamente un modulo kernel quando cambia kernel. NVIDIA può usarlo per creare `nvidia.ko` nel guest. |
| **modulo kernel** | Codice caricato dal kernel, qui il driver NVIDIA. È diverso dalle librerie userspace usate da `nvidia-smi`. |
| **`nvidia_drm`** | Parte DRM del driver kernel NVIDIA. Espone la GPU al sottosistema grafico Linux; il suo parametro `modeset` deve essere `Y` per il desktop Wayland accelerato di questo caso. |
| **KMS / `modeset=1`** | *Kernel Mode Setting*: il kernel gestisce modalita' display e buffer attraverso DRM. In questo guest consente a Mutter/GNOME di scegliere `nvidia-drm` come GPU primaria; `modeset=0` lasciava Xwayland su llvmpipe. |
| **GBM** | *Generic Buffer Management*: interfaccia con cui il compositor Wayland ottiene buffer grafici DRM. Nel journal corretto GNOME crea un renderer GBM per `nvidia-drm`. |
| **Wayland** | Protocollo e architettura del desktop moderno. Qui GNOME Shell e' il display server Wayland; `loginctl` mostra `Type=wayland`. Non e' Xorg anche se una singola app usa GLX. |
| **Xwayland** | Server X11 di compatibilita' dentro una sessione Wayland. Permette a `glxgears` (app X11/GLX) di aprirsi nel desktop Wayland. Deve selezionare NVIDIA, non llvmpipe. |
| **llvmpipe** | Renderer Mesa software: OpenGL viene eseguito dalla CPU. Non e' un errore di `nvidia-smi`, ma e' errato per un test grafico NVIDIA; si riconosce con `glxinfo -B`. |
| **VSync / vertical refresh** | Sincronizzazione della presentazione dei frame con il refresh del display. Sul monitor RDP a 60 Hz `glxgears` mostra circa 60 FPS: e' normale e non misura il limite della GPU. |
| **`nvidia-smi`** | Utility NVIDIA che verifica enumerazione, driver, VRAM e processi GPU. È la verifica minima dello switch. |
| **Xorg headless** | Server grafico X senza monitor fisico. Nel guest è stato creato sul display `:2` per lanciare un benchmark OpenGL in SSH. |
| **GLX / `glxgears`** | GLX collega OpenGL a X11. `glxgears` disegna tre ingranaggi e stampa FPS; il wrapper `nvidia-glxgears` forza il display NVIDIA headless. |
| **`glmark2`** | Benchmark OpenGL. Da SSH senza `DISPLAY` dà “Could not initialize canvas”; non prova un guasto della GPU. |
| **`nvtop`** | Monitor per GPU, VRAM e processi. È più adatto di `htop` al carico NVIDIA. |
| **`htop`** | Monitor CPU/RAM/processi del sistema operativo; non legge i contatori proprietari della GPU NVIDIA. |
| **profilo `.rdp` / RDSTLS** | File di configurazione letto da `mstsc.exe`, la stessa app Windows preinstallata. Qui trasporta `use redirection server name:i:1` per GNOME Remote Login; non contiene password. |
| **`audiomode:i:0`** | Attributo del profilo RDP che chiede di riprodurre sul PC Windows l'audio generato dalla VM. E' separato dal passthrough GPU. |
| **RDP hand-over / consegna** | Passaggio controllato del client RDP da un daemon GNOME a un altro: sistema -> greeter Wayland -> sessione Wayland dell'utente. Il client si disconnette e si riconnette intenzionalmente usando un token; non e' un reset della GPU. |
| **Server Redirection** | Messaggio RDP con cui il primo server dice al client di riconnettersi al destinatario successivo. `ERRINFO_LOGOFF_BY_USER` subito dopo puo' essere la chiusura normale del primo socket. |
| **NLA e RDSTLS** | Due metodi di sicurezza RDP. NLA autentica con CredSSP/NTLM; RDSTLS permette a GNOME di portare nel secondo tratto le credenziali monouso della redirezione. Il profilo imposta RDSTLS per `mstsc`. |
| **SAM FreeRDP** | Database NTLM interno della libreria FreeRDP, non `/etc/passwd` Linux. L'errore SAM durante il secondo tratto segnala una negoziazione NLA errata, non un problema NVIDIA. |
| **`gsd-sharing` / `system_service_running`** | Plugin di GNOME Settings Daemon che avvia/ferma servizi della sessione. Il flag e' vero quando il daemon RDP di sistema e' attivo; il backport lo controlla prima di fermare il daemon di hand-over. |

## Streaming Wayland, Sunshine e Moonlight su Omarchy

### Keyd e Super one-shot

**keyd** e' un demone di rimappatura del keyboard input: legge gli eventi
prima del compositor e presenta una tastiera virtuale rimappata a Hyprland. Nel
guest Omarchy il file `/etc/keyd/default.conf` contiene
`capslock = oneshot(meta)`. Un tap di Caps arma **Super** solo per il tasto
successivo, quindi `Caps`, poi `W` e' `Super+W` senza dover tenere Caps
premuto. Non e' un Super permanentemente bloccato: dopo quel tasto viene
automaticamente disarmato, cosi' la digitazione normale non viene trasformata
in scorciatoie. Questo e' diverso da `kb_options = "caps:super"`, che crea un
modificatore Super classico da tenere premuto.

### Risoluzione dinamica di Moonlight

Quando il client apre l'app **Desktop**, Sunshine riceve i valori
`SUNSHINE_CLIENT_WIDTH`, `SUNSHINE_CLIENT_HEIGHT` e `SUNSHINE_CLIENT_FPS`.
Non sono ipotesi ricavate dal monitor del server: sono i parametri chiesti dal
client per quella sessione. Nel setup Omarchy, un prep command invoca
`omarchy-moonlight-mode apply`; questo chiama l'API Lua `hl.monitor(...)` di
Hyprland per applicarli al solo output headless `omarchy-gtx` prima della
cattura. Alla disconnessione il comando undo torna al fallback. E' dinamico
per le nuove aperture Desktop, ma non puo' assegnare risoluzioni diverse a due
client contemporanei che guardano la stessa uscita virtuale. Sunshine fornisce
solo le variabili e il punto di aggancio: non puo' integrare nativamente un
unico cambio monitor per tutti i compositor Linux. Qui serve l'helper perche'
`omarchy-gtx` e' un output headless Hyprland, non un connettore fisico.

### Clipboard GameStream

Moonlight puo' inviare testo dal client al guest con la scorciatoia
`Ctrl`+`Alt`+`Shift`+`V`: viene immesso come tastiera nel guest. GameStream non
prevede invece la sincronizzazione del clipboard guest -> client; Sunshine non
ha un'opzione che lo renda bidirezionale. Per una clipboard reale serve un
canale indipendente, qui KDE Connect. Il daemon e' headless ma per copiare da e
verso la GUI occorre una sessione Wayland che possieda la clipboard. Il pairing
di ciascun PC resta manuale: automatizzare chiavi e consenso eliminerebbe la
barriera di fiducia.

### NVENC `enc`

`enc` e' l'occupazione percentuale del motore hardware **NVENC** nel campione
esposto da `nvidia-smi pmon` o NVTOP. Un valore positivo, per esempio 28, 30 o
38%, prova che Sunshine sta codificando con la GTX. Non e' una velocita' in
Mbps e non e' l'utilizzo generale della GPU: per quello vanno letti anche
`sm`, `mem`, FPS, drop e latenza del client.

### Bitrate richiesto

Il **bitrate richiesto** e' il tetto che Moonlight invia all'host nella
negoziazione, espresso internamente in kbps. Non equivale sempre al traffico
esatto osservato sulla LAN: encoder e protocollo hanno rate control e overhead.
Il primo valore osservato era 23000 (23 Mbps). La modalita' `MoonlightDefault`
del tool calcola 46000 (46 Mbps) per 1920x1200/60 con YUV 4:4:4; `Fixed 40`
e' il profilo attualmente scelto dopo una misura LAN di 80,6 Mbps nel percorso
Omarchy→Windows. `autoadjustbitrate` ricalcola il default quando cambiano
risoluzione/FPS, non misura ne' corregge il jitter ad ogni frame.

`RequestedMbps` e' il valore davvero salvato; `MoonlightDefaultMbps` e' il
risultato della formula per il formato corrente. Perciò vedere 23 e 46 insieme
non segnala un errore o una banda da 23 Mbps: indica un profilo ancora a 23 e
un default corrente di 46. Moonlight deve essere chiuso prima di aggiornare il
profilo, altrimenti puo' riscrivere dalla memoria il valore che aveva caricato.

### YUV 4:4:4

**YUV** separa luminosita' (Y) e colore (U/V). Il comune 4:2:0 conserva meno
informazione cromatica per ridurre banda; **4:4:4** conserva invece il colore
per ogni pixel. Per un desktop remoto produce testo e bordi piu' netti, ma
aumenta il bitrate necessario. Non cambia la GPU usata: agisce sul formato
codificato e decodificato. Il target deve stare sotto la banda LAN realmente
sostenibile, lasciando margine per overhead e altri flussi, non sotto il solo
valore nominale della porta o del Wi-Fi.

### vGPU / vGPU Unlock

**vGPU** divide una GPU fisica fra VM con un driver host e profili virtuali; e'
diverso dal passthrough VFIO, che consegna l'intera GPU a una VM. La GTX 1050
Mobile non e' un prodotto ufficialmente supportato da NVIDIA vGPU. `vGPU
Unlock` e' un workaround non supportato, non installato in questo progetto e
non adatto a essere sovrapposto alla configurazione VFIO stabile: richiede un
laboratorio separato, rollback e verifica di compatibilita'/licenza.

### DLNA e Moonlight

**DLNA** e' un protocollo per riprodurre file multimediali su una TV. Non e'
un desktop remoto: non trasporta input, non negozia la risoluzione interattiva
e non usa il percorso Sunshine/NVENC/Moonlight a bassa latenza. Una TV che
esegue Moonlight e' invece un client Sunshine; visualizza lo stesso desktop
headless (mirror), non un secondo monitor indipendente.

| Termine | Significato pratico nel setup Omarchy |
| --- | --- |
| **Hyprland** | Compositor Wayland: compone finestre e desktop in un'immagine finale. Non e' un server RDP e non codifica video; nel setup renderizza sulla GTX grazie a `AQ_DRM_DEVICES`. |
| **Aquamarine / `AQ_DRM_DEVICES`** | Aquamarine e' il backend grafico usato da Hyprland. La variabile indica quale DRM device usare come renderer. Qui `/dev/dri/gtx1050` impedisce che Hyprland scelga VirtIO. |
| **`AQ_NO_KMS_REQUIREMENT=1`** | Permette a Hyprland di iniziare senza un connettore fisico NVIDIA collegato. Non crea HDMI e non rende VirtIO una GTX: permette un compositor render-only/headless, dal quale poi viene creato un output virtuale. |
| **headless** | Letteralmente "senza schermo fisico". In questo progetto Hyprland crea un display virtuale Wayland chiamato `omarchy-gtx`; Moonlight visualizza quel display attraverso Sunshine. Non ci si collega direttamente al display con RDP. |
| **`omarchy-gtx`** | Nome dell'output Wayland virtuale creato da `hyprctl output create headless omarchy-gtx`. La regola in `monitors.lua` gli assegna risoluzione, refresh e scala. Deve esistere prima dell'avvio di Sunshine. |
| **DRM node / render node** | File in `/dev/dri/` che identifica una GPU per programmi grafici. L'alias `/dev/dri/gtx1050` punta alla GTX passata alla VM; selezionarlo evita il salto VirtIO -> NVIDIA. |
| **KMS** | *Kernel Mode Setting*: configura un connettore fisico, una risoluzione e un refresh. La GTX MUXless non ha un connettore guest utile; per questo non si forza HDMI con un EDID finto e si usa un output headless. |
| **DMA-BUF** | Descrittore Linux con cui due processi/driver possono condividere un buffer grafico. Non e' garanzia universale: inizialmente VirtIO produceva il buffer e NVIDIA tentava di importarlo, causando `Couldn't import RGB Image: 0000300C`. |
| **GBM** | *Generic Buffer Management*: API DRM per allocare buffer grafici sulla GPU scelta. Sunshine la usa nella cattura Wayland; il log `GBM request: 1920x1200` prova la dimensione della superficie richiesta, non da solo il codec. |
| **EGL** | API che collega un contesto grafico a un sistema di buffer nativo come GBM. Nella patch Sunshine, EGL viene creato sul render node risolto della GTX anziche' su un display Wayland implicito che poteva appartenere a VirtIO. |
| **`wlr`** | Backend di Sunshine per cattura Wayland tramite il protocollo `wlr-screencopy`. E' idoneo agli output virtuali di Hyprland; non significa che si stia usando X11, RDP o NVFBC. |
| **Sunshine** | Server che cattura il desktop Wayland, prepara i frame e li invia a Moonlight. In questa VM usa `capture = wlr`, `adapter_name = /dev/dri/gtx1050` ed `encoder = nvenc`. |
| **Moonlight** | Client Windows che richiede uno stream a Sunshine, decodifica HEVC/H.264 e presenta l'immagine. Il suo overlay (`Ctrl+Alt+Shift+S`) misura FPS, codec, drop e latenza end-to-end. |
| **NVENC** | Blocco hardware NVIDIA che comprime H.264 o HEVC. E' distinto dai core CUDA. `nvidia-smi pmon` con `sunshine` e `enc > 0` prova che il blocco NVENC sta lavorando nel campione corrente. |
| **`enc`** | Colonna di `nvidia-smi pmon`: percentuale istantanea del motore encoder. Un numero positivo durante `Desktop` Moonlight prova NVENC; `-` o zero con nessun client non prova alcun fallback, puo' significare semplicemente inattivita'. |
| **H.264 / HEVC (H.265)** | Codec video. H.264 e' il fallback piu' compatibile; HEVC offre in genere piu' qualita' a pari bitrate. Sulla GTX 1050 il probe ha trovato `h264_nvenc` e `hevc_nvenc`; AV1 resta disabilitato perche' Pascal non lo codifica in hardware. |
| **CUDA / `sm_61`** | CUDA e' l'API di calcolo NVIDIA. `sm_61` e' la compute capability Pascal della GTX 1050. Il canary Sunshine CUDA 12.8 compila `cuda.cu` per `sm_61` per provare a evitare la copia intermedia in RAM; CUDA non e' cio' che attiva NVENC. |
| **fallback RAM** | Percorso compatibile storico: `GTX -> RAM di sistema -> upload FFmpeg -> NVENC GTX`. NVENC rimane hardware (`enc > 0`) ma copie e conversioni impegnano piu' CPU. E' diverso da `libx264`, dove la CPU codifica il video. |
| **`libx264` fallback** | Vera codifica software H.264 sulla CPU. E' un problema se appare nel journal di uno stream: il comando `omarchy_stream_health watch` lo segnala esplicitamente insieme agli errori di import/scala. |
| **P1/P2/P3** | Preset NVENC: P1 e' il piu' veloce, P3 sacrifica una piccola parte della latenza per migliore compressione/qualita'. Nel campione HEVC P3 documentato la latenza host media era 7.9 ms e i drop rete erano 0%, quindi non e' giustificato abbassarlo solo per le bande nere. |

## Secure Boot e chiavi

| Termine | Significato pratico |
| --- | --- |
| **Secure Boot** | Politica UEFI della VM: avvia componenti firmati da chiavi fidate e fa sì che il kernel rifiuti moduli con firma non fidata. Non è un semplice flag in `qm config`: lo stato va letto **nel guest** con `mokutil --sb-state` o dalla variabile EFI. |
| **MOK** | *Machine Owner Key*: certificato **pubblico** aggiunto dall'utente all'elenco fidato per autorizzare, per esempio, la firma di un modulo DKMS. Non è il driver NVIDIA, non è una chiave privata e non è la password dell'account. |
| **MOK Manager** | Menu UEFI/shim pre-boot che conferma l'enrollment MOK prima del kernel. SSH, rete e QGA non esistono ancora e non possono automatizzarlo. Appare solo se una chiave è pendente. |
| **enrollment MOK** | Registrazione della chiave pubblica nella lista MOK. Avviene in due stadi: `mokutil --import` mette la richiesta in attesa dal Linux già avviato; al reboot UEFI avvia shim e MOK Manager la conferma. |
| **password temporanea MOK** | Segreto scelto durante `mokutil --import`, usato una volta da MOK Manager per confermare la richiesta al boot successivo. Non firma il modulo, non è la password Linux e non si usa ai boot successivi. |
| **`mokutil`** | Utility Linux per leggere Secure Boot, importare un certificato MOK e vedere chiavi in attesa con `--list-new`. L'import richiede password e la conferma firmware al riavvio. |
| **shim** | Piccolo componente UEFI firmato usato da molte distribuzioni Linux. Avvia il bootloader e rende il certificato MOK approvato disponibile alla catena Linux; per questo MOK Manager è “prima del kernel”. La cartella `/var/lib/shim-signed` può contenere certificati rilevanti. |
| **`--mok-manual`** | Modalità dello script che mantiene Secure Boot e non ricrea `efidisk0`. Se, dopo installazione/reboot, il driver non parte, lascia GPU/SSDT/fw_cfg invariati, mostra chiavi pendenti e possibili certificati, poi guida l'utente in noVNC. Non esegue `mokutil --import` e non può premere MOK Manager. |
| **`--disable-secure-boot`** | Modalità alternativa, solo OVMF + `efidisk0` 4m. Crea nuove variabili EFI senza chiavi pre-caricate. È permanente finché non ripristini le vecchie variabili; il percorso non è stato ancora eseguito sulla Ubuntu principale. |

## Idempotenza

Un comando è **idempotente** quando eseguirlo una o più volte porta allo stesso stato senza effetti aggiuntivi indesiderati. Qui significa: preparazione host senza flag/moduli/ROM duplicati; switch già riuscito senza riavvio; configurazione già presente ma MOK incompleto senza staccare e riattaccare la GPU. Idempotenza non significa che lo script possa correggere ogni firmware laptop: gli errori di topologia o VBIOS richiedono diagnosi specifica.

## Come è stato validato il glossario

Il glossario non è una lista copiata da una guida generica. Ogni famiglia di termini è stata confrontata con una fonte concreta:

| Area | Evidenza usata |
| --- | --- |
| BDF, PCI ID, VBIOS e VFIO | `lspci`, driver `vfio-pci` e ROM verificata sul nodo HP |
| Q35, `hostpci`, `rombar`, OVMF e QGA | Configurazione Proxmox e comportamento dello script `gpu-vm-switch` |
| SSDT, ASL, AML, `_ROM` e `fw_cfg` | ASL generata, compilazione/disassemblaggio `iasl` e documentazione QEMU/ACPI |
| Optimus, driver, VRAM e benchmark | `nvidia-smi`, Xorg `:2`, `nvtop` e `nvidia-glxgears` |
| Hyprland headless, EGL/GBM, NVENC e HEVC | `AQ_DRM_DEVICES`, `monitors.lua`, journal `GBM request`, `nvidia-smi pmon`, overlay Moonlight e documentazione Sunshine |
| Secure Boot e MOK | `mokutil` sul guest, codice OVMF/Proxmox analizzato e documentazione NVIDIA/Proxmox |

~~~bash
python3 scripts/validate_documentation.py
~~~

Il validatore controlla automaticamente copertura dei termini, diagrammi, file locali e impronta della ROM. Non può dimostrare da solo che una definizione sia corretta: per questo il README collega fonti ufficiali e il walkthrough collega ogni concetto ai blocchi ASL/script che lo implementano.
