# Tentativi, diagnosi e risultato

| Tentativo | Risultato | Correzione / lezione |
| --- | --- | --- |
| ROM generiche o solo `romfile` / `rombar` | Il driver Optimus non otteneva la VBIOS nel percorso ACPI previsto. | Estrarre la VBIOS OEM HP e servirla tramite `_ROM`. |
| Estrarre VBIOS da payload HP | Riuscito: payload con signature PCI ROM e device `10de:1c8d`. | Conservare una sola ROM OEM valida; non includerla nel repository. |
| SSDT con percorso ACPI scritto a mano | Fragile quando bridge o funzione PCI cambiano. | Discovery con `lspci -PP` e conversione dinamica a `Sxx`. |
| `glmark2` su SSH | `Could not initialize canvas`: una sessione SSH non ha un canvas X11. | Xorg NVIDIA headless sul display `:2`; `nvidia-glxgears` per FPS. |
| `glmark2-es2-drm` | Il DRM virtuale/QXL usava llvmpipe; la NVIDIA render-only non offriva CRTC DRM. | Non e un test NVIDIA utile in questo layout muxless. |
| Prima installazione driver Kali | Driver presente ma moduli non pronti senza headers/DKMS. | Installare headers, build tools, DKMS e riavviare prima di validare `nvidia-smi`. |
| Repository Debian sempre riscritta | Non idempotente. | Cerca prima `contrib non-free non-free-firmware`, incluse sorgenti Deb822, e aggiunge solo se assenti. |
| Secure Boot e DKMS | Il modulo NVIDIA compilato localmente non aveva ancora una firma fidata dal kernel. MOK appare prima del kernel e non e automatizzabile via SSH. | Prompt interattivo o flag esplicito per creare nuove variabili OVMF senza chiavi; rollback fino al primo boot verificato. |
| `pre-enrolled-keys=0` | Il marker della config non descriveva lo stato UEFI gia salvato; `mokutil` indicava comunque Secure Boot attivo. | Leggere sempre lo stato dal guest e non dedurlo dal solo file di configurazione Proxmox. |

## Prova finale

Lo screenshot `evidence/nvtop-glxgears-proof.png` mostra il processo `/usr/bin/glxgears` al 99% GPU, il display Xorg NVIDIA `:2`, 4 GiB di VRAM disponibili e temperatura di 73 C. E una prova di rendering sulla GPU reale, non solo di enumerazione da `nvidia-smi`.

## Limite della verifica Secure Boot

Sono stati verificati lo stato reale, il prompt, il rollback nel codice e il self-test SSDT. La sostituzione dell'EFI disk non e stata eseguita sulla VM Ubuntu principale: la prima esecuzione reale va trattata come un cambio firmware, con snapshot/backup e console noVNC pronta.
