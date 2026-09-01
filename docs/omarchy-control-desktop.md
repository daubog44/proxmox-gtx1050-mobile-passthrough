# Omarchy Control desktop

`apps/omarchy-control` e' il pannello desktop Tauri per il setup client di un
desktop Omarchy remoto. Non sostituisce PVE o Sunshine: rende visibili i tre
contesti distinti e avvia la procedura nel contesto giusto.

| Area | Cosa fa l'app |
| --- | --- |
| Client locale | Salva il file `omarchy.env` privato, rileva rete e dipendenze, mostra il comando di installazione corretto e avvia l'automazione Windows/Fedora. |
| VM Omarchy | Verifica l'accesso SSH e il receiver RTP. Una password temporanea puo' autorizzare la chiave dedicata e installare il receiver quando manca. |
| PVE | Non invia comandi al nodo: GPU/VFIO restano un'operazione amministrativa esplicita del nodo, non una pressione accidentale nella GUI client. |

## Uso

I comandi di installazione diretta per Fedora, Windows, macOS Apple Silicon e
macOS Intel sono nel [README](../README.md#installare-omarchy-control). Tutti i
pacchetti correnti sono pubblicati nelle release GitHub del progetto.

In condizioni normali bastano **hostname Omarchy** e **utente SSH**. L'app:

1. risolve il nome, per esempio `omarchy.local`, nell'IP LAN corrente;
2. determina l'IP del client dalla route usata per raggiungere la VM;
3. usa `40100/UDP` e la sorgente PipeWire predefinita come valori portabili;
4. controlla Moonlight, OpenSSH, FFmpeg/Opus, PipeWire e KDE Connect;
5. per ogni dipendenza mancante mostra il comando adatto a Windows, Fedora o
   macOS e, dove supportato, lo apre nel terminale nativo.

**Salva localmente** scrive soltanto indirizzi e preferenze. Tutti i pulsanti
nel form sono esplicitamente `type=button`: il salvataggio non invia il form,
non ricarica la WebView e non produce piu' il flash nero della versione 0.1.1.

## Password SSH e receiver

Il receiver puo' essere sbloccato in tre modi, in ordine di precedenza:

1. password inserita nel campo della GUI, mantenuta soltanto in memoria;
2. variabile del processo `OMARCHY_SSH_PASSWORD`;
3. stessa variabile aggiunta deliberatamente dall'utente al file locale
   `omarchy.env`, protetto con permessi `0600` su Unix.

La GUI non scrive e non mostra mai la password. Il backend configura
`SSH_ASKPASS` sul solo processo figlio: OpenSSH richiama lo stesso eseguibile in
modalita' helper, riceve la password dall'ambiente e autorizza la chiave SSH
dedicata. Se `OMARCHY_SUDO_PASSWORD` non e' definita, il wizard Fedora usa la
password SSH anche per `sudo -S` nella VM; al termine rimuove entrambe le
variabili dal terminale. L'esecuzione manuale dello script fuori dalla GUI puo'
usare `sshpass -e`, ma soltanto quando la password e' stata esplicitamente
fornita nell'ambiente.

Il pulsante **Prova accesso SSH** distingue tre casi: receiver pronto,
autenticazione riuscita ma receiver mancante, oppure credenziale/host non
valido. **Configura questo client** salva prima i valori rilevati, poi apre il
wizard `onboard`; su macOS avvia e verifica Moonlight, ma segnala che l'adapter
microfono RTP non e' ancora implementato.

Dopo l'installazione l'app compare nel menu grafico come **Omarchy Control**.
I pacchetti contengono gia' gli script necessari: Node, Rust e Git non servono
sul computer client.

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

Il backend Rust espone soltanto operazioni nominate: ispezione, discovery,
verifica receiver, salvataggio, avvio Moonlight, installazione di una
dipendenza conosciuta e onboarding. L'installer accetta solo identificatori
presenti nella lista interna e non espone un comando shell arbitrario alla
WebView.

Tauri produce bundle nativi dalla stessa sorgente. La pipeline di release crea
RPM x86_64, NSIS x64 e DMG macOS per Apple Silicon e Intel sulla rispettiva
piattaforma CI. I DMG usano una firma ad-hoc e non sono notarizzati da Apple.
