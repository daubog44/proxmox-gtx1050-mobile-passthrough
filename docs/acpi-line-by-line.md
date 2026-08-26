# Walkthrough ACPI e passthrough, senza passaggi impliciti

Questo documento parte dal problema, non dal comando finale. Il caso è l'HP Pavilion 15-cs1xxx con GTX 1050 Mobile `10de:1c8d`, BDF host `0000:02:00.0`.

## 1. Il problema reale: perché hostpci non è bastato

Il passthrough PCI normale esegue correttamente una parte del lavoro: VFIO sottrae la GPU al driver host e `hostpci` la collega a QEMU. Con molte GPU desktop il driver guest trova il firmware nella normale ROM PCI.

Qui il driver NVIDIA mobile/Optimus ha seguito un'altra strada: ha cercato il metodo ACPI `_ROM` sul device della GPU. La richiesta non domanda “esiste una GPU PCI?”, ma “firmware della piattaforma, dammi i byte di VBIOS dall'offset X per Y byte”. `hostpci` non crea automaticamente metodi ACPI; `rombar=1` espone una finestra ROM PCI, ma non inventa `_ROM`.

| Configurazione | Cosa offre | Cosa manca in questo laptop |
| --- | --- | --- |
| Solo `hostpci` | Dispositivo PCI reale nella VM | VBIOS accessibile nel percorso ACPI atteso |
| `hostpci` + `romfile` + `rombar=1` | Anche ROM nella finestra PCI virtuale | Il metodo ACPI `_ROM(offset,length)` |
| `hostpci` + `fw_cfg` + SSDT | Dispositivo, blob VBIOS e metodo `_ROM` | È la soluzione verificata |

Cambiare ROM non risolveva questa assenza strutturale: una ROM anche valida, esposta nel canale sbagliato, non soddisfa una richiesta ACPI.

## 2. Due indirizzi diversi: BDF host e percorso ACPI guest

La GPU fisica è:

~~~text
0000:02:00.0
│    │  │  └─ funzione 0: funzione grafica della GPU
│    │  └──── dispositivo PCI 00
│    └────── bus PCI 02
└─────────── dominio PCI 0000
~~~

- **Dominio**: segmento PCI, normalmente `0000`.
- **Bus**: ramo PCI su cui il dispositivo è enumerato.
- **Dispositivo**: posizione nel bus.
- **Funzione**: sottofunzione. Qui `.0` è grafica; una `.1` può essere audio HDMI/DP.

Il BDF è letto sul **nodo**. Dopo l'assegnazione QEMU ricrea una topologia PCI nella **VM**, quindi il nome ACPI non è deducibile a occhio. Nel recupero Ubuntu la catena guest era:

~~~text
00:1c.0/01:00.0
~~~

Q35 costruisce il nome ACPI con `slot * 8 + funzione`:

~~~text
1c.0 -> 0x1c * 8 + 0 = 0xe0 -> SE0
00.0 -> 0x00 * 8 + 0 = 0x00 -> S00

\_SB.PCI0.SE0.S00
│   │    │   └─ GPU guest
│   │    └───── bridge PCIe guest
│   └────────── root PCI virtuale
└────────────── system bus ACPI
~~~

Lo script non fissa questo valore: al primo boot temporaneo esegue `lspci -PP -n -d 10de:1c8d`, calcola ogni `Sxx` e genera la SSDT della VM scelta.

## 3. Le righe della configurazione Proxmox

~~~ini
hostpci0: 0000:02:00,pcie=1,rombar=0,romfile=gtx1050_hp_native.rom
~~~

| Parte | Significato letterale | Perché |
| --- | --- | --- |
| `hostpci0:` | Primo slot host PCI della VM | Hardware fisico, non GPU emulata |
| `0000:02:00` | BDF host senza `.0` | Seleziona la funzione grafica scelta |
| `pcie=1` | Collegamento PCI Express | Coerente con Q35 e GPU PCIe |
| `rombar=0` | Non esporre la ROM BAR PCI | Non dipende dalla strada che qui falliva |
| `romfile=...` | Mantiene la ROM OEM sul nodo | Il percorso affidabile verso il driver è comunque `fw_cfg` + `_ROM` |

Le `args` QEMU create sono:

~~~text
-acpitable file=/usr/share/kvm/optimus-gpu-switch/ssdt-1001.aml
-fw_cfg name=opt/com.lion328/nvidia-rom,file=/usr/share/kvm/gtx1050_hp_native.rom
~~~

La prima riga carica bytecode ACPI. La seconda mette il file ROM nel catalogo QEMU; non lo copia nel disco del guest.

~~~text
gtx1050_hp_native.rom sul nodo
        |
        v
QEMU fw_cfg: "opt/com.lion328/nvidia-rom"
        |
        v
SSDT AML: legge il blob una volta nel buffer FWBI
        |
        v
_ROM(offset, length): restituisce la porzione richiesta
        |
        v
driver NVIDIA: inizializza la GTX 1050 Mobile
~~~

Se manca `fw_cfg`, la SSDT non ha bytes da leggere. Se manca la SSDT, il driver non trova `_ROM`. Se manca `hostpci`, non esiste la GPU fisica. Servono tutti e tre i livelli.

## 4. La SSDT, blocco per blocco

Lo script genera `/usr/share/kvm/optimus-gpu-switch/ssdt-<VMID>.asl` e `iasl` lo compila in `.aml`. Queste sono le parti rilevanti, nell'ordine in cui collaborano.

### Identità e target

~~~asl
DefinitionBlock ("", "SSDT", 1, "DOTLEG", "NVIDIAFU", 1)
{
    External (\_SB.PCI0, DeviceObj)
    External (\_SB.PCI0.SE0.S00, DeviceObj)
    Scope (\_SB.PCI0.SE0.S00)
    {
~~~

- `DefinitionBlock`: intestazione della tabella supplementare.
- Primo `External`: `PCI0` esiste già nella DSDT, quindi non va ricreato.
- Secondo `External`: esiste già anche la GPU nello scope scoperto.
- `Scope`: aggiunge i metodi **alla GPU**, non al root PCI o a un device casuale.

### Stato e memoria

~~~asl
Name (FWIT, 0)
Name (FWBI, Buffer () { 0 })
~~~

- `FWIT` è il flag “VBIOS già caricata?”.
- `FWBI` è il buffer AML: dopo il caricamento contiene la VBIOS OEM in RAM guest.

### Porte QEMU `fw_cfg`

~~~asl
OperationRegion (FWIO, SystemIO, 0x510, 2)
Field (FWIO, WordAcc, Lock) { FSEL, 16 }
Field (FWIO, ByteAcc, Lock) { Offset (1), FDAT, 8 }
~~~

- `OperationRegion` dichiara porte I/O QEMU, non memoria GPU.
- `0x510` seleziona l'entry `fw_cfg`; `0x511` è il flusso dati.
- `FSEL` è il selettore, `FDAT` il dato.
- `Lock` impedisce che letture contemporanee si mescolino.

### Lettori binari e ricerca

~~~asl
Method (RWRD, 0, Serialized) { ... }
Method (RDWD, 0, Serialized) { ... }
Method (RBUF, 1, Serialized) { ... }
Method (FISL, 3, Serialized) { ... }
~~~

- `RWRD` legge 16 bit; `RDWD` legge 32 bit; `RBUF(N)` costruisce un buffer di N byte.
- `Serialized` lascia eseguire un metodo alla volta.
- `FISL` percorre il catalogo `fw_cfg`, cerca `opt/com.lion328/nvidia-rom` e restituisce selettore/dimensione.

### Caricamento una volta

~~~asl
Method (RINT, 0, Serialized)
{
    If (!FWIT)
    {
        FWIT = 1
        FISL ("opt/com.lion328/nvidia-rom", RefOf (Local0), RefOf (Local1))
        If (Local0) { FSEL = Local0 CopyObject (RBUF (Local1), FWBI) }
    }
}
~~~

- `If (!FWIT)`: carica il firmware solo alla prima richiesta.
- `FWIT = 1`: evita letture ripetute.
- `FISL` trova file e dimensione; `FSEL` lo seleziona.
- `RBUF(Local1)` legge tutti i bytes; `CopyObject` li salva in `FWBI`.

### Il cuore: `_ROM`

~~~asl
Method (_ROM, 2)
{
    RINT ()
    Local0 = Arg1
    If (Arg1 > 0x1000) { Local0 = 0x1000 }
    If (Arg0 < SizeOf (FWBI)) { Return (Mid (FWBI, Arg0, Local0)) }
    Return (Buffer (Local0) {})
}
~~~

- `_ROM` è il nome ACPI che il driver cerca.
- `Arg0` è l'offset richiesto; `Arg1` è il numero di byte.
- `RINT()` assicura che la ROM sia stata caricata.
- `0x1000` limita ogni richiesta a 4096 byte; il driver può invocarne più di una.
- `SizeOf` evita letture oltre la ROM.
- `Mid(FWBI, Arg0, Local0)` restituisce esattamente la fetta richiesta.
- L'ultimo `Return` fornisce un buffer vuoto se l'offset non è valido, non memoria casuale.

La tabella contiene inoltre una stanza `BAT0` sotto `\_SB.PCI0.SF8`. Non entra nella catena VBIOS → `_ROM`, non rappresenta una batteria fisica e non è da copiare automaticamente su un laptop diverso.

## 5. Lo script, passo per passo

| Fase | Azione | Motivo |
| --- | --- | --- |
| Analisi | Valida BDF, ROM, Q35 e QEMU Guest Agent | Fallisce presto se manca un prerequisito |
| Proprietario | Cerca tutte le `hostpciN` che contengono la GPU | Una GPU può appartenere a una sola VM |
| Cleanup | Arresta la sorgente e rimuove solo chiavi/argomenti/SSDT creati da lui | Non modifica dischi, rete, firmware o video virtuale |
| Discovery | Collega GPU, primo boot, `lspci -PP` | Trova il vero scope ACPI |
| Generazione | ASL -> AML e `-acpitable` + `-fw_cfg` | Fornisce la VBIOS nel protocollo atteso |
| Boot finale | Driver e `nvidia-smi` | Lo switch non è “riuscito” finché la GPU non funziona |
| Idempotenza | Se tutto è già corretto, esce senza scritture/riavvii | Il comando si può ripetere in sicurezza |

`--prepare-host` è separato: installa tool mancanti, configura IOMMU/VFIO e copia ROM solo se necessario. Il BIOS del laptop (VT-d/AMD-Vi) non è automatizzabile da Linux e il reboot host è sempre esplicito.

## 6. Prova Ubuntu -> Kali -> Ubuntu

~~~text
Ubuntu VM 1001 (OVMF/Q35)
        |
        | cleanup, discovery e SSDT Kali
        v
Kali VM 1000 (SeaBIOS/Q35)
        |
        | cleanup, discovery e SSDT Ubuntu
        v
Ubuntu VM 1001: NVIDIA GeForce GTX 1050, 580.173.02, 4096 MiB
~~~

Il passaggio è stato eseguito in entrambe le direzioni. Dimostra cleanup, ri-assegnazione, discovery e generazione SSDT tra firmware guest diversi. Non dimostra che ogni laptop, VBIOS o driver automatico di tutte le distro sia identico: questa soluzione resta un workaround per NVIDIA mobile/Optimus.

## 7. Validazione della documentazione

~~~bash
python3 scripts/validate_documentation.py
~~~

Il controllo verifica presenza di termini e diagrammi richiesti, link locali e dimensione/hash della ROM. Verifica **copertura e coerenza**; le definizioni sono anche confrontate con codice, `iasl`, `nvidia-smi` e fonti ufficiali nel README.
