# Omarchy Control desktop

`apps/omarchy-control` e' il pannello desktop Tauri per il setup client di un
desktop Omarchy remoto. Non sostituisce PVE o Sunshine: rende visibili i tre
contesti distinti e avvia la procedura nel contesto giusto.

| Area | Cosa fa l'app |
| --- | --- |
| Client locale | Salva il file `omarchy.env` privato, rileva Moonlight e SSH, avvia l'automazione Windows/Fedora. |
| VM Omarchy | Con una chiave SSH gia' disponibile controlla dispatcher e servizio receiver RTP. L'onboarding Fedora puo' installarli automaticamente se assenti. |
| PVE | Non invia comandi al nodo: GPU/VFIO restano un'operazione amministrativa esplicita del nodo, non una pressione accidentale nella GUI client. |

## Uso

Su Windows installare [Omarchy Control 0.1.0](../releases/omarchy-control-0.1.0-x64-setup.exe).
La GUI chiede host, IP e utente della VM, IP del client e porta RTP. Non chiede
ne' salva password. Dopo **Salva localmente**, il pulsante **Configura questo
client** apre PowerShell e avvia gli script gia' inclusi con il pacchetto; i
prompt SSH e sudo restano nel terminale di sistema. Su Fedora apre un terminale
grafico e avvia il wizard `onboard`; su macOS avvia e verifica Moonlight, ma
blocca con un messaggio esplicito il tunnel microfono, perche' non esiste ancora
un adapter RTP macOS equivalente a quello Windows/Fedora.

Su Fedora non serve clonare la repository. Installare l'RPM pubblicato nella
[release Omarchy Control 0.1.0](https://github.com/daubog44/proxmox-gtx1050-mobile-passthrough/releases/tag/omarchy-control-v0.1.0):

```bash
curl -fLO https://github.com/daubog44/proxmox-gtx1050-mobile-passthrough/releases/download/omarchy-control-v0.1.0/omarchy-control-0.1.0-x86_64.rpm
sudo dnf install ./omarchy-control-0.1.0-x86_64.rpm
omarchy-control
```

Dopo l'installazione l'app compare anche nel menu grafico come **Omarchy Control**.
Il pacchetto contiene gia' gli script necessari: Node, Rust e Git non servono
sul PC Fedora.

## Perche' Moonlight non e' incorporato

Moonlight Qt e' un client completo Qt/C++ GPL-3.0: gestisce decoder hardware,
codec, HDR, audio, input e windowing sui tre sistemi. Integrarlo direttamente
in una WebView Tauri richiederebbe fork, build Qt/SDL/FFmpeg per ogni
piattaforma e distribuzione compatibile GPL. Omarchy Control quindi rileva e
apre l'installazione ufficiale di Moonlight: il client di streaming resta
aggiornabile e responsabile della propria GPU, mentre l'app controlla setup e
diagnostica.

## Sviluppo e build

```powershell
cd apps/omarchy-control
npm install
npm run build
npm run tauri build -- --bundles nsis
```

Il backend Rust restringe le operazioni a quattro comandi Tauri: leggere lo
stato, salvare la configurazione, avviare Moonlight e aprire l'automazione nel
terminale. Non espone un comando shell arbitrario alla WebView.

Tauri produce bundle nativi dalla stessa sorgente: NSIS/MSI su Windows, DMG su
macOS e AppImage/DEB/RPM su Linux, ma ogni bundle deve essere costruito e
firmato sulla rispettiva piattaforma o in CI. Questa repository contiene e ha
verificato l'installer NSIS x64; non dichiara costruiti DMG o bundle Linux.
