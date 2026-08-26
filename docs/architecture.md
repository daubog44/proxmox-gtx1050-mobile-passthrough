# Architettura della soluzione

## Vocabolario essenziale

- **BDF**: indirizzo di un dispositivo PCI, formato `dominio:bus:device.funzione`. Per esempio `0000:02:00.0` identifica la funzione grafica della GTX 1050 sul nodo. La funzione `.1` e spesso l'audio HDMI/DP della stessa scheda.
- **VBIOS**: firmware della GPU. Nei file si trova spesso con estensione `.rom`; in questo lavoro, ROM e VBIOS indicano lo stesso blob di firmware, ma “ROM” puo anche significare la finestra ROM hardware PCI.
- **IOMMU/VFIO**: IOMMU isola la DMA; VFIO assegna un dispositivo PCI reale a QEMU senza che il driver host lo usi.
- **ACPI**: tabelle firmware che descrivono hardware e metodi al sistema operativo.
- **ASL / AML**: ASL e il linguaggio testuale ACPI; AML e il bytecode compilato caricato dal firmware. `iasl` compila `.asl` in `.aml`.
- **SSDT**: una tabella ACPI aggiuntiva. Non sostituisce le tabelle del firmware: aggiunge o estende oggetti.
- **`_ROM`**: metodo ACPI standard che un driver puo invocare con offset e lunghezza per ottenere firmware di un dispositivo.
- **`fw_cfg`**: canale QEMU per esporre piccoli blob al firmware/guest. Qui trasporta la VBIOS; non la interpreta.

## Perche `romfile` non bastava

`romfile=...` rende una ROM disponibile nella configurazione PCI virtuale. Per molte GPU desktop e sufficiente. In un portatile Optimus, invece, il driver NVIDIA puo cercare la VBIOS attraverso il metodo ACPI `_ROM` del device e non attraverso quella finestra PCI. Per questo provare ROM scaricate, `rombar=1` o il solo `romfile` non ha risolto il problema.

La soluzione finale trasporta **lo stesso file VBIOS OEM** nel canale QEMU `fw_cfg` e usa una SSDT che implementa `_ROM`: al primo accesso legge il blob da `fw_cfg`, lo mantiene in buffer e restituisce la porzione richiesta dal driver. `rombar=0` e voluto: il percorso affidabile e ACPI + `fw_cfg`.

## Conversione PCI -> ACPI dinamica

Il guest comunica la topologia PCI con `lspci -PP`. Un esempio e:

```text
00:1c.0/01:00.0
```

QEMU/ACPI usa nomi `Sxx` costruiti con `(slot * 8) + funzione` in esadecimale:

```text
1c.0 -> 0x1c * 8 + 0 = 0xe0 -> SE0
00.0 -> 0x00 * 8 + 0 = 0x00 -> S00
```

Quindi lo scope target diventa `\_SB.PCI0.SE0.S00`. Lo script non lo fissa nel codice: assegna temporaneamente la GPU, legge la topologia reale, calcola il percorso e genera una SSDT per quella VM. Questo e il motivo per cui puo adattarsi anche ad altre NVIDIA mobile, pur restando necessario fornire BDF e VBIOS OEM corretti.

## Flusso di switch

```text
GPU VFIO host
  -> rimuovi configurazione Optimus dalla VM sorgente
  -> riaccendi la sorgente senza GPU
  -> collega hostpci alla destinazione
  -> avvio temporaneo e discovery PCI/ACPI
  -> genera SSDT AML
  -> avvio finale con SSDT + fw_cfg(VBIOS)
  -> driver NVIDIA, nvidia-smi, benchmark Xorg opzionale
```

Il cleanup e mirato alle chiavi e agli argomenti generati dallo script. Non cambia automaticamente `machine`, `bios`, `vga` o altri componenti della VM: Kali puo rimanere SeaBIOS e Ubuntu OVMF.

## Secure Boot

`pre-enrolled-keys=0` nella configurazione Proxmox non e prova sufficiente dello stato attuale: e un marker del template EFI. Lo stato reale va letto dal guest, con `mokutil --sb-state` oppure dalla variabile EFI `SecureBoot-*`. Sul guest Ubuntu verificato, Secure Boot era attivo nonostante quel marker.

Per disabilitarlo senza una interazione MOK, l'unico metodo automatizzabile e partire con nuove variabili OVMF senza chiavi pre-caricate. Lo script conserva quelle vecchie, prepara un fallback EFI bootabile e crea il nuovo `efidisk0`. Non modifica questa impostazione se l'utente non lo chiede esplicitamente in non-interattivo.
