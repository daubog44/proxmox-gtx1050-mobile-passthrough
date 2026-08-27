# Architettura: perché questa SSDT fa funzionare Optimus

## La differenza fra una GPU desktop e questa GPU laptop

Una GPU desktop collegata a uno slot PCIe autonomo espone normalmente la sua Option ROM sul bus. In molte VM basta assegnarla con `hostpci` e, se serve, indicare `romfile`. La GTX 1050 di questo caso è diversa: è una **GP107M mobile** in un HP Pavilion Laptop 15-cs1xxx. In un sistema Optimus muxless, il pannello interno è gestito dalla iGPU e la NVIDIA è coordinata da firmware/ACPI per alimentazione e rendering.

Non significa che *tutte* le GPU Optimus richiedano questo workaround, né che le GPU desktop non possano avere casi particolari. Significa che qui il driver NVIDIA ha tentato di ottenere la VBIOS dal metodo ACPI `_ROM` del suo device. La semplice ROM BAR PCI non gli ha fornito il percorso atteso.

```text
Passthrough desktop tipico
  GPU PCI reale -> hostpci -> ROM PCI / romfile -> driver

Questo caso Optimus
  GPU PCI reale -> hostpci -> device ACPI -> _ROM(offset, length) -> driver
                                     ^
                                     SSDT aggiuntiva -> fw_cfg -> VBIOS OEM
```

La correzione non cambia il firmware della GPU. Trasporta la stessa VBIOS OEM attraverso un canale diverso e aggiunge l'interfaccia `_ROM` che il driver si aspetta.

## I quattro pezzi della soluzione

1. **VFIO e `hostpci`**: il nodo lascia la GPU a `vfio-pci`; Proxmox la espone a una sola VM per volta. La configurazione usa `pcie=1`, `rombar=0` e il nome della ROM OEM.
2. **QEMU `fw_cfg`**: nelle `args` della VM il blob binario è reso disponibile come `opt/com.lion328/nvidia-rom`. QEMU non esegue né valida la VBIOS: la conserva e la espone come bytes.
3. **SSDT AML**: QEMU carica il file compilato `.aml` con `-acpitable`. La SSDT vive accanto alla DSDT standard e aggiunge il metodo `_ROM` al device GPU già esistente.
4. **Driver NVIDIA**: chiama `_ROM` con offset e lunghezza. La SSDT carica una sola volta il blob da `fw_cfg` nel buffer `FWBI` e restituisce la parte richiesta.

Questo è il motivo per cui “passare il file ROM nel canale `fw_cfg`” e “aggiungere la SSDT” non sono alternative: il primo porta i dati, la seconda rende quei dati raggiungibili dal driver nel protocollo ACPI corretto. Senza SSDT il file rimane invisibile al driver; senza `fw_cfg` la SSDT non ha la VBIOS corretta da restituire.

## ASL e AML, riga per riga concettuale

Lo script genera una `.asl`, la compila con `iasl` e passa il risultato `.aml` a QEMU. La forma ridotta è:

```asl
DefinitionBlock ("", "SSDT", 1, "DOTLEG", "NVIDIAFU", 1)
{
    External (\_SB.PCI0, DeviceObj)
    External (\_SB.PCI0.SE0.S00, DeviceObj)

    Scope (\_SB.PCI0.SE0.S00)
    {
        Name (FWIT, 0)
        Name (FWBI, Buffer () { 0 })
        // OperationRegion + Field + RWRD/RDWD/RBUF leggono fw_cfg

        Method (RINT, 0, Serialized)
        {
            // trova opt/com.lion328/nvidia-rom e copia i bytes in FWBI una volta
        }

        Method (_ROM, 2)
        {
            RINT ()
            Return (Mid (FWBI, Arg0, Arg1))
        }
    }
}
```

- `DefinitionBlock` identifica questa tabella come SSDT e assegna vendor/table ID; non modifica la DSDT.
- `External` evita di ridefinire `PCI0` o la GPU. Dice al compilatore AML: “questo oggetto è già presente in un'altra tabella”.
- `Scope` è essenziale: `_ROM` deve essere figlio del device che il driver associa alla GPU. Uno scope corretto ma riferito a un altro bridge è comunque un errore.
- `FWIT` è un flag di inizializzazione; impedisce di ricopiare tutta la ROM a ogni chiamata.
- `FWBI` è il buffer AML della VBIOS.
- `OperationRegion` e `Field` descrivono registri I/O. In questa SSDT servono a percorrere la directory QEMU `fw_cfg`; `RWRD`, `RDWD` e `RBUF` sono routine di lettura word/dword/buffer.
- `FISL` cerca nella directory il nome `opt/com.lion328/nvidia-rom`, ricavandone selettore e dimensione.
- `RINT` seleziona quell'entry, legge il blob e lo copia in `FWBI`.
- `_ROM` riceve `Arg0=offset` e `Arg1=length`, limita la lettura a 4096 byte per chiamata e restituisce `Mid(FWBI, Arg0, Local0)`. Se l'offset supera il buffer, restituisce un buffer vuoto della dimensione richiesta.

Il file completo generato dal nodo è `/usr/share/kvm/optimus-gpu-switch/ssdt-<VMID>.asl`; il relativo `.aml` è il file realmente caricato. Può essere letto con `iasl -d file.aml`.

## Perché il percorso PCI non è fissato nel codice

Il BDF host `0000:02:00.0` descrive il laptop fisico, non il nome che QEMU assegna nella DSDT della VM. Dopo il primo avvio con `hostpci`, lo script chiede al guest:

```bash
lspci -PP -n -d 10de:1c8d
# esempio: 00:1c.0/01:00.0
```

Ogni hop è tradotto nel nome che la DSDT Q35 usa per gli slot PCI: `slot * 8 + function`, in esadecimale, con prefisso `S`.

| Hop PCI | Calcolo | Nome ACPI |
| --- | --- | --- |
| `1c.0` | `0x1c * 8 + 0 = 0xe0` | `SE0` |
| `00.0` | `0x00 * 8 + 0 = 0x00` | `S00` |

Lo scope diventa `\_SB.PCI0.SE0.S00`. Questo discovery dinamico è ciò che rende lo script riutilizzabile per alcune altre NVIDIA mobile: non risolve però una DSDT radicalmente differente, gruppi IOMMU sbagliati o una VBIOS OEM incompatibile.

## Lifecycle e cleanup

```text
preparazione host idempotente
  installa strumenti se mancanti
  -> configura IOMMU/VFIO se necessario
  -> installa ROM se differente
  -> riavvio esplicito del nodo

switch idempotente
  preflight BDF/ROM/Q35/QGA e lettura Secure Boot guest
  -> se già pronto: verifica nvidia-smi, nessun reboot
  -> individua proprietario GPU
  -> stop VM sorgente, cleanup solo delle opzioni gestite
  -> assegna hostpci alla destinazione
  -> boot temporaneo + lspci -PP
  -> PCI guest -> scope ACPI -> ASL -> AML
  -> boot finale con -acpitable e -fw_cfg
  -> driver, nvidia-smi, benchmark
  -> trap finale: restart sorgente senza GPU se prima running
```

Il cleanup non usa un “ripristino della VM” generico. Rimuove soltanto la chiave `hostpciN` che punta alla GPU selezionata, gli argomenti `-acpitable`/`-fw_cfg` generati, l'SSDT generata e `cpu=host,hidden=1` se è precisamente la scelta dello script. Non cambia firmware OVMF/SeaBIOS, chipset Q35, dischi o video virtuale.

## Secure Boot e il confine dell'automazione

Secure Boot verifica chi firma ciò che Linux carica. Se l'installazione del driver usa DKMS, DKMS può compilare `nvidia.ko` e firmarlo con una chiave nuova; il firmware non la considera fidata finché l'utente non ne conferma il certificato MOK. Questo non è un difetto NVIDIA: un pacchetto con modulo già firmato da una chiave fidata non richiede alcun MOK.

La parte guest può installare driver, riavviare e leggere `mokutil`, ma MOK Manager è prima del kernel. La password temporanea scelta durante `mokutil --import` protegge la richiesta di registrazione, non il modulo e non l'account Linux. Per questo ci sono due procedure volutamente separate:

- `--mok-manual` conserva Secure Boot. Se DKMS crea un modulo firmato con chiave non fidata, lo script lascia l'assegnazione GPU intatta, segnala MOK e fornisce i certificati che riesce a trovare. L'utente completa l'import e l'enrollment nella console noVNC.
- `--disable-secure-boot` sostituisce le variabili OVMF con un template senza chiavi, creando prima fallback, backup raw e rollback. È più automatizzabile ma è un cambio permanente della politica di boot e riduce una protezione di sicurezza.

Nello script il controllo dello stato avviene subito dopo che la destinazione risponde al Guest Agent e prima di staccare una VM sorgente. Il controllo driver avviene alla fine: se il passthrough è già completo ma il driver fallisce con Secure Boot attivo, `--mok-manual` non ricostruisce né riattacca la GPU; stampa chiavi pendenti/certificati e lascia la configurazione invariata. MOK Manager appare solo se la richiesta è pendente e non può essere pilotato da SSH/QGA.

L'host Ubuntu rilevato aveva Secure Boot attivo con `mokutil` anche quando la stringa Proxmox riportava `pre-enrolled-keys=0`: quel parametro non ricostruisce il contenuto delle vecchie variabili EFI già salvate. Il ramo “Secure Boot off” non è stato eseguito sulla Ubuntu principale, quindi non va considerato una prova runtime finché non viene testato con snapshot e console disponibile.

Per definizioni più brevi, vedi [glossary.md](glossary.md). Per i tentativi falliti e le prove, vedi [attempts-and-outcomes.md](attempts-and-outcomes.md).
