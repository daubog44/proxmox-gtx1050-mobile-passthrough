# GTX 1050 Mobile Optimus passthrough su Proxmox

Repository didattico e operativo per assegnare la GPU NVIDIA discreta di un portatile HP a una VM Linux Proxmox. Il caso recuperato qui non è un normale passthrough desktop: è una GPU **NVIDIA Optimus/mobile** a cui il driver richiede la VBIOS attraverso ACPI.

> Stato onesto: Ubuntu ha usato la GTX 1050 con driver `580.173.02`, `nvidia-smi` e `glxgears` sulla GPU reale. Il passaggio (con lo script per assegnare la gpu) Ubuntu -> Kali -> Ubuntu è stato verificato. Il ramo che sostituisce l'EFI disk per disabilitare Secure Boot è stato controllato nel codice e con il prompt reale, ma **non è stato eseguito sulla VM Ubuntu principale**: prima prova con snapshot e noVNC aperto.

![Prova finale: nvtop mostra glxgears al 99% della GTX 1050 e Xorg NVIDIA sul display :2](evidence/nvtop-glxgears-proof.png)

## Prima dei comandi: dove sei e cosa stai guardando

Questa guida usa sempre tre contesti. Leggerli evita l'errore piu comune: lanciare un comando della VM sul nodo Proxmox, o viceversa.

| Etichetta | Che cos'e | Esempi di comandi che vanno eseguiti qui |
| --- | --- | --- |
| **[NODO]** | Il computer fisico che esegue Proxmox. In questo progetto e il laptop HP. Ha la GPU fisica e i comandi `qm`, `lspci` e `gpu-vm-switch`. | `lspci -nnk -s 0000:02:00.0`, `qm config 1001` |
| **[VM]** | Il computer virtuale dentro Proxmox. Qui sono Ubuntu `1001` e Kali `1000`. Il driver NVIDIA viene installato qui, non sul nodo. | `nvidia-smi`, `mokutil --sb-state` |
| **[PC DI AMMINISTRAZIONE]** | Il PC dal quale apri SSH/noVNC e modifichi il repository. Non e parte del passthrough. | `git status`, lettura del PDF |

Un blocco che inizia con `# [NODO]` va eseguito come `root` sul server Proxmox. Uno che inizia con `# [VM]` va eseguito dentro la VM indicata, tramite console noVNC o SSH alla VM. `noVNC` e la console grafica nel pannello Proxmox: serve quando devi vedere schermate prima dell'avvio di Linux, come MOK Manager.

## Dizionario essenziale: nessun gergo sottinteso

| Termine | Significato semplice | Perche compare qui |
| --- | --- | --- |
| **Host / nodo Proxmox** | Il computer fisico che ospita le VM. | E l'unico che possiede davvero la GTX 1050. |
| **Guest / VM** | Un computer virtuale in esecuzione nel nodo. | Ubuntu e Kali sono guest; una sola alla volta puo ricevere la GPU. |
| **VMID** | Il numero che identifica una VM per Proxmox. | `1001` identifica Ubuntu; `1000` identifica Kali. |
| **GPU** | Processore grafico, qui la NVIDIA GTX 1050 Mobile. | E il dispositivo da assegnare alla VM. |
| **PCIe** | Il bus hardware attraverso cui il nodo vede la GPU. | Il passthrough comincia assegnando questo dispositivo fisico alla VM. |
| **BDF** | Indirizzo PCI nel formato `dominio:bus:dispositivo.funzione`. | `0000:02:00.0` significa dominio `0000`, bus `02`, dispositivo `00`, funzione grafica `0`. |
| **PCI ID** | Codice `vendor:device` del modello PCI. | `10de:1c8d` significa NVIDIA (`10de`) GTX 1050 Mobile (`1c8d`). |
| **IOMMU** | Funzione CPU/chipset che isola il DMA e rende possibile assegnare un dispositivo PCI a una VM. Intel la chiama VT-d, AMD AMD-Vi. | Senza IOMMU non esiste passthrough PCI sicuro. |
| **VFIO / `vfio-pci`** | Driver Linux che prende possesso della GPU per consegnarla a QEMU, invece di usarla nel nodo. | `lspci -nnk` deve mostrare `Kernel driver in use: vfio-pci`. |
| **QEMU / Q35** | QEMU esegue la VM; Q35 e il chipset PCIe virtuale moderno che QEMU emula. | Lo script richiede Q35 per ottenere una topologia PCI guest gestibile. |
| **OVMF / SeaBIOS** | Firmware della VM: OVMF equivale a UEFI, SeaBIOS al BIOS tradizionale. | Ubuntu usa OVMF; Kali SeaBIOS. Il test ha coperto entrambi. |
| **QEMU Guest Agent (QGA)** | Piccolo servizio nella VM che permette al nodo di eseguire controlli al suo interno. | Lo script scopre la distro, il percorso PCI guest e il driver senza indovinare. |
| **VBIOS / file `.rom`** | Firmware interno della GPU. Qui il file `.rom` e una copia della VBIOS OEM HP. | Il driver NVIDIA Mobile chiede questi byte per inizializzarsi. |
| **ACPI** | Tabelle/metodi con cui firmware e sistema operativo descrivono dispositivi hardware. | Sui laptop Optimus il driver usa ACPI per chiedere la VBIOS. |
| **DSDT / SSDT** | DSDT: tabella ACPI principale. SSDT: tabella aggiuntiva. | Lo script aggiunge una SSDT; non modifica la DSDT originale. |
| **ASL / AML** | ASL e il testo leggibile della SSDT; AML e il bytecode compilato che QEMU carica. | `iasl` trasforma ASL in AML; il self-test controlla questa compilazione. |
| **`fw_cfg`** | Canale QEMU che consegna un file binario al guest. | Trasporta la VBIOS OEM dal nodo alla SSDT. Da solo non basta. |
| **`_ROM(offset, length)`** | Metodo ACPI: il driver chiede una fetta di firmware indicando inizio e lunghezza. | La SSDT restituisce al driver i byte VBIOS ricevuti da `fw_cfg`. |
| **Secure Boot / MOK / DKMS** | Secure Boot accetta moduli firmati; DKMS li compila; MOK e la chiave che l'utente autorizza prima del boot. | Spiega perche un driver installato puo non caricarsi. |
| **`nvidia-smi` / `nvtop` / `nvidia-glxgears`** | Strumenti NVIDIA: stato driver/VRAM, uso GPU e ingranaggi OpenGL con FPS. | Insieme distinguono “driver visto” da “rendering sulla GPU”. |

Il [glossario esteso](docs/glossary.md) approfondisce ogni voce; questa tabella e qui per rendere comprensibile il README senza dover conoscere gia il gergo.

### I comandi e le opzioni usati nei test

| Comando/opzione | Cosa fa, senza abbreviazioni |
| --- | --- |
| `cat /proc/cmdline` | Stampa i parametri con cui Linux e stato avviato. Qui cerca le opzioni che attivano IOMMU. Non modifica niente. |
| `test -d percorso` | Controlla se un percorso esiste ed e una directory. Qui verifica l'esistenza dei gruppi IOMMU. Non modifica niente. |
| `lspci -nnk -s BDF` | Elenca il dispositivo PCI all'indirizzo BDF, il PCI ID numerico e il driver Linux che lo sta usando. Non modifica niente. |
| `qm` | Comando amministrativo di Proxmox per leggere o gestire VM: `qm config` legge la configurazione, `qm status` legge lo stato, `qm guest exec` esegue un comando attraverso il Guest Agent. |
| `iasl` | Compilatore/disassemblatore ACPI. Trasforma ASL in AML e puo rileggere AML per controllarlo. |
| `sha256sum` | Calcola un'impronta lunga del file. Due file con hash SHA-256 uguale sono, in pratica, lo stesso contenuto byte per byte. |
| `--dry-run` | Modalita di simulazione dello script: mostra proprietario/azioni previste senza scrivere file, fermare VM o riavviare. |
| `--yes` | Salta la domanda di conferma. Non disabilita Secure Boot da solo: per quello serve anche `--disable-secure-boot`. |
| `--self-test` | Genera una SSDT fittizia, la compila con `iasl` e la disassembla. E un test del generatore ACPI, non del driver NVIDIA. |

## Cosa e stato testato davvero: comando, macchina, risultato e limite

La tabella non mescola prova reale, controllo del codice e funzionalita non ancora provata. Un successo dimostra solo cio che il comando osserva.

| Test | Dove e con che cosa | Comando o evidenza | Risultato osservato | Cosa dimostra / non dimostra |
| --- | --- | --- | --- | --- |
| IOMMU attivo | [NODO], kernel Proxmox | `cat /proc/cmdline` e `test -d /sys/kernel/iommu_groups` | Flag IOMMU attivi e gruppi presenti. | Il nodo puo isolare PCI; non prova che ogni gruppo sia sicuro. |
| GPU presa da VFIO | [NODO], `lspci` | `lspci -nnk -s 02:00.0` | `Kernel driver in use: vfio-pci`. | La GPU non e usata dal driver grafico del nodo e puo essere data a QEMU. |
| SSDT generabile | [NODO], `iasl` | `gpu-vm-switch --self-test` | `self-test: ok`. | L'ASL di prova compila/disassembla in AML; non prova ancora il driver guest. |
| Preparazione idempotente | [NODO], script in simulazione | `gpu-vm-switch --prepare-host --rom-source /usr/share/kvm/gtx1050_hp_native.rom --dry-run --yes` | Nessuna scrittura e nessun reboot. | Il preflight e ripetibile senza toccare il nodo. |
| Ubuntu -> Kali -> Ubuntu | [NODO], `gpu-vm-switch` | `gpu-vm-switch --vm 1000 --yes`, poi `gpu-vm-switch --vm 1001 --yes` | Cleanup, discovery PCI/ACPI e SSDT riusciti in entrambe le direzioni. | Il trasferimento OVMF/Q35 <-> SeaBIOS/Q35 e reale; non certifica altri laptop. |
| Driver su Ubuntu | [VM Ubuntu], `nvidia-smi` | `nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader` | `NVIDIA GeForce GTX 1050, 580.173.02, 4096 MiB`. | Driver e VRAM sono visibili; non e un benchmark. |
| Rendering OpenGL | [VM Ubuntu], Xorg NVIDIA headless `:2` e `nvidia-glxgears` | `nvidia-glxgears` e screenshot [nvtop](evidence/nvtop-glxgears-proof.png) | Circa 24-25 mila FPS; `nvtop` mostra `nvidia-glxgears` al 99% GPU. | Il rendering e sulla GTX 1050; non equivale a un benchmark di gioco. |
| Idempotenza switch | [NODO], script | `gpu-vm-switch --vm 1001 --mok-manual --yes` con Ubuntu gia pronta | Messaggio idempotente, nessuna riscrittura o riavvio. | Ripetere il comando non riconfigura una GPU gia collegata. |
| Disabilitazione Secure Boot | Non eseguita su Ubuntu principale | Revisione del codice e del prompt soltanto. | **Nessuna prova runtime dichiarata.** | Richiede snapshot e noVNC; non e dichiarata risolta/testata. |

## Prova dello switch: Ubuntu -> Kali -> Ubuntu

Questo non è solo un progetto teorico. Lo switch reale è stato eseguito tra le due VM presenti sul nodo:

| Passo | VM sorgente | VM destinazione | Esito |
| --- | --- | --- | --- |
| 1 | Ubuntu `1001` | Kali `1000` | GPU scollegata, SSDT dinamica rigenerata per Kali e avvio completato. |
| 2 | Kali `1000` | Ubuntu `1001` | GPU restituita a Ubuntu, SSDT rigenerata e driver NVIDIA operativo. |
| Verifica finale | Ubuntu `1001` | - | `NVIDIA GeForce GTX 1050`, driver `580.173.02`, 4096 MiB e rendering `glxgears` reale. |

Questa prova valida il trasferimento tra firmware guest diversi (Kali SeaBIOS/Q35, Ubuntu OVMF/Q35) e il cleanup della configurazione generata. Non prova automaticamente ogni possibile portatile, GPU o installatore driver di ogni distribuzione: il workaround rimane specifico alle NVIDIA mobile/Optimus che chiedono `_ROM`.

## Macchina verificata e perimetro

| Voce | Valore osservato |
| --- | --- |
| Portatile | HP Pavilion Laptop **15-cs1xxx** |
| Scheda madre | HP `856A` |
| GPU | NVIDIA GP107M GeForce GTX 1050 Mobile (Pascal) |
| PCI host | BDF `0000:02:00.0`, ID `10de:1c8d`, driver host `vfio-pci` |
| VBIOS OEM | `86.07.5F.00.2C`, 169472 byte, SHA-256 `33abd3bc3f658b0536da0617a76076b56e5af124701271211d6d127cda22c322` |
| Host | Proxmox VE 9.1.5, kernel `6.17.9-1-pve` |
| Guest validati | Ubuntu OVMF/Q35 e Kali SeaBIOS/Q35 |

La GTX 1050 laptop usa la microarchitettura **Pascal** e ha 640 CUDA core; in questa VM sono stati visti 4 GiB di VRAM. Il dettaglio decisivo non è il numero dei core ma l'architettura **Optimus muxless**: il pannello interno resta collegato alla iGPU Intel, mentre la NVIDIA è un acceleratore PCIe render-only. Perciò può elaborare CUDA/OpenGL/Vulkan senza possedere un display fisico o un CRTC DRM assegnabile.

Questa procedura è progettata soprattutto per NVIDIA mobile/Optimus con richiesta ACPI `_ROM`. Può essere adattata ad altre GPU mobile, ma non è perfetta né universale: occorrono topologia compatibile, IOMMU, BDF, VBIOS OEM della stessa macchina e test reale. Se un altro portatile dà errori, va analizzato e il generatore SSDT potrebbe dover essere modificato; non usare una ROM casuale desktop o di un altro produttore.

## Prima di iniziare: cosa serve davvero

Salvo indicazione contraria, i blocchi delle sezioni 1-4 qui sotto sono comandi [NODO]: eseguili come root nel terminale del nodo Proxmox, non dentro Ubuntu o Kali.

### 1. Firmware del portatile: operazione manuale

Nel BIOS/UEFI del portatile devono essere abilitati virtualizzazione CPU e IOMMU: su Intel di solito **Intel VT-d**, su AMD **AMD-Vi/IOMMU**. Uno script Linux non può cambiare il BIOS del portatile in modo affidabile: questo è l'unico prerequisito host che va verificato manualmente. Dopo il boot Proxmox deve esistere `/sys/kernel/iommu_groups`.

### 2. Preparazione idempotente del nodo Proxmox

Dal clone di questo repository, sul nodo Proxmox:

```bash
# [NODO] come root
install -m 0750 scripts/gpu-vm-switch /usr/local/sbin/gpu-vm-switch

# Installa solo acpica-tools/pciutils mancanti, copia la ROM se differente,
# aggiunge IOMMU e vfio-pci solo se necessari, aggiorna initramfs e segnala il reboot.
gpu-vm-switch --prepare-host \
  --rom-source ./firmware/gtx1050_hp_native.rom --yes

# Solo se il comando segnala un riavvio richiesto; questo riavvia davvero il nodo.
gpu-vm-switch --prepare-host \
  --rom-source ./firmware/gtx1050_hp_native.rom --reboot --yes
```

`--prepare-host` rileva Intel/AMD, aggiorna `/etc/kernel/cmdline` con `intel_iommu=on` o `amd_iommu=on` più `iommu=pt` quando il nodo usa `proxmox-boot-tool`; altrimenti aggiorna la riga GRUB. Crea o aggiorna soltanto il proprio file `/etc/modprobe.d/gpu-vm-switch-vfio.conf`, conservando gli ID già gestiti, aggiunge i tre moduli VFIO a `/etc/modules` solo se assenti e rigenera l'initramfs solo se occorre. Non scollega a caldo la GPU e non riavvia senza `--reboot`.

Il comando è **idempotente**: una seconda esecuzione non riscrive la ROM identica, non duplica flag, moduli o ID PCI e non aggiorna l'initramfs se non è cambiato nulla. Il binding `vfio-pci.ids=10de:1c8d` opera per ID PCI: su una macchina con più GPU identiche va verificato con attenzione.

La sequenza completa, con comandi di inventario, `--dry-run`, applicazione, reboot, verifica nodo/guest, MOK e rendering, è nel [runbook riproducibile](docs/reproducible-runbook.md). Seguilo nell'ordine: evita di modificare manualmente `hostpci` o `args` tra preflight e switch.

Controlli dopo il reboot:

```bash
# [NODO] come root, dopo esserti ricollegato al nodo
cat /proc/cmdline                 # deve contenere intel_iommu=on oppure amd_iommu=on e iommu=pt
test -d /sys/kernel/iommu_groups && echo IOMMU-ok
lspci -nnk -s 02:00.0            # deve indicare Kernel driver in use: vfio-pci
gpu-vm-switch --self-test        # compila e disassembla una SSDT di test
```

### 3. ROM/VBIOS OEM

La ROM impiegata in questo caso è inclusa come [`firmware/gtx1050_hp_native.rom`](firmware/gtx1050_hp_native.rom): è il blob estratto dal payload originale HP per questo Pavilion e coincide byte per byte con quello provato sul nodo. Va trattata come firmware OEM, non come una ROM generica riutilizzabile.

Il comando `--prepare-host --rom-source ...` la installa, senza sovrascrivere se l'hash è già identico, in `/usr/share/kvm/gtx1050_hp_native.rom`. Se la ROM va estratta di nuovo dal pacchetto HP, usa:

```bash
# [NODO] come root; /tmp/084C0.bin e il payload gia estratto dal pacchetto HP
python3 scripts/extract_gtx1050_rom.py /tmp/084C0.bin \
  --device-id 1c8d \
  --output /usr/share/kvm/gtx1050_hp_native.rom
```

Lo script Python non scarica né inventa firmware: cerca `55 aa`, l'header `PCIR`, vendor NVIDIA e device `1c8d` nel payload RAW e negli stream LZMA, poi ricostruisce le immagini Legacy/GOP fino al flag finale. Il payload di partenza era stato estratto localmente dal pacchetto driver/firmware ufficiale HP relativo al portatile.

### 4. VM e guest

La VM di destinazione deve usare **Q35** e il **QEMU Guest Agent**. Può mantenere il proprio firmware: Ubuntu qui usa OVMF, Kali SeaBIOS; lo script non cambia `bios`, `machine`, `vga`, memoria o dischi. Lo switch gestisce driver per Ubuntu, Debian, Kali, Arch, Fedora, RHEL, Rocky e AlmaLinux. Per altre distribuzioni si usa `--skip-drivers` e si installa il driver secondo la documentazione della distro.

## Uso quotidiano dello switch

```bash
# [NODO] come root. Non lanciare questi comandi dentro la VM.
# Menu numerato delle VM e domanda Secure Boot quando utile.
gpu-vm-switch

# Sposta la GPU alla VM 1001. Se la GPU è già pronta, non cambia nulla.
gpu-vm-switch --vm 1001 --yes

# Simula proprietario attuale e destinazione: nessuna modifica.
gpu-vm-switch --vm 1001 --dry-run --yes

# Altra NVIDIA mobile: BDF senza .funzione e VBIOS OEM corrispondente.
gpu-vm-switch --gpu 0000:03:00 --rom /usr/share/kvm/altra-oem.rom --vm 123 --yes

# Driver già preparato manualmente.
gpu-vm-switch --vm 123 --skip-drivers --yes
```

Il flusso è:

1. Cerca in tutte le VM chi ha `hostpci` per quella GPU.
2. Arresta con `qm shutdown` le sole VM coinvolte.
3. Rimuove dalla sorgente soltanto `hostpci`, `romfile`, `rombar`, `-acpitable`, `-fw_cfg` e `cpu=host,hidden=1` generati da questo strumento; riaccende la sorgente, se era accesa, senza GPU.
4. Collega la GPU alla destinazione con `rombar=0`, avvia una volta, scopre il percorso PCI/ACPI e genera la SSDT `.aml` specifica.
5. Riavvia la destinazione con SSDT e VBIOS, installa/verifica il driver e riattiva il benchmark opzionale.

È idempotente in due sensi: una GPU già pronta (`hostpci` + SSDT + `fw_cfg` + `nvidia-smi`) non provoca né scritture né riavvii; se la configurazione esiste ma il driver è bloccato da MOK, lascia la configurazione invariata e verifica solo driver/MOK, senza ripetere un trasferimento distruttivo.

Il comando completo è disponibile con `gpu-vm-switch --help`.

## Perché il solo passthrough PCI non basta in Optimus

Con una scheda desktop, `hostpci` e talvolta `romfile=...` esponendo la finestra ROM PCI possono bastare. Qui no. Su un portatile Optimus il driver NVIDIA può chiedere la VBIOS al firmware della scheda madre tramite il metodo ACPI standard **`_ROM(offset, length)`** associato al device ACPI della GPU. Questo riflette la progettazione laptop: alimentazione, muxless graphics e firmware sono coordinati dalla piattaforma ACPI, non solo dal bus PCIe.

`rombar=1` rende una ROM nella configurazione PCI virtuale, ma non crea quel metodo ACPI. Per questo i tentativi con sole ROM/`romfile`/`rombar` non hanno inizializzato il driver. Il workaround consegna **lo stesso blob VBIOS OEM** a QEMU tramite `fw_cfg`, poi aggiunge una SSDT compilata che implementa `_ROM` sul device GPU corretto:

```text
file .rom OEM -> QEMU fw_cfg -> SSDT AML -> _ROM(offset, length) -> driver NVIDIA
```

Lo stesso flusso, senza abbreviazioni:

```text
file gtx1050_hp_native.rom sul nodo Proxmox
        |
        v
QEMU fw_cfg: espone il blob al guest a ogni avvio
        |
        v
SSDT AML: legge il blob e lo conserva nel buffer FWBI
        |
        v
metodo ACPI _ROM(offset, length): restituisce i byte richiesti
        |
        v
driver NVIDIA nella VM: inizializza la GTX 1050 Mobile
```

`fw_cfg` è solo un canale QEMU per byte; non capisce NVIDIA. La SSDT legge il blob una volta, lo tiene in un buffer AML e restituisce al driver la fetta richiesta. Quindi VBIOS e file `.rom` qui sono lo stesso firmware, mentre `rombar` è un'altra cosa: la finestra ROM PCI emulata.

Il BDF host non è un nome misterioso: è l'indirizzo della funzione grafica fisica.

```text
0000:02:00.0
│    │  │  └─ funzione 0: GPU grafica
│    │  └──── dispositivo PCI 00
│    └────── bus PCI 02
└─────────── dominio PCI 0000
```

Il BDF host dice **dove si trova il dispositivo fisico**. Il percorso ACPI guest dice invece **dove la DSDT virtuale lo descrive**. Sono due coordinate diverse; confonderle è il motivo per cui fissare a mano uno scope ACPI può fallire.

### Mini lezione ACPI, SSDT, ASL e AML

ACPI è il linguaggio con cui firmware e sistema operativo descrivono hardware e metodi. La **DSDT** è la tabella principale del firmware; una **SSDT** è una tabella aggiuntiva che aggiunge o estende oggetti. Non si modifica la DSDT originale: QEMU carica una SSDT extra con `-acpitable`.

- **ASL** (`.asl`) è il sorgente leggibile, simile a un piccolo linguaggio ad albero.
- **AML** (`.aml`) è il bytecode compilato da `iasl`, quello che firmware/OS eseguono.
- `External (\_SB.PCI0..., DeviceObj)` dichiara che il device esiste già nella DSDT.
- `Scope (...)` apre quel device; `Method (_ROM, 2)` definisce la funzione che il driver cerca con due argomenti, offset e lunghezza.
- `OperationRegion`, `Field`, `RWRD`, `RDWD`, `RBUF` sono il piccolo lettore AML del catalogo QEMU `fw_cfg`; `RINT` trova il blob `opt/com.lion328/nvidia-rom` e lo mette in `FWBI`.
- `Mid(FWBI, Arg0, Local0)` restituisce i byte da `Arg0` per `Local0` byte: questa è la risposta `_ROM`.

La difficoltà è lo **scope**. L'indirizzo PCI host `0000:02:00.0` non diventa automaticamente un percorso ACPI del guest. Nel guest `lspci -PP` può mostrare `00:1c.0/01:00.0`; ogni hop diventa `Sxx` con `slot * 8 + funzione`: `1c.0 -> 0xe0 -> SE0`, `00.0 -> S00`, quindi `\_SB.PCI0.SE0.S00`. Lo script fa discovery in una prima accensione e compila la SSDT per la topologia reale della VM, invece di fissare un valore a mano. Dettaglio completo: [architettura](docs/architecture.md) e [glossario](docs/glossary.md).

Per una spiegazione riga per riga delle opzioni Proxmox, dei blocchi ASL e dei passaggi dello script, leggi anche [walkthrough ACPI](docs/acpi-line-by-line.md). Il glossario è controllato da [`scripts/validate_documentation.py`](scripts/validate_documentation.py): verifica presenza dei termini obbligatori, diagrammi, riferimenti e hash della ROM; non sostituisce però la lettura tecnica delle fonti.

## Riproducibilita: cosa prova ogni comando

Non basta lanciare lo switch e leggere un messaggio di successo. La procedura riproducibile usa questa catena, ciascuna con un risultato verificabile:

1. `sha256sum` della ROM e `lspci` confermano che firmware e dispositivo sono quelli attesi.
2. `--prepare-host --dry-run` anticipa le modifiche; `--prepare-host` le applica in modo idempotente.
3. Dopo il reboot, `/proc/cmdline`, `iommu_groups`, `vfio-pci` e `--self-test` provano i prerequisiti host.
4. `--vm VMID --dry-run` elenca il proprietario; il comando senza `--dry-run` fa il trasferimento e cleanup.
5. `qm config`, la SSDT `.aml`, QEMU Guest Agent e `nvidia-smi` provano rispettivamente configurazione, interfaccia ACPI e driver.
6. `nvidia-glxgears` con `nvtop` prova il rendering sulla GPU, non soltanto la sua enumerazione.

I comandi esatti, output attesi, varianti per un'altra GPU e condizioni in cui fermarsi sono nel [runbook](docs/reproducible-runbook.md). Il runbook distingue esplicitamente verifiche statiche/documentali da prova reale sul nodo/guest.

## Secure Boot e MOK: due percorsi, nessuna promessa falsa

**MOK** significa *Machine Owner Key*. Il driver NVIDIA non “causa MOK” da solo: il caso tipico è `nvidia-dkms`, che compila il modulo kernel localmente. Con Secure Boot attivo il kernel carica solo moduli firmati da chiavi fidate. DKMS può firmare il modulo con una chiave propria, ma il suo certificato deve essere approvato dal firmware tramite MOK Manager, una schermata pre-boot.

`mokutil` può programmare l'import, ma SSH e QEMU Guest Agent non possono premere la schermata pre-boot. Lo script offre quindi due scelte esplicite:

```bash
# [NODO] come root: conserva Secure Boot e stampa istruzioni se serve MOK.
# A. Conserva Secure Boot. Il tool non tenta di automatizzare ciò che è pre-boot:
# se necessario indica i certificati trovati e i passaggi da completare in noVNC.
gpu-vm-switch --vm 1001 --mok-manual

# B. Solo OVMF + efidisk0 4m: disabilita Secure Boot in modo permanente,
# fa backup EFI e rollback fino al primo boot riuscito. Non è un toggle temporaneo.
gpu-vm-switch --vm 1001 --disable-secure-boot --yes
```

Per il percorso A, dopo che lo script indica che il modulo non è pronto, apri la console **noVNC** della VM: nel guest importa il certificato DKMS indicato (ad esempio `sudo mokutil --import /percorso/al/certificato.der`), scegli una password temporanea, riavvia e in MOK Manager seleziona **Enroll MOK -> Continue -> Yes**, inserendo quella password. Al boot successivo ripeti `gpu-vm-switch --vm 1001 --mok-manual`; se il driver era già firmato dalla distribuzione, MOK potrebbe non essere necessario.

Il percorso B prepara `EFI/BOOT/BOOTX64.EFI`, salva copia raw e metadata in `/usr/share/kvm/optimus-gpu-switch/efi-backups/` e sostituisce solo le variabili OVMF con un template senza chiavi pre-caricate. Il vecchio EFI disk resta `unused` e lo script tenta il rollback prima del primo boot con Guest Agent se il nuovo avvio fallisce. Riduce la protezione della catena di boot e, soprattutto, **non è stato ancora testato eseguendolo sulla Ubuntu principale**. Fare snapshot/backup e tenere noVNC aperto prima di usarlo.

## Driver, benchmark e monitoraggio

`glmark2` via SSH restituisce `Could not initialize canvas` perché una shell SSH non ha un display X11 (`DISPLAY`). In questo caso è stato creato Xorg NVIDIA headless su `:2`, quindi il test richiesto con gli ingranaggi e FPS è:

```bash
# [VM Ubuntu] nella console noVNC/SSH della VM, non sul nodo Proxmox
nvidia-glxgears
# 120907 frames in 5.0 seconds = 24181.367 FPS
# 125006 frames in 5.0 seconds = 25001.096 FPS

watch -n 1 nvidia-smi
nvtop
```

`htop` vede processi, CPU e RAM del sistema operativo, non i contatori proprietari NVIDIA; per GPU, VRAM e processi usare `nvidia-smi` o `nvtop`. `glmark2-es2-drm` non è un buon test in questa topologia muxless: può finire sul DRM virtuale/QXL e `llvmpipe`, non sulla NVIDIA.

## Contenuto e studio

```text
firmware/gtx1050_hp_native.rom    VBIOS OEM verificata per questo HP
scripts/gpu-vm-switch             setup host + switch idempotente + Secure Boot/MOK
scripts/extract_gtx1050_rom.py    estrazione VBIOS dal payload HP
docs/architecture.md              lezione tecnica del workaround ACPI
docs/acpi-line-by-line.md         spiegazione guidata riga per riga
docs/reproducible-runbook.md      procedura completa e verificabile, senza passaggi impliciti
docs/glossary.md                  glossario esteso di tutti i termini
docs/attempts-and-outcomes.md     tentativi falliti, causa e correzione
evidence/                         prova nvtop + glxgears
output/pdf/                       relazione tecnica con fonti e diagrammi
```

Risorse consigliate, dall'ordine più pratico al più profondo:

1. [Guida amministrativa Proxmox VE](https://pve.proxmox.com/pve-docs/pve-admin-guide.html) e documentazione PCI passthrough/VFIO di Proxmox.
2. [Documentazione Linux kernel VFIO](https://docs.kernel.org/driver-api/vfio.html) per IOMMU, gruppi e DMA.
3. [Specifiche QEMU fw_cfg](https://qemu-project.gitlab.io/qemu/specs/fw_cfg.html) per il canale usato qui.
4. [Specifiche ACPI UEFI](https://uefi.org/acpi/specs) e [ACPICA/iasl](https://acpica.org/) per leggere e compilare ASL/AML.
5. [NVIDIA: moduli kernel driver](https://docs.nvidia.com/datacenter/tesla/driver-installation-guide/kernel-modules.html) e [GTX 10 Laptop/Pascal](https://www.nvidia.com/en-us/geforce/news/nvidia-geforce-gtx-1050-laptops/).

Il PDF [relazione-passthrough-gtx1050.pdf](output/pdf/relazione-passthrough-gtx1050.pdf) raccoglie il percorso tecnico, il glossario sintetico, i prerequisiti, le verifiche e le fonti.
