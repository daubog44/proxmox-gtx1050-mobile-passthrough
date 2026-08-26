# Matrice tecnica: perché funziona qui e quali rischi laptop sono reali

Questo documento valuta le sei affermazioni ricevute sul passthrough laptop. Ogni risposta e classificata come **provata qui**, **rischio generale** oppure **non provata/non applicabile**.

## Risposta breve: perché questa GTX 1050 funziona nella VM

La soluzione funziona perche IOMMU e vfio-pci consegnano la GPU fisica a QEMU, hostpci la rende visibile alla VM, QEMU fw_cfg consegna la VBIOS OEM e una SSDT AML definisce il metodo ACPI _ROM che il driver NVIDIA Mobile cerca.

Il percorso PCI della GPU viene scoperto nella VM attraverso QEMU Guest Agent. La SSDT e quindi generata per il percorso ACPI reale, non fissata a mano. Il driver riceve i byte VBIOS con _ROM(offset, length), nvidia-smi si inizializza e il rendering headless su Xorg NVIDIA :2 viene provato da nvidia-glxgears e nvtop.

~~~text
GPU fisica -> IOMMU + vfio-pci -> hostpci/QEMU -> GPU PCI nella VM
VBIOS OEM  -> QEMU fw_cfg       -> SSDT AML    -> _ROM() -> driver NVIDIA
                                                              |
                                                              v
                                                nvidia-smi + rendering headless
~~~

## Come leggere i verdetti

| Etichetta | Significato |
| --- | --- |
| **Provato qui** | Osservato sul nodo/guest o durante Ubuntu 1001 -> Kali 1000 -> Ubuntu 1001. |
| **Rischio generale** | Possibile e documentato per una parte dei laptop, ma non misurato direttamente su questo HP in questa revisione. |
| **Non provato / non applicabile** | Non c'e evidenza per attribuirlo al risultato, oppure riguarda una VM Windows che non esiste in questo test. |

## 1. NVIDIA Optimus MUXless

**Verdetto: nucleo corretto; “nessuna uscita video diretta” e troppo assoluto.**

In un laptop Optimus muxless la iGPU guida normalmente il pannello interno e la NVIDIA puo essere usata come GPU di rendering. NVIDIA documenta che, senza un mux che colleghi il pannello alla NVIDIA, la dGPU resta utile per rendering offscreen, PRIME render offload e CUDA.

Questo e coerente con il laboratorio: la prova grafica usa Xorg NVIDIA headless sul display :2 e misura nvidia-glxgears con nvtop. Non abbiamo mappato fisicamente tutte le HDMI/DisplayPort del Pavilion: non dichiariamo quindi che nessuna porta sia cablata alla NVIDIA.

La mancanza di pannello non e la causa provata del fallimento iniziale. Il driver ha iniziato a funzionare dopo fw_cfg piu SSDT _ROM; il percorso headless risolve come usare l'output dopo l'inizializzazione.

**Provato qui:** nvidia-glxgears ha prodotto circa 24-25 mila FPS e nvtop ha mostrato il processo al 99% GPU.

## 2. VBIOS, ROM PCI e presunto header da rimuovere

**Verdetto: la VBIOS OEM e decisiva; tagliare header non e una ricetta universale e non e stato fatto qui.**

Il file usato per questo HP proviene dal payload firmware/driver OEM HP. La verifica locale del file incluso mostra:

~~~text
signature: 55 aa
struttura: PCIR
PCI ID:    10de:1c8d
dimensione: 169472 byte
SHA-256:   33abd3bc3f658b0536da0617a76076b56e5af124701271211d6d127cda22c322
~~~

Lo script di estrazione cerca 55 aa e PCIR, controlla vendor/device e ricostruisce le immagini Option ROM fino all'ultima. **Non rimuove alcun header UEFI**. Tagliare byte senza analizzare la struttura puo rompere PCIR, GOP o checksum.

romfile resta nella configurazione PCI di QEMU, ma il tentativo con sola ROM BAR (rombar=1) non ha inizializzato il driver. La soluzione provata e romfile piu fw_cfg piu SSDT _ROM, con rombar=0 intenzionale.

Non dimostriamo che ogni GTX 1050 laptop non abbia una ROM PCI leggibile. Dimostriamo origine/identita della ROM HP e il fatto che il driver di questo caso richiedeva _ROM.

## 3. FLR, reset PCIe e reboot dell'host

**Verdetto: reset e FLR sono rischi da verificare; “dopo ogni VM serve reboot host” e falso per questo flusso.**

FLR significa **Function Level Reset**, cioe reset di una singola funzione PCIe. Linux puo esporre reset_method e reset in sysfs, a seconda di GPU, bridge e kernel. Leggere questi file e diagnostica; scrivere 1 in reset e un'operazione distruttiva e non e stata fatta qui.

Il test completato ha spostato la GPU **Ubuntu 1001 -> Kali 1000 -> Ubuntu 1001** nello stesso uptime del nodo. Quindi non e stato necessario riavviare Proxmox dopo ogni VM. Questo non prova che la GTX esponga FLR: QEMU/VFIO puo avere usato un altro reset e un errore grave potrebbe cambiare il comportamento.

~~~bash
# [NODO] root - sola lettura, non eseguire un reset
dev=/sys/bus/pci/devices/0000:02:00.0
test -r "$dev/reset_method" && cat "$dev/reset_method" || echo "reset_method non esposto"
test -e "$dev/reset" && echo "reset sysfs disponibile" || echo "reset sysfs non esposto"
lspci -vv -s 02:00.0
~~~

Il refresh live del valore reset_method non e stato completato in questa revisione per un problema di autenticazione remota. Non viene quindi dichiarato “FLR assente”.


## 4. Alimentazione ACPI: D3cold e _DSM

**Verdetto: rischio reale su laptop, ma non è la funzione riparata da questo workaround.**

D3cold è uno stato di risparmio energetico molto profondo: il dispositivo può perdere alimentazione e richiedere una sequenza di riaccensione. _DSM è un metodo ACPI usato dai produttori per offrire comandi proprietari a firmware e driver. Su notebook Optimus questi meccanismi possono influire sulla GPU, perché la piattaforma decide quando alimentarla o spegnerla.

L'SSDT di questo progetto non imita la gestione energetica HP, non chiama _DSM e non riaccende forzatamente la GPU. Espone una sola cosa: il metodo ACPI _ROM, cioè un modo standard con cui il driver può chiedere i byte della option ROM. Quindi sarebbe scorretto dire che l'SSDT “risolve D3cold”.

La diagnosi aggiunta al runbook legge, senza scrivere, power/control, power/runtime_status e d3cold_allowed del dispositivo PCI. Quei valori vanno raccolti sul nodo nel momento in cui si vuole indagare un problema di energia. In questo aggiornamento non sono stati rinfrescati live: il collegamento read-only richiesto per farlo non ha superato l'autenticazione. La documentazione non inventa uno stato energetico corrente.

## 5. IOMMU group e ACS override

**Verdetto: controllo indispensabile; ACS override non è usato da questo script.**

Un gruppo IOMMU è l'insieme minimo di dispositivi che l'hardware può isolare per il DMA. VFIO può assegnare in sicurezza un device alla VM solo se anche gli altri device del suo gruppo sono gestiti in modo compatibile. Per questo il runbook elenca il gruppo della GPU prima di modificare una VM.

ACS (Access Control Services) è una capacità di alcuni bridge PCIe che separa meglio il traffico. Il parametro kernel pcie_acs_override può dividere gruppi artificialmente, ma non crea una garanzia hardware nuova: va considerato un compromesso, non una procedura standard da attivare automaticamente. Non esiste alcuna logica ACS nel comando gpu-vm-switch e non è stata dichiarata necessaria per l'evidenza registrata di questa GTX 1050. Il comando diagnostico controlla anche se pcie_acs_override appare nel kernel command line.

## 6. Windows Code 43

**Verdetto: il concetto riguarda Windows; non è stato verificato da questo progetto.**

Code 43 è il codice di Gestione dispositivi di Windows che segnala un problema riportato dal driver. Non è un errore Linux e non è un test eseguito su Ubuntu o Kali. NVIDIA ha cambiato nel tempo il comportamento dei driver in VM, ma un notebook può comunque fallire per molte cause: ROM, ACPI, reset, alimentazione, topologia PCIe o configurazione Windows.

L'evidenza locale e documentata qui è Linux: nvidia-smi, nvtop, Xorg headless e glxgears. Non può essere trasformata in una promessa di assenza di Code 43 su Windows. Per una VM Windows servirebbe una prova separata con driver, log e Gestione dispositivi di quella VM.

## Alternative: cosa risolvono e cosa non risolvono

| Alternativa | A cosa serve | Cosa non sostituisce |
| --- | --- | --- |
| iGPU virtualizzata (quando la piattaforma la supporta, ad esempio GVT-g) | Accelerazione grafica della GPU integrata per workload compatibili | Non assegna la GTX 1050 fisica alla VM e non ripara il suo ACPI _ROM |
| SR-IOV della iGPU, se hardware, firmware e driver la offrono | Crea funzioni virtuali della iGPU | Non è una capacità universale delle iGPU e non è stata provata su questo HP |
| Display virtuale o headless Xorg | Fa esistere un display/rendering nella VM senza monitor fisico | Non accende la GPU né corregge una ROM assente |
| Looking Glass | Mostra a bassa latenza l'output di una VM già funzionante | Non sostituisce VFIO, VBIOS o SSDT |
| Sunshine e Moonlight | Streaming remoto dopo che grafica e rete della VM funzionano | Non risolve l'inizializzazione del driver NVIDIA |

Nel test registrato è stato scelto il percorso headless: Xorg su display :2 e nvidia-glxgears hanno prodotto frame, mentre nvtop ha mostrato attività della GPU. Questo dimostra rendering nella VM, non il cablaggio fisico del pannello del portatile né un output HDMI nativo.

## Cosa non si deve concludere

1. Non ogni GTX 1050 Mobile ha la stessa VBIOS, topologia ACPI o comportamento di reset dell'HP Pavilion 15-cs1xxx.
2. Non basta copiare l'SSDT: il dispositivo PCI scoperto, il BDF guest e la ROM OEM devono corrispondere alla macchina destinataria.
3. Non è stata dimostrata l'assenza di FLR, né che D3cold sia risolto, né che Windows eviti Code 43.
4. Il risultato positivo Ubuntu -> Kali -> Ubuntu dimostra che su questa macchina non è servito riavviare Proxmox in quella sequenza; non è una garanzia per ogni ciclo o per ogni notebook.
5. Il progetto è una procedura riproducibile e idempotente per questo caso d'uso, non un installer universale per tutte le GPU mobile/Optimus.

## Fonti tecniche consultabili

- NVIDIA descrive le piattaforme Optimus e i loro requisiti software: https://download.nvidia.com/XFree86/Linux-x86_64/455.28/README/optimus.html
- NVIDIA documenta PRIME Render Offload, cioè la separazione fra GPU che rende e GPU che presenta: https://download.nvidia.com/XFree86/Linux-x86_64/575.64/README/primerenderoffload.html
- NVIDIA documenta un caso di laptop Optimus in cui il driver non individua la VBIOS attraverso ACPI: https://download.nvidia.com/XFree86/Linux-x86/346.59/README/commonproblems.html
- Il kernel Linux documenta il modello di isolamento di VFIO: https://docs.kernel.org/driver-api/vfio.html
- Il kernel documenta gli attributi reset e reset_method del dispositivo PCI: https://docs.kernel.org/6.10/admin-guide/abi-testing.html
- Il kernel documenta GVT-g per la grafica integrata Intel: https://docs.kernel.org/next/gpu/i915.html
- Sunshine e Moonlight documentano lo streaming remoto, separato dal passthrough: https://docs.lizardbyte.dev/projects/sunshine/latest/ e https://moonlight-stream.org/
