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
| **`nvidia-smi`** | Utility NVIDIA che verifica enumerazione, driver, VRAM e processi GPU. È la verifica minima dello switch. |
| **Xorg headless** | Server grafico X senza monitor fisico. Nel guest è stato creato sul display `:2` per lanciare un benchmark OpenGL in SSH. |
| **GLX / `glxgears`** | GLX collega OpenGL a X11. `glxgears` disegna tre ingranaggi e stampa FPS; il wrapper `nvidia-glxgears` forza il display NVIDIA headless. |
| **`glmark2`** | Benchmark OpenGL. Da SSH senza `DISPLAY` dà “Could not initialize canvas”; non prova un guasto della GPU. |
| **`nvtop`** | Monitor per GPU, VRAM e processi. È più adatto di `htop` al carico NVIDIA. |
| **`htop`** | Monitor CPU/RAM/processi del sistema operativo; non legge i contatori proprietari della GPU NVIDIA. |

## Secure Boot e chiavi

| Termine | Significato pratico |
| --- | --- |
| **Secure Boot** | Politica UEFI che accetta componenti di boot e moduli kernel firmati da chiavi fidate. Non è un semplice flag in `qm config`: lo stato va letto nel guest con `mokutil --sb-state` o dalla variabile EFI. |
| **MOK** | *Machine Owner Key*: certificato aggiunto dall'utente alle chiavi fidate di Secure Boot per autorizzare, per esempio, un modulo DKMS. |
| **MOK Manager** | Schermata UEFI pre-boot in cui si conferma l'enrollment MOK. Non gira dentro Linux: SSH e QGA non possono automatizzarla. |
| **`mokutil`** | Utility Linux per leggere Secure Boot, importare un certificato MOK e vedere chiavi in attesa. L'import richiede password e la conferma al riavvio. |
| **`--mok-manual`** | Modalità dello script che mantiene Secure Boot, non ricrea `efidisk0`, e se il driver non parte spiega il passaggio noVNC e i possibili certificati trovati. |
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
| Secure Boot e MOK | `mokutil` sul guest, codice OVMF/Proxmox analizzato e documentazione NVIDIA/Proxmox |

~~~bash
python3 scripts/validate_documentation.py
~~~

Il validatore controlla automaticamente copertura dei termini, diagrammi, file locali e impronta della ROM. Non può dimostrare da solo che una definizione sia corretta: per questo il README collega fonti ufficiali e il walkthrough collega ogni concetto ai blocchi ASL/script che lo implementano.
