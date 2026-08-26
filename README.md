# GTX 1050 Mobile Optimus passthrough su Proxmox

Repository riproducibile del recupero del passthrough PCIe della NVIDIA GTX 1050 Mobile in un portatile HP, con Proxmox come host e VM Linux come guest.

## Esito verificato

- GPU host: NVIDIA GP107M / GTX 1050 Mobile, PCI ID `10de:1c8d`, BDF host `0000:02:00.0`.
- VBIOS OEM valida: 169472 byte, versione `86.07.5F.00.2C`, conservata sul nodo come `/usr/share/kvm/gtx1050_hp_native.rom`.
- Ubuntu riceve la GPU, usa il driver NVIDIA proprietario `580.173.02` e vede 4096 MiB con `nvidia-smi`.
- Il benchmark `nvidia-glxgears` ha renderizzato sul display X NVIDIA headless con circa 24-25 mila FPS. Lo screenshot [nvtop-glxgears-proof.png](evidence/nvtop-glxgears-proof.png) mostra `glxgears` al 99% GPU e il processo Xorg sul display `:2`.
- Lo switch Ubuntu -> Kali -> Ubuntu e stato verificato. Kali usa SeaBIOS; Ubuntu usa OVMF/Q35. Lo script non converte automaticamente firmware o chipset.

Il PDF completo e [output/pdf/relazione-passthrough-gtx1050.pdf](output/pdf/relazione-passthrough-gtx1050.pdf).

## Contenuto

```text
scripts/gpu-vm-switch          switch idempotente per Proxmox
scripts/extract_gtx1050_rom.py estrattore della VBIOS dal payload HP
docs/architecture.md           spiegazione ACPI, SSDT, fw_cfg e _ROM
docs/attempts-and-outcomes.md  tentativi, fallimenti e correzioni
evidence/                      prova visiva nvtop + glxgears
output/pdf/                    relazione PDF verificata visivamente
```

La VBIOS OEM non e nel repository: e firmware proprietario HP/NVIDIA. Si genera sul proprio nodo con lo script di estrazione e non va sostituita con una ROM generica presa da Internet.

## Installazione dello switch

Sul nodo Proxmox, dopo aver copiato la VBIOS nel percorso previsto:

```bash
install -m 0750 scripts/gpu-vm-switch /usr/local/sbin/gpu-vm-switch
gpu-vm-switch --self-test
gpu-vm-switch --help
```

Prerequisiti: IOMMU/VFIO gia attivo sull'host, `acpica-tools`, `pciutils`, Q35 nella VM, QEMU Guest Agent funzionante e una VBIOS OEM coerente con la GPU. Lo script supporta automaticamente Ubuntu, Debian, Kali, Arch, Fedora, RHEL, Rocky e AlmaLinux; per distribuzioni diverse usare `--skip-drivers`.

## Uso

```bash
# Menu numerato delle VM; la modalita interattiva chiede prima Secure Boot se attivo.
gpu-vm-switch

# Passaggio automatico alla VM 1001.
gpu-vm-switch --vm 1001 --yes

# Vedere cosa farebbe, senza modificare nulla.
gpu-vm-switch --vm 1001 --dry-run --yes

# Usare un'altra NVIDIA mobile e la sua VBIOS OEM.
gpu-vm-switch --gpu 0000:03:00 --rom /usr/share/kvm/altra-oem.rom --vm 123 --yes

# Driver gia predisposto manualmente nel guest.
gpu-vm-switch --vm 123 --skip-drivers --yes
```

Lo script trova chi possiede gia la GPU, spegne ordinatamente quella VM, rimuove `hostpci`, `romfile`, `rombar`, SSDT, `fw_cfg` e le opzioni CPU generate da lui, poi riaccende la sorgente senza GPU. La VM di destinazione viene avviata una prima volta per trovare dinamicamente il percorso ACPI, quindi riavviata con SSDT e VBIOS. Se la GPU e gia configurata e `nvidia-smi` funziona, non modifica ne riavvia nulla.

## Secure Boot e MOK

MOK e una chiave che il firmware UEFI deve registrare in una schermata pre-avvio; non e controllabile via SSH o QEMU Guest Agent. Per evitare quella schermata, lo script offre due comportamenti sicuri:

- in modalita interattiva, se il guest rileva Secure Boot attivo, chiede se disabilitarlo;
- in modalita non interattiva non cambia mai Secure Boot senza `--disable-secure-boot`.

```bash
gpu-vm-switch --vm 123 --disable-secure-boot --yes
```

Questa opzione e **permanente**, non temporanea. Funziona solo con OVMF e `efidisk0` di tipo `4m`: crea il fallback UEFI `EFI/BOOT/BOOTX64.EFI`, fa una copia raw delle variabili EFI in `/usr/share/kvm/optimus-gpu-switch/efi-backups/`, conserva il precedente disco EFI come `unused` della VM e crea nuove variabili senza chiavi pre-registrate. Cio evita la richiesta MOK per moduli DKMS non firmati, ma riduce la catena di fiducia del boot. Per mantenere Secure Boot, rispondere `n` e completare manualmente MOK nella console della VM.

## Benchmark e monitoraggio

`glmark2` via SSH falliva correttamente: richiede un canvas X11 e una sessione SSH non ha `DISPLAY`. Nel guest Ubuntu e stato creato un Xorg NVIDIA isolato sul display `:2` e installato il wrapper:

```bash
nvidia-glxgears       # tre ingranaggi rotanti; stampa FPS ogni cinque secondi
watch -n 1 nvidia-smi # monitor sintetico
nvtop                 # uso GPU, memoria, processi e grafico
```

`htop` legge CPU e RAM del sistema operativo, non i contatori NVIDIA: per questo non mostra il carico della GPU.

## Estrazione VBIOS

Il codice in `scripts/extract_gtx1050_rom.py` e la versione corretta e formattata dello script di recupero fornito nei tentativi precedenti. Cerca signature PCI option ROM (`55 aa`), legge `PCIR`, verifica vendor NVIDIA e device ID `1c8d`, e controlla anche stream LZMA nel payload HP.

```bash
python3 scripts/extract_gtx1050_rom.py /tmp/084C0.bin \
  --device-id 1c8d \
  --output /usr/share/kvm/gtx1050_hp_native.rom
```

Usare `--force` soltanto dopo avere confrontato BDF, PCI ID e provenienza del payload. Se il file non contiene il device, provare l'altro payload HP indicato dal pacchetto firmware.

## Fonti e limiti

- [QEMU fw_cfg](https://qemu-project.gitlab.io/qemu/specs/fw_cfg.html)
- [Specifiche ACPI UEFI](https://uefi.org/acpi/specs)
- [Documentazione Proxmox su EFI/OVMF](https://pve.proxmox.com/pve-docs/pve-admin-guide.html)
- [Guida NVIDIA ai moduli driver](https://docs.nvidia.com/datacenter/tesla/driver-installation-guide/kernel-modules.html)

E stato fornito anche un link a una chat Gemini. Dal contesto di lavoro non era leggibile; le informazioni verificabili usate qui sono quelle osservate sul nodo/guest e il codice di estrazione incluso nella richiesta.
