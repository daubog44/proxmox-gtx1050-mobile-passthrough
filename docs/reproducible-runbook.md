# Runbook riproducibile: verifica, applicazione e prova

Questa e la procedura operativa completa per il caso documentato: HP Pavilion 15-cs1xxx, GTX 1050 Mobile `10de:1c8d`, BDF host `0000:02:00.0` e VM Ubuntu `1001` / Kali `1000`. Non sostituisce il giudizio tecnico: su un altro laptop cambiano almeno BDF, VBIOS OEM e probabilmente il percorso PCI/ACPI della VM. Lo script scopre quest'ultimo, ma non puo rendere compatibile una VBIOS o un gruppo IOMMU sbagliato.

> Esegui i comandi del nodo come `root` sul nodo Proxmox. Prima di un cambio reale assicurati che le VM interessate non abbiano lavoro non salvato: lo script le spegne e le riaccende quando necessario. Il comando `--dry-run` e l'unico passaggio che non modifica nulla.

## 0. Entra nel clone, identifica e verifica le risorse

Sul nodo, nella copia privata del repository:

~~~bash
cd /root/proxmox-gtx1050-mobile-passthrough
git rev-parse --short HEAD
git status --short

# La ROM inclusa e valida solo per l'HP documentato.
sha256sum firmware/gtx1050_hp_native.rom
# atteso: 33abd3bc3f658b0536da0617a76076b56e5af124701271211d6d127cda22c322

# Lo script e shell: questa e una verifica statica, non modifica il nodo.
bash -n scripts/gpu-vm-switch
python3 scripts/validate_documentation.py
~~~

L'ultimo comando deve stampare `documentazione-validata: ... ROM OEM ok`. Se l'hash e differente, **non** procedere: recupera una VBIOS proveniente dal pacchetto OEM relativo al tuo portatile e confronta vendor/device ID prima di usare `--rom-source`.

## 1. Inventario non distruttivo del nodo

Questa fase distingue il dispositivo fisico da una supposizione. Non applica configurazioni.

~~~bash
# CPU, GPU e driver correnti. Adatta solo il BDF se il tuo non e 0000:02:00.0.
lscpu | grep -Ei 'vendor|virtualization'
lspci -Dnn | grep -Ei 'vga|3d|nvidia|audio'
lspci -nnk -s 0000:02:00.0

# IOMMU deve esistere prima del passthrough.
test -d /sys/kernel/iommu_groups && echo 'IOMMU groups: OK' || echo 'IOMMU groups: MANCANTI'
find /sys/kernel/iommu_groups -type l -printf '%p -> %l\n' | grep '0000:02:00' || true

# Inventario delle VM e dei loro parametri rilevanti.
qm list
qm config 1001 | grep -E '^(bios|machine|agent|hostpci[0-9]+|args|cpu):' || true
qm config 1000 | grep -E '^(bios|machine|agent|hostpci[0-9]+|args|cpu):' || true
qm agent 1001 ping
qm agent 1000 ping
~~~

Interpretazione minima:

- `lspci -nnk` deve individuare la GPU esatta; dopo la preparazione host il driver atteso sara `vfio-pci`.
- La directory `iommu_groups` deve esistere; se non esiste, abilita VT-d/AMD-Vi nel BIOS/UEFI e riavvia prima di continuare.
- `qm agent VMID ping` deve rispondere: il tool usa il QEMU Guest Agent per capire la distro, osservare il PCI guest e verificare `nvidia-smi`.
- Il gruppo IOMMU non deve contenere un dispositivo indispensabile all'host. Questo script trasferisce la funzione grafica selezionata, non rende sicuro un gruppo IOMMU non isolato.

### Diagnostica laptop aggiuntiva: reset, energia e ACS (sola lettura)

Questi comandi rispondono a dubbi comuni su FLR/reset, D3cold e ACS senza forzare un reset o cambiare configurazione. Non concludere che una funzione sia “assente” soltanto perche un file sysfs non esiste: annota output, kernel e BDF.

~~~bash
# [NODO] root - non scrive nel dispositivo
dev=/sys/bus/pci/devices/0000:02:00.0
printf 'reset_method='; test -r "$dev/reset_method" && cat "$dev/reset_method" || echo 'non esposto'
test -e "$dev/reset" && echo 'reset sysfs disponibile (non eseguito)' || echo 'reset sysfs non esposto'

for f in power/control power/runtime_status d3cold_allowed; do
  printf '%s=' "$f"
  test -r "$dev/$f" && cat "$dev/$f" || echo 'non esposto'
done

group=$(basename "$(readlink -f "$dev/iommu_group")")
echo "IOMMU group: $group"
find "/sys/kernel/iommu_groups/$group/devices" -maxdepth 1 -type l -printf '%f\n'
grep -o 'pcie_acs_override=[^ ]*' /proc/cmdline || echo 'ACS override non presente'
~~~

`reset_method` elenca i metodi di reset esposti dal kernel; non prova da solo che un reset dopo ogni errore guest funzionera. `D3cold` e un possibile stato energetico del dispositivo, non il metodo ACPI `_ROM`. ACS override non e usato dallo script: se e necessario per un altro laptop, e una scelta di isolamento da valutare separatamente, non una correzione automatica.

## 2. Preflight e preparazione del nodo

Installa il comando in una posizione stabile, poi esegui prima una simulazione. `--prepare-host` non modifica il firmware BIOS: aggiunge solo configurazione Linux IOMMU/VFIO e la copia della ROM.

~~~bash
cd /root/proxmox-gtx1050-mobile-passthrough
install -m 0750 scripts/gpu-vm-switch /usr/local/sbin/gpu-vm-switch

# Simula: nessun file, initramfs o reboot viene modificato.
gpu-vm-switch --prepare-host \
  --rom-source ./firmware/gtx1050_hp_native.rom --dry-run --yes

# Applica: installa solo tool mancanti, copia la ROM solo se diversa,
# aggiunge solo flag/moduli/ID VFIO mancanti e rigenera initramfs se necessario.
gpu-vm-switch --prepare-host \
  --rom-source ./firmware/gtx1050_hp_native.rom --yes
~~~

Se l'output segnala che serve il reboot, esegui questo comando deliberatamente. La sessione SSH verra chiusa.

~~~bash
gpu-vm-switch --prepare-host \
  --rom-source ./firmware/gtx1050_hp_native.rom --reboot --yes
~~~

## 3. Verifica dopo il reboot host

Rientra sul nodo e prova ogni condizione osservabile. Non basta che il nodo sia tornato raggiungibile.

~~~bash
cat /proc/cmdline
test -d /sys/kernel/iommu_groups && echo 'IOMMU: OK'
lspci -nnk -s 0000:02:00.0
test -s /usr/share/kvm/gtx1050_hp_native.rom && sha256sum /usr/share/kvm/gtx1050_hp_native.rom
gpu-vm-switch --self-test
~~~

Nel caso HP la command line contiene `intel_iommu=on iommu=pt`, `lspci` mostra `Kernel driver in use: vfio-pci`, l'hash e quello del punto 0 e il self-test termina con `self-test: ok`. Su AMD il flag atteso e `amd_iommu=on`.

## 4. Simula e applica lo switch di GPU

Il primo comando non modifica nulla e mostra l'eventuale proprietario attuale. Il secondo e quello che ferma la sorgente, pulisce solo le opzioni gestite dallo script, la riaccende se era attiva, configura la destinazione e la avvia.

~~~bash
# Scegli una sola VM. In questo laboratorio: 1001 Ubuntu, 1000 Kali.
gpu-vm-switch --vm 1001 --dry-run --yes

# Applica su Ubuntu, installando/verificando i driver della distro individuata.
gpu-vm-switch --vm 1001 --yes

# Per un test di trasferimento completo, poi inverti verso Kali e torna a Ubuntu.
gpu-vm-switch --vm 1000 --yes
gpu-vm-switch --vm 1001 --yes
~~~

Il test sopra e il percorso che e stato completato nel laboratorio: Ubuntu `1001` (OVMF/Q35) -> Kali `1000` (SeaBIOS/Q35) -> Ubuntu `1001`. Non eseguirlo se una VM sta facendo lavoro non salvato.

### Varianti esplicite

~~~bash
# Altra GPU mobile: BDF senza .funzione e VBIOS OEM della stessa macchina.
gpu-vm-switch --gpu 0000:03:00 --rom /usr/share/kvm/altra-oem.rom --vm 123 --dry-run --yes
gpu-vm-switch --gpu 0000:03:00 --rom /usr/share/kvm/altra-oem.rom --vm 123 --yes

# Guest con driver gia installato e gestito a mano.
gpu-vm-switch --vm 123 --skip-drivers --yes

# Ripeti sulla stessa VM: l'esito atteso e il messaggio "idempotente";
# non deve trasferire di nuovo ne riavviare la GPU gia pronta.
gpu-vm-switch --vm 1001 --yes
~~~

Non modificare a mano `hostpci`, `args`, `romfile` o `rombar` tra `--dry-run` e l'applicazione: vanificheresti la prova e potresti lasciare configurazioni eterogenee. Per spostare la GPU basta selezionare la nuova destinazione; il cleanup appartiene allo script.

### Cosa fa realmente il comando di switch

Il comando applicativo non è un semplice qm set. L'ordine reale è questo:

1. Valida l'ambiente nodo, il BDF e la ROM, blocca switch concorrenti e individua la VM scelta.
2. Controlla Q35, firmware SeaBIOS/OVMF e QEMU Guest Agent. Accende la destinazione solo se è spenta, perché il Guest Agent serve anche per osservare Secure Boot e la topologia.
3. Legge lo stato di Secure Boot nel guest. In modalità interattiva può chiedere se disabilitarlo; con --yes non lo fa mai senza --disable-secure-boot.
4. Se la GPU è già sulla sola VM scelta, gli argomenti Optimus sono completi e nvidia-smi funziona, termina come idempotente senza riavvio. Se manca soltanto il driver o MOK, lascia il passthrough intatto.
5. Per ogni altra VM proprietaria del BDF: annota se era running, la ferma, rimuove il solo hostpci della GPU, rimuove SSDT/fw_cfg e cpu hidden gestiti dal tool e cancella soltanto la SSDT generata. Firmware, Q35, dischi, rete e video virtuale restano invariati.
6. Collega la GPU alla destinazione con rombar=0 e romfile, avvia una volta senza SSDT, legge lspci -PP nel guest e calcola lo scope ACPI dinamico.
7. Compila ASL in AML, aggiunge a args l'acpitable e fw_cfg, avvia definitivamente e installa/controlla il driver.
8. Il trap finale riaccende le sorgenti che erano accese prima, senza GPU, anche se un passaggio successivo fallisce. Se era stato iniziato il cambio EFI, lo stesso trap conserva il rollback fino a quando il primo boot non ha raggiunto il Guest Agent.

Perciò “cleanup completo” qui significa completo **per il passthrough gestito dallo script**, non una cancellazione generica delle impostazioni della VM. È questo limite che rende sicuro spostare Ubuntu OVMF/Q35 e Kali SeaBIOS/Q35 senza riscrivere la loro identità.

## 5. Verifica della configurazione Proxmox e del guest

Subito dopo lo switch controlla sia il nodo sia il guest. Il primo gruppo prova l'assegnazione e la presenza dei due meccanismi QEMU; il secondo prova l'inizializzazione del driver.

~~~bash
VMID=1001

# Nodo Proxmox: hostpci, SSDT e fw_cfg devono appartenere alla VM scelta.
qm status "$VMID"
qm config "$VMID" | grep -E '^(hostpci[0-9]+|args|cpu):'
test -s "/usr/share/kvm/optimus-gpu-switch/ssdt-$VMID.aml" && echo 'SSDT AML: OK'

# QEMU Guest Agent: ritorna JSON; cerca "exitcode" : 0 e la GPU nell'out-data.
qm agent "$VMID" ping
qm guest exec "$VMID" -- \
  /usr/bin/nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader

# Se accedi alla VM con console/SSH, questi sono piu leggibili.
nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader
lspci -nnk -d 10de:
mokutil --sb-state 2>/dev/null || true
~~~

L'esito positivo nel caso documentato e `NVIDIA GeForce GTX 1050, 580.173.02, 4096 MiB`. La riga `args` di Proxmox deve contenere sia `-acpitable file=...ssdt-VMID.aml` sia `-fw_cfg name=opt/com.lion328/nvidia-rom,file=...`; `hostpci` deve includere la GPU. Questi tre elementi spiegano perche il passthrough normale non bastava: `hostpci` assegna PCI, `fw_cfg` porta i byte VBIOS, la SSDT offre `_ROM` al driver attraverso ACPI.

## 6. Secure Boot e MOK: cosa succede, quando succede e cosa fa lo script

MOK non è un driver, una password dell'utente né un messaggio specifico di NVIDIA. Secure Boot è la politica UEFI della VM; DKMS può compilare `nvidia.ko` localmente; MOK è il certificato **pubblico** che il proprietario autorizza; shim è il componente UEFI firmato dalla distribuzione che porta quella autorizzazione nella catena Linux.

Il caso che richiede MOK è quindi: driver installato -> DKMS compila il modulo -> una nuova chiave firma il modulo -> il kernel non considera ancora fidata la chiave pubblica. Se il modulo fornito dalla distribuzione è già firmato da una chiave fidata, il driver parte e MOK non viene mostrato. La password scelta durante l'import protegge solo la richiesta pendente fino al reboot; non è la password dell'account e non firma il driver.

Prima osserva lo stato dal guest:

~~~bash
mokutil --sb-state
~~~

Lo script effettua questa lettura **prima** del cleanup, dentro la VM di destinazione e dopo il Guest Agent. In modalità interattiva, se lo stato è enabled, propone il percorso Secure Boot off; se scegli no, resta attivo. Con `--yes` non cambia mai Secure Boot per implicazione. Solo dopo switch/ramo idempotente, installazione eventuale del driver, reboot e controllo `nvidia-smi`, `--mok-manual` interviene: conserva GPU/SSDT/`fw_cfg`, mostra `mokutil --list-new` e cerca certificati in `/var/lib/dkms` e `/var/lib/shim-signed`. Non esegue `mokutil --import`: quell'azione e la password temporanea restano deliberate e manuali.

~~~bash
# Sul nodo Proxmox.
gpu-vm-switch --vm 1001 --mok-manual

# Nel guest, con il percorso del certificato indicato dallo script.
sudo mokutil --import /percorso/al/certificato.der
sudo reboot
~~~

La catena temporale è:

~~~text
mokutil --import certificato.der
  -> reboot
  -> UEFI avvia shim; MOK Manager prima del kernel: Enroll MOK -> Continue -> Yes
  -> password temporanea
  -> reboot
  -> shim rende la chiave approvata disponibile; il kernel carica il modulo firmato
  -> ripeti gpu-vm-switch --mok-manual: solo verifica idempotente
~~~

Dopo il reboot, dalla console noVNC scegli `Enroll MOK -> Continue -> Yes`, inserisci la password temporanea e riavvia. Poi ripeti `gpu-vm-switch --vm 1001 --mok-manual` e i comandi di verifica del punto 5. Non esiste un modo affidabile per automatizzare quel menu: SSH, rete e QEMU Guest Agent iniziano solo dopo quella fase del firmware. MOK Manager compare soltanto quando esiste una richiesta pendente, non a ogni boot.

L'alternativa sotto disabilita Secure Boot **in modo permanente** solo su una VM OVMF con `efidisk0` di tipo `4m`. Lo script verifica questi requisiti, prepara il fallback EFI, salva backup e metadata, sostituisce solo il volume di variabili e conserva l'originale come unused. Fino al primo boot che risponde tramite Guest Agent, il trap può ripristinare il volume originale. Questa branca non è stata eseguita sulla VM Ubuntu principale: esegui prima snapshot e tieni noVNC aperto.

~~~bash
gpu-vm-switch --vm 1001 --disable-secure-boot --yes
~~~

## 7. Prova di rendering e monitoraggio

`glmark2` lanciato da SSH non ha un display X11 e quindi non e una verifica riproducibile per questa GPU Optimus render-only. Il test usato qui avvia un Xorg NVIDIA headless su `:2`; quando il servizio di benchmark esiste, lo script lo abilita.

~~~bash
# Dentro Ubuntu, o dalla sua console grafica.
nvidia-glxgears
watch -n 1 nvidia-smi
nvtop

# Controllo del servizio opzionale creato per Xorg headless, se presente.
systemctl status nvidia-benchmark-x.service --no-pager || true
~~~

Durante il rendering `nvtop` puo' mostrare un utilizzo basso o alto secondo VSync, risoluzione e compositor; `nvidia-smi` mostra la GPU e il processo. `htop` non e una misura della GPU: osserva CPU/RAM dei processi, non i contatori NVIDIA.

### 7a. Verifica del renderer Wayland e protezione APT

Su una VM Optimus, `nvidia-smi` positivo non basta: controlla il renderer dell'applicazione nel desktop Wayland gia' aperto. Il valore FPS di `glxgears` e' VSync-dipendente e non e' un benchmark.

~~~bash
# [VM Ubuntu, terminale nel desktop RDP/Wayland]
loginctl show-session "$XDG_SESSION_ID" -p Type
# atteso: Type=wayland

cat /sys/module/nvidia_drm/parameters/modeset
# atteso: Y

glxinfo -B | grep -E 'OpenGL vendor|OpenGL renderer'
# atteso: NVIDIA Corporation / NVIDIA GeForce GTX 1050/PCIe/SSE2

glxgears
# circa 60 FPS nel desktop RDP e' il VSync del display virtuale, non un difetto.

# Solo per vedere un contatore non sincronizzato, non per benchmark di gioco:
__GL_SYNC_TO_VBLANK=0 glxgears

# Protezione contro un autoremove improprio:
apt-mark showmanual | grep -E '^(nvidia-driver-580|nvidia-utils-580)$'
sudo apt-get -s autoremove | grep -Ei 'nvidia|linux-modules-nvidia' || true
~~~

Se il renderer e' `llvmpipe`, verifica file locali con `options nvidia_drm modeset=0`, imposta `1`, ricrea initramfs e riavvia. Il dettaglio, incluse le copie di rollback e il ruolo del display Xorg `:2`, e' in [wayland-nvidia-kms.md](wayland-nvidia-kms.md).

## 8. Riproduci e controlla la documentazione

Questi comandi vanno eseguiti nel clone di lavoro che contiene `reportlab` e Poppler. Ricostruiscono il PDF e ne estraggono il testo; il secondo rendering consente una verifica visiva dei margini e delle tabelle.

~~~bash
python3 scripts/validate_documentation.py
python3 scripts/build_report.py
pdftotext output/pdf/relazione-passthrough-gtx1050.pdf - | grep -F 'Ubuntu 1001 OVMF/Q35 -> Kali 1000 SeaBIOS/Q35 -> Ubuntu 1001'
mkdir -p tmp/pdfs/runbook-check
pdftoppm -png -f 1 -l 1 output/pdf/relazione-passthrough-gtx1050.pdf tmp/pdfs/runbook-check/page
~~~

Il validatore controlla copertura del glossario, diagrammi, link locali e hash della ROM; non finge di provare l'hardware. La prova hardware resta costituita dai controlli dei punti 3, 5 e 7.

## Quando fermarsi

Fermati e raccogli l'output dei comandi precedenti se accade una di queste condizioni: IOMMU assente, gruppo non isolato, BDF/PCI ID non corrispondente, hash VBIOS diverso, Guest Agent non raggiungibile, `lspci -PP` nel guest non trova `10de:1c8d`, `iasl` fallisce, oppure `nvidia-smi` non riesce dopo MOK/riavvio. Non sostituire la ROM con un file casuale e non cancellare manualmente `args`/`hostpci`: il log permette di capire se il problema e VFIO, topologia ACPI, firmware o driver.
