# CLI riproducibile: Proxmox, Omarchy e PC Windows

Questa CLI raccoglie i moduli gia' verificati senza far finta che un nodo
Proxmox, una VM Linux e un PC Windows siano la stessa macchina. Ogni comando
si esegue nel contesto che possiede la modifica: niente password nel repository,
niente SSH nascosto e nessun reboot o switch GPU implicito.

## Configurazione unica, senza IP nel codice

Creare un file locale, ignorato da Git:

```bash
cp config/omarchy.env.example config/omarchy.env
```

Compilare almeno questi valori:

```dotenv
OMARCHY_USER=your-linux-user
OMARCHY_VM_HOST=omarchy.local
OMARCHY_VM_ADDRESS=192.168.1.50
OMARCHY_CLIENT_ADDRESS=192.168.1.60
OMARCHY_RTP_PORT=40100
OMARCHY_MIC_DEVICE=Microphone (USB Audio Device)
OMARCHY_VM_ID=1002
OMARCHY_GPU_BDF=0000:02:00
OMARCHY_ROM_SOURCE=./firmware/gtx1050_hp_native.rom
```

Non inserire password, chiavi private o token. Il file contiene la topologia
locale e il nome del dispositivo DirectShow; puo' essere copiato sul nodo PVE,
sulla VM e su ogni PC Windows, con i valori appropriati a ciascun PC.

## Dove vivono i componenti e come comunicano

| Luogo | File/processo | Ruolo |
| --- | --- | --- |
| Repository | `config/omarchy.env` | Unica sorgente locale di IP, porta, utente, VM e GPU. E' ignorato da Git. |
| Nodo PVE | `scripts/gpu-vm-switch` | IOMMU/VFIO, VBIOS/SSDT e assegnazione GPU alla VM. |
| VM | `~/.local/bin/voxtype-remote-mic-*` | Ricevitore RTP, controllo domanda, PTT e dispatcher SSH ristretto. |
| VM | `~/.config/voxtype/remote-mic.env` | Porta RTP scelta dalla configurazione centrale. |
| VM | `~/.config/systemd/user/voxtype-remote-mic-rtp.service` | Ricevitore sempre pronto; il linger dell'utente lo riporta dopo reboot. |
| VM | `/run/user/<uid>/voxtype/{state,remote-mic-demand,remote-mic-control-connected}` | Stato effimero: registrazione, PTT e sessione Windows. Sparisce al logout/reboot. |
| VM | `~/.config/hypr/bindings.lua` | Blocco gestito PTT `SUPER + H` / `HOME`; ne viene salvato un backup una sola volta. |
| Windows | `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Omarchy VoxType realtime microphone.cmd` | Avvia il watcher al login Windows. |
| Windows | `%USERPROFILE%\.ssh\voxtype-omarchy_ed25519` | Chiave per quel PC; autorizzata soltanto al dispatcher microfono VM. |
| Rete | SSH ristretto + UDP RTP | SSH invia solo `active`/`idle`; RTP/Opus invia l'audio. UFW ammette UDP solo dall'IP del PC configurato. |

Il flusso e' quindi:

```text
Moonlight connesso -> watcher Windows apre SSH di controllo
VM: PTT VoxType o source-output Discord -> active
Windows: FFmpeg apre il microfono configurato -> Opus/RTP UDP
VM: FFmpeg riceve -> pw-cat -> voxtype_remote_mic.monitor
VM non richiede piu' audio -> idle -> Windows chiude FFmpeg /T
```

Il ricevitore VM e' sempre pronto, ma non puo' aprire il microfono fisico del
PC: solo FFmpeg sul PC Windows lo apre, e soltanto dopo `active`.

## Comandi

Prima vedere la sequenza completa, senza modifiche:

```bash
scripts/omarchy-setup --config config/omarchy.env plan
```

Sul nodo Proxmox, come root:

```bash
# Simulazione reale: usa qm ma non scrive, non spegne VM e non riavvia.
scripts/omarchy-setup --config config/omarchy.env proxmox gpu-prepare --dry-run
scripts/omarchy-setup --config config/omarchy.env proxmox gpu-switch --dry-run

# Applicazione esplicita.
scripts/omarchy-setup --config config/omarchy.env proxmox gpu-prepare --apply
scripts/omarchy-setup --config config/omarchy.env proxmox gpu-switch --apply
```

Nella VM Omarchy, come root:

```bash
scripts/omarchy-setup --config config/omarchy.env guest sunshine prepare --apply
scripts/omarchy-setup --config config/omarchy.env guest microphone install --apply

scripts/omarchy-setup --config config/omarchy.env guest sunshine status
scripts/omarchy-setup --config config/omarchy.env guest microphone verify

# Corregge l'installer Gaming -> Steam di Omarchy per la GTX Pascal/580xx.
scripts/omarchy-setup --config config/omarchy.env guest steam fix --apply
scripts/omarchy-setup --config config/omarchy.env guest steam verify
```

### Avvio Moonlight dopo un reboot

`guest sunshine prepare --apply` configura il guest dedicato allo streaming
per avviare automaticamente `omarchy.desktop` con SDDM. Sunshine resta un
servizio della sessione Wayland (non un daemon di sistema), quindi parte quando
Hyprland e' pronto. Lo stesso modulo abilita lo stato Omarchy persistente
`stay-awake`: non compare il lock screen per inattivita' mentre la VM attende
Moonlight. Il lock prima della sospensione resta attivo.

Questo automatizza la sessione grafica **dopo** che il sistema ha montato il
root filesystem. Il prompt Plymouth per LUKS appare prima di SDDM e non puo'
essere risolto dall'autologin. Nel guest Omarchy documentato e' ora configurato
anche il passaggio che mancava: **vTPM Proxmox + token LUKS2 con
`systemd-cryptenroll`**. Di conseguenza il boot arriva a SSH e Sunshine senza
noVNC e senza memorizzare un keyfile in chiaro nel guest.

### LUKS auto-unlock con vTPM: configurazione effettiva e modello di sicurezza

Il nodo PVE conserva lo stato TPM persistente della VM come `tpmstate0`; il
guest lo vede come `/dev/tpmrm0`. Dentro l'header LUKS2 e' presente un token
`systemd-tpm2` in un keyslot aggiuntivo. La passphrase originaria resta nello
slot iniziale, quindi e' il recupero manuale se il token non e' disponibile.

```text
Proxmox tpmstate0 -> /dev/tpmrm0 nel guest
  -> token systemd-tpm2 nell'header di /dev/sda2
  -> initramfs Limine: systemd + sd-encrypt + /etc/crypttab.initramfs
  -> /dev/mapper/root -> SDDM autologin -> Hyprland -> Sunshine
```

Per una VM nuova, prima creare il TPM persistente sullo storage PVE scelto (il
nome dello storage non va fissato nel repository):

```bash
# Nodo PVE, VM spenta. Sostituire <storage> e <vmid>.
qm set <vmid> --tpmstate0 <storage>:1,version=v2.0
```

Nel guest LUKS2, il percorso supportato da Arch/Omarchy e' `systemd` +
`sd-encrypt`, non il vecchio hook `encrypt`. La configurazione locale deve
essere un drop-in ordinato dopo `omarchy_hooks.conf`, deve convertire
`udev/encrypt/keymap/consolefont` in `systemd/sd-encrypt/sd-vconsole`, e deve
conservare gli hook Omarchy come `btrfs-overlayfs` e `resume`. Per il volume
root usare quindi:

```text
# /etc/crypttab.initramfs
root UUID=<UUID-LUKS> none tpm2-device=auto

# /etc/kernel/cmdline (estratto)
rd.luks.name=<UUID-LUKS>=root root=/dev/mapper/root ...
```

Rigenerare poi con `sudo limine-mkinitcpio` (non con un path generico
`/boot/initramfs-linux.img`: questa Omarchy usa Limine in un percorso UUID) e
iscrivere il token, senza cancellare la passphrase esistente:

```bash
sudo systemd-cryptenroll --tpm2-device=auto /dev/sda2
sudo cryptsetup luksDump /dev/sda2 # deve mostrare systemd-tpm2
```

Nel caso verificato non sono stati vincolati PCR: e' piu' affidabile per una
VM SeaBIOS priva di Secure Boot, ma significa che chi controlla **sia** disco
VM **sia** `tpmstate0` sul nodo PVE puo' avviarla. Non e' quindi equivalente a
un TPM fisico che difende dall'amministratore dell'hypervisor; elimina invece
il blocco operativo del primo login mantenendo il disco cifrato a riposo fuori
da quel confine. Per un vincolo di integrita' piu' forte servono OVMF, Secure
Boot e una policy PCR pianificata e testata separatamente.

Rollback: avviare una volta con la passphrase LUKS, rimuovere il token con
`sudo systemd-cryptenroll --wipe-slot=tpm2 /dev/sda2`, rimuovere
`/etc/crypttab.initramfs` e il drop-in locale `zz-vtpm-luks.conf`, ripristinare
il precedente `cryptdevice=...` nel cmdline, quindi `sudo limine-mkinitcpio`.
Non rimuovere `tpmstate0` finche' il guest non e' stato riavviato e verificato
con la passphrase.

Dopo lo sblocco LUKS, attendere circa 15 secondi: Moonlight puo' raggiungere
Sunshine senza login noVNC. Per verificare la configurazione nella VM:

```bash
scripts/omarchy-setup --config config/omarchy.env guest sunshine verify
```

Questa scelta e' adatta a una VM dedicata e raggiungibile solo dalla LAN:
la sessione desktop resta sbloccata al boot. Per tornare al comportamento
interattivo, rimuovere il drop-in
`/etc/sddm.conf.d/zz-omarchy-moonlight-autologin.conf` e il file
`~/.local/state/omarchy/indicators/stay-awake`, quindi riavviare.

`guest steam fix` modifica esclusivamente l'ordine della transazione avviata dal
menu **Gaming -> Steam**: per una GPU Pascal non-GSP installa prima il provider
`lib32-nvidia-580xx-utils` assieme a `steam`. Questo evita la scelta automatica
del provider `lib32-nvidia-utils`, che porta al pacchetto NVIDIA 610 e confligge
con il driver `580xx` presente nella VM. L'hook
`/etc/pacman.d/hooks/99-omarchy-steam-pascal-nvidia.hook` riapplica il fix dopo
un upgrade del pacchetto `omarchy`.

Se l'installazione si ferma con un `404` da un mirror (un database Pacman
vecchio punta a una versione gia' rimossa), eseguire nella VM l'aggiornamento
completo gestito da Omarchy, poi riaprire il menu:

```bash
omarchy update
```

Non usare `pacman -Syu` direttamente (ne' `pacman -Sy`): Omarchy lo blocca
intenzionalmente per eseguire snapshot, keyring, migrazioni e hook attraverso
il proprio update manager.

Sul PC Windows, da PowerShell:

```powershell
# Prima volta su questo PC: crea/installa la chiave limitata, poi l'autostart.
.\clients\omarchy-client-setup.ps1 -ConfigPath .\config\omarchy.env `
  -Module Microphone -InstallKey

# Configura solo le preferenze Moonlight, oppure tutto il lato Windows.
.\clients\omarchy-client-setup.ps1 -ConfigPath .\config\omarchy.env -Module Moonlight
.\clients\omarchy-client-setup.ps1 -ConfigPath .\config\omarchy.env -Module All
```

`--apply` e' necessario per le mutazioni Linux. Senza opzioni mutanti, la CLI
stampa la sequenza prevista e funziona anche fuori da PVE/Omarchy. `--dry-run`
esegue invece la simulazione reale di `gpu-vm-switch`: non scrive, ma va
lanciata come root sul nodo PVE perche' deve interrogare `qm` e l'hardware.

## Aggiungere un secondo PC Windows

1. Copiare il repository e `config/omarchy.env.example` nel nuovo PC.
2. Creare `config/omarchy.env` con lo stesso host/porta/utente VM, ma con
   `OMARCHY_CLIENT_ADDRESS` e `OMARCHY_MIC_DEVICE` del nuovo PC.
3. Nella VM, con quel file di configurazione, aggiungere la regola UFW:

   ```bash
   scripts/omarchy-setup --config config/omarchy.env guest microphone add-client --apply
   ```

4. Sul nuovo PC eseguire il modulo `Microphone -InstallKey`.

Ogni PC ha la propria chiave SSH e il proprio launcher. Il progetto supporta
piu' PC autorizzati, ma **una sola sorgente vocale Moonlight alla volta**: una
singola richiesta PipeWire di Discord/VoxType non identifica quale client
remoto dovrebbe rispondere. Se due watcher restano connessi insieme, entrambi
potrebbero ricevere `active` e inviare audio; non farlo.

## Prove versionate

![Moonlight HEVC a circa 60 FPS e NVENC attivo; il worker pesante VoxType non e' residente nello scatto idle.](../evidence/moonlight-hevc-nvtop-idle-model-unloaded.png)

Questo screenshot mostra Moonlight a `1920x1200`, circa `59.88 FPS`, codec
HEVC, zero drop rete nell'overlay e Sunshine/NVENC visibile in NVTOP. Nel
fermo immagine l'OSD VoxType occupa pochi MiB: e' il comportamento atteso a
riposo con `on_demand_loading = true`, non il modello Whisper pre-caricato.

![Trascrizione riuscita con notifica e picchi di calcolo NVTOP durante il lavoro on-demand.](../evidence/voxtype-transcription-nvtop-on-demand.png)

Qui la notifica mostra `Ciao, come stai?`; il grafico NVTOP registra i picchi
di calcolo del transcriber. Lo screenshot e' successivo alla risposta, quindi
il processo pesante puo' essere gia' stato scaricato: non va interpretato come
una misura del picco massimo di VRAM.

![Worker VoxType presente in VRAM durante l'elaborazione.](../evidence/voxtype-model-vram-during-transcription.png)

Questa prova mostra il worker `voxtype` mentre occupa circa `469 MiB` di VRAM,
oltre ai pochi MiB dell'OSD. Dimostra il caricamento GPU durante l'uso; il
comportamento a riposo e' documentato nello screenshot precedente.
