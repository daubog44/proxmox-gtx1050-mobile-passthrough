# RDP della VM Ubuntu: Wayland nativo, stato reale e diagnosi riproducibile

Questa pagina riguarda l'accesso remoto alla VM Ubuntu, non VBIOS, VFIO o SSDT. Il passthrough GPU e' funzionante; l'RDP e' un secondo percorso software che usa quella GPU per la codifica, ma non la determina.

## Stato al 2026-08-27: cosa funziona e cosa no

| Componente | Stato osservato | Significato |
| --- | --- | --- |
| Passthrough NVIDIA | funzionante | Il guest vede la GTX 1050; il server Wayland registra anche `HWAccel.CUDA: Initialization of CUDA was successful`. |
| GNOME Remote Desktop 50.2, modo `system` | attivo su TCP 3389 | E' il server RDP Wayland corretto, chiamato da GNOME **Remote Login**. |
| Stack Ubuntu installato | `gnome-remote-desktop 50.2-0ubuntu0.1`, `gnome-settings-daemon 50.0-1ubuntu1+rdphandover1`, `libfreerdp3 3.30.0` | Il suffisso `+rdphandover1` e' un backport locale e versionato della correzione di hand-over. Il candidato ufficiale resta `50.0-1ubuntu1`, quindi non viene sovrascritto finche' non arrivera' una revisione Ubuntu successiva. |
| `xrdp`, `xorgxrdp`, GNOME Flashback/Metacity | **rimossi** | Non sono piu' listener, pacchetti o processi della VM. |
| Client Windows `mstsc` predefinito | corretto per RDSTLS | La normale app Windows legge il profilo nascosto `Documents\Default.rdp`. Il 2026-08-27 conteneva `use redirection server name:i:0`: dopo il redirect sceglieva NLA. E' stato corretto in `:i:1`, quindi ora anche l'indirizzo digitato nella GUI eredita RDSTLS. |
| Profilo RDSTLS salvato | disponibile come fallback riproducibile | `clients/windows-rdstls-template.rdp` e la copia Desktop sono Unicode UTF-16 LE e contengono IP, utente, RDSTLS e richiesta di audio sul PC locale. Sono per la stessa app `mstsc.exe`, non per un client alternativo. |
| Audio RDP playback | **verificato manualmente dall'utente** | L'audio prodotto dalla VM e' arrivato al PC Windows con `audiomode:i:0`. Non e' una deduzione dai log: e' un ascolto reale riferito dall'utente. |
| Hand-over dopo backport | servizi e RDSTLS verificati; prova grafica diretta da ripetere dopo la correzione locale | Il server emette `Sending server redirection`, crea il greeter Wayland e avvia `gnome-remote-desktop-daemon --handover`. L'utente ha riferito che il profilo `.rdp` funziona; `Default.rdp` e' stato corretto per estendere la stessa modalita' al collegamento diretto. Una nuova prova visiva greeter -> desktop dal client predefinito resta il controllo finale. |

Non e' corretto dichiarare RDP riuscito solo perche' il listener e il greeter partono. La prova conclusiva e' vedere il greeter e il desktop in `mstsc`, senza chiusura della finestra e senza errori di autenticazione/hand-over nel journal. Il renderer del desktop Wayland e il fix KMS sono documentati in [wayland-nvidia-kms.md](wayland-nvidia-kms.md): sono separati dalla negoziazione RDP.

## 1. Il primo problema: perche' xrdp dava nero

Ubuntu 26.04.1 usa GNOME 50.1 con Wayland. Il primo server era `xrdp` con `xorgxrdp`: dopo l'autenticazione apriva un server **Xorg/X11** separato sul display `:10`, non una sessione GNOME Wayland. Il journal mostrava:

~~~text
org.gnome.Shell@ubuntu.service: Starting requested but asserts failed.
Assertion failed for org.gnome.Shell@ubuntu.service - GNOME Shell.
Dependency failed for gnome-session@ubuntu.target.
~~~

La sessione GNOME richiesta ha `XDG_SESSION_TYPE=wayland`; `xrdp` aveva invece creato X11. La schermata nera di quella prima soluzione non dipendeva da rete, credenziali, NVIDIA o passthrough: GNOME terminava una sessione incompatibile.

Flashback/Metacity era soltanto un controllo intermedio: la schermata blu provava che `xrdp` sapeva creare una sessione X11. Non e' la soluzione voluta e non e' piu' installato.

### Cleanup eseguito

Il 2026-08-27 sono stati eseguiti sul guest:

~~~bash
sudo apt-get purge gnome-session-flashback xrdp xorgxrdp
rm -f ~/.xsession
rm -rf ~/.local/state/xrdp
~~~

Sono stati terminati anche i processi orfani della vecchia sessione (`Xorg :10`, `xrdp-chansrv`, Flashback/Metacity) e rimossi i file di runtime. APT ha installato i piccoli driver Xorg standard `libinput`/`wacom` per sostituire l'alternativa `xorgxrdp` richiesta dal meta-pacchetto Xorg gia' presente con il driver NVIDIA; **non** e' stato eseguito `apt autoremove`, per non rischiare di rimuovere il driver NVIDIA.

## 2. Il percorso Wayland e il difetto attuale

Il percorso corretto e' GNOME Remote Login:

~~~text
mstsc Windows
  -> gnome-remote-desktop-daemon --system (porta 3389; primo tratto)
  -> GDM crea un greeter Wayland headless
  -> gsd-sharing avvia gnome-remote-desktop-handover.service
  -> server iniziale invia Server Redirection
  -> gnome-remote-desktop-daemon --handover (secondo tratto)
  -> greeter Wayland, poi desktop dell'utente
~~~

### Cosa significa davvero “hand-over”

Un normale server RDP termina nella stessa sessione che ha accettato la porta. GNOME Remote Login non puo' farlo: per sicurezza un login Wayland **headless** ha un proprio compositor e, dopo l'autenticazione, il desktop dell'utente ha ancora un altro compositor. Il client deve quindi cambiare destinatario due volte senza che l'utente debba aprire una seconda connessione:

~~~text
1. mstsc -> daemon RDP di sistema sulla porta 3389
2. il daemon chiede a GDM un greeter Wayland headless
3. gsd-sharing avvia il daemon di hand-over del greeter
4. Server Redirection: mstsc chiude intenzionalmente il primo socket
5. mstsc si riconnette con un routing token e credenziali monouso RDSTLS
6. il daemon di sistema consegna il socket al daemon del greeter
7. dopo il login, GDM crea la sessione Wayland di daubog44
8. una seconda redirezione consegna il socket al daemon della sessione utente
~~~

La riga `ERRINFO_LOGOFF_BY_USER` subito dopo `Sending server redirection` puo' quindi essere normale: descrive la chiusura del **primo** socket. Il successo richiede pero' che i passi 5-8 completino e che `mstsc` mostri prima il greeter, poi il desktop. Non e' un reset GPU, non e' un crash di QEMU e non implica che la VBIOS sia coinvolta.

Nel tentativo Windows nativo riprodotto il 2026-08-27, il primo tratto e' riuscito. Il log attuale prova, in ordine:

~~~text
RDP server started                         # server Wayland di destinazione avviato
[RDP] Sending server redirection           # il primo server passa il client al secondo
ERRINFO_LOGOFF_BY_USER                     # il primo socket viene chiuso per la redirezione
[RDP] Network or intentional disconnect    # non e' ancora una prova del secondo tratto
~~~

Le prove precedenti avevano mostrato anche `Could not find user in SAM database`, `SEC_E_NO_CREDENTIALS` e `client authentication failure`: erano il caso NLA descritto sotto. **SAM** qui non e' il file utenti Linux `/etc/passwd`: e' il database credenziali NTLM interno a FreeRDP. Nel secondo tratto GNOME puo' usare credenziali monouso trasmesse nella redirezione. Se `mstsc` sceglie NLA invece di RDSTLS, presenta credenziali che quel server temporaneo non trova nel suo SAM; la negoziazione fallisce e la finestra diventa nera.

La redirezione gia' osservata dimostra che la GPU, il listener sulla 3389, il certificato e il primo login headless non sono il problema. Il log del tentativo delle 02:07 ha inoltre provato che il servizio handover si avviava e riceveva il collegamento. Il fallimento residuo era lato scelta del protocollo client: `Default.rdp` aveva `use redirection server name:i:0`, quindi un successivo tentativo manuale presentava NLA e il server riportava `SAM database`/`SEC_E_NO_CREDENTIALS`. Questa sequenza corrisponde al problema Ubuntu [LP #2141992](https://bugs.launchpad.net/ubuntu/+source/gnome-remote-desktop/+bug/2141992): la race storica di `gsd-sharing` e il passaggio NLA/RDSTLS sono correlati nella stessa catena, ma non sono la stessa cosa. Il primo e' mitigato dal backport; il secondo e' corretto nel profilo predefinito Windows.

## 3. Causa nel codice di gsd-sharing e backport installato

`gsd-sharing` esiste dentro ogni sessione GNOME, compreso il greeter temporaneo. Mantiene una lista di servizi “assegnati”; per Remote Login uno di questi e' `gnome-remote-desktop-handover.service`. Un watch D-Bus imposta `info->system_service_running=true` quando il daemon RDP di sistema e' vivo.

Nella versione Ubuntu 50.0 originale, durante il `pre_shutdown` del greeter, `gsd-sharing` scorreva la lista e chiamava incondizionatamente `stop_assigned_service(...)`. In pratica il greeter poteva spegnere il daemon che doveva ancora ricevere il socket reindirizzato. E' la race che produce finestra nera/chiusura dopo la redirezione.

Il 2026-08-27, dopo lo snapshot Proxmox `pre-rdp-handover-backport-20260827`, e' stato compilato dal sorgente Ubuntu **esatto** `50.0-1ubuntu1` e installato il pacchetto locale `50.0-1ubuntu1+rdphandover1`. La patch riproducibile e' [gnome-settings-daemon-50.0-rdp-handover.patch](../patches/gnome-settings-daemon-50.0-rdp-handover.patch):

~~~diff
-                stop_assigned_service (manager, info);
+                if (!info->system_service_running)
+                        stop_assigned_service (manager, info);
~~~

In parole semplici: **ferma il servizio soltanto quando il daemon RDP di sistema non e' piu' attivo**. Non apre porte aggiuntive, non disabilita autenticazione, non modifica NVIDIA, VFIO, QEMU, la ROM o ACPI. Il pacchetto e' stato compilato con le build dependency Ubuntu e sostituisce solo `gnome-settings-daemon` e `gnome-settings-daemon-common`; non rimuove pacchetti.

La precedente drop-in e' mantenuta come difesa aggiuntiva:

~~~ini
# /etc/systemd/user/gnome-remote-desktop-handover.service.d/90-keep-system-rdp-handover.conf
[Unit]
RefuseManualStop=yes
~~~

Il file era stato creato in precedenza ma il manager utente non l'aveva ricaricato: il 2026-08-27 e' stato eseguito `systemctl --user daemon-reload` nel bus dell'utente e `RefuseManualStop=yes` e' risultato effettivamente caricato.

La drop-in rifiuta uno stop manuale richiesto a systemd; il backport corregge invece la decisione logica che lo richiedeva. GDM e `gnome-remote-desktop.service` sono stati riavviati dopo l'installazione. La prova Windows resta necessaria per dichiarare il flusso interamente riuscito.

## 4. RDSTLS: configurazione richiesta dal client Windows

Il daemon GNOME 50.2 stesso indica questa opzione per rendere sicuro l'hand-over:

~~~text
use redirection server name:i:1
~~~

Usa [windows-rdstls-template.rdp](../clients/windows-rdstls-template.rdp) come fallback riproducibile: nel laboratorio contiene gia' `192.168.0.17:3389` e `daubog44`, ma non contiene password. E' un profilo per **la stessa** app `mstsc.exe` preinstallata, non un client alternativo. La GUI classica consente di digitare l'indirizzo, ma non espone l'attributo `use redirection server name:i:1`.

Il file e' intenzionalmente UTF-16 LE con terminatori Windows: il client `mstsc` di questo PC non caricava il precedente modello UTF-8 con segnaposto. Sul Desktop e' stata copiata la versione pronta `Ubuntu-Wayland-RDSTLS.rdp`. Le righe rilevanti sono:

~~~ini
full address:s:192.168.0.17:3389
username:s:daubog44
use redirection server name:i:1
audiomode:i:0
audiocapturemode:i:0
~~~

`audiomode:i:0` chiede di ascoltare sul PC Windows l'audio prodotto nella VM; `audiocapturemode:i:0` non redirige il microfono. La password resta nel gestore credenziali di Windows o viene richiesta da `mstsc`; non va scritta nel file o nel repository. L'audio playback e' stato ascoltato e confermato manualmente dall'utente; il microfono non e' stato testato.

### Rendere RDSTLS predefinito anche nella GUI Windows

`mstsc` memorizza le impostazioni usate dalla sua finestra in `%USERPROFILE%\Documents\Default.rdp` (nascosto). Il file separato funzionava perche' conteneva `:i:1`; la GUI continuava invece a caricare il valore precedente `:i:0`. Il 2026-08-27, a `mstsc` chiuso, e' stato salvato nel profilo predefinito questo cambiamento:

~~~diff
-use redirection server name:i:0
+use redirection server name:i:1
~~~

Questa non installa software, non modifica Secure Boot e non memorizza la password. Cambia soltanto il protocollo da usare **dopo** il redirect GNOME. La verifica riproducibile sul PC Windows e':

~~~powershell
Get-Content "$env:USERPROFILE\Documents\Default.rdp" |
  Select-String '^use redirection server name:'
# atteso: use redirection server name:i:1
~~~

Ora si puo' aprire `Connessione Desktop remoto` dal menu Start, inserire `192.168.0.17` (o `192.168.0.17:3389`) e premere Connetti: e' la stessa applicazione del file `.rdp`, ma eredita RDSTLS. Non eliminare il file template: e' il fallback esplicito se in futuro Windows o l'utente risalvano `Default.rdp` con un valore diverso.

Alla **prima** apertura Windows mostra una conferma locale equivalente a “autorizzo l'apertura dei file RDP su questo dispositivo per il mio account”. E' una protezione del client Windows, non una schermata MOK e non proviene da Ubuntu. Deve essere confermata manualmente dall'utente Windows: un'automazione non deve abilitare quella preferenza di sicurezza al suo posto.

L'impostazione richiede a `mstsc` di usare RDSTLS per il secondo tratto invece del normale NLA. E' necessaria, ma non puo' correggere da sola un difetto nel servizio GNOME che deve ricevere la connessione reindirizzata. Il test visuale va rifatto dalla GUI diretta (oppure, in fallback, dal file template); il criterio di successo e' sotto.

## 5. Verifica riproducibile, senza dare nulla per scontato

### Sul guest Ubuntu

~~~bash
# Configurazione del server di sistema (stato, porta, metodo di autenticazione e certificato).
sudo grdctl --system status

# Solo GNOME Remote Desktop deve ascoltare su 3389.
sudo ss -ltnp '( sport = :3389 )'

# I vecchi pacchetti devono risultare non installati.
dpkg-query -W -f='${binary:Package}\t${db:Status-Abbrev}\n' \
  gnome-session-flashback xrdp xorgxrdp 2>/dev/null || true

# La drop-in deve essere caricata dal manager dell'utente corrente.
systemctl --user show gnome-remote-desktop-handover.service -p RefuseManualStop

# Il backport deve risultare installato. Il suffisso locale rende riconoscibile la patch.
dpkg-query -W -f='${binary:Package}\t${Version}\n' \
  gnome-settings-daemon gnome-settings-daemon-common
# atteso: 50.0-1ubuntu1+rdphandover1

# In un terminale separato, osserva il prossimo tentativo Windows.
sudo journalctl -f | grep -E -i \
  'gnome-remote-desktop|Sending server redirection|SAM database|SEC_E_NO_CREDENTIALS|RDSTLS|HWAccel.CUDA'
~~~

### Sul PC Windows

1. Verifica prima che `Default.rdp` mostri `use redirection server name:i:1` con il comando sopra. Se non lo mostra, apri il file template `.rdp`, che forza la stessa opzione.
2. Apri `Connessione Desktop remoto` Windows, inserisci `192.168.0.17` (o `192.168.0.17:3389`) e connettiti; non serve installare un'altra app.
3. Inserisci/usa le credenziali RDP configurate in GNOME Remote Login. Il file non contiene e non deve contenere password.
4. Controlla nel journal: devono comparire `RDP server started` e `Sending server redirection`; la finestra non deve poi chiudersi. Se compaiono `SAM database` o `SEC_E_NO_CREDENTIALS`, controlla di nuovo il valore di `Default.rdp`: indicano NLA, non NVIDIA.
5. Il risultato valido e' prima il greeter GNOME Wayland, poi il desktop dopo il login. Un listener aperto, CUDA inizializzato oppure la sola redirezione non bastano.

## 6. Quando fermarsi e rollback

Se il profilo RDSTLS autorizzato continua a chiudere dopo `Sending server redirection` (con o senza `SAM database`/`SEC_E_NO_CREDENTIALS`), fermati: non e' utile reinstallare driver NVIDIA, cambiare ROM, SSDT o GPU. Il backport e' gia' la correzione mirata per `gsd-sharing`; il passo seguente sarebbe raccogliere il nuovo journal e confrontarlo con il secondo tratto RDSTLS, non provare ROM casuali.

Il rollback piu' affidabile e' il snapshot Proxmox creato prima della modifica, dal nodo:

~~~bash
qm rollback 1001 pre-rdp-handover-backport-20260827
~~~

Questo riporta anche il filesystem guest, non solo il pacchetto. Per il rollback del solo pacchetto, aspettare una revisione ufficiale Ubuntu superiore oppure installare esplicitamente la versione ufficiale con `apt-get --allow-downgrades`; fare sempre prima una simulazione. Nessun PPA e' stato aggiunto alla VM.

Per rimuovere solo la mitigazione, mantenendo GNOME Remote Login:

~~~bash
sudo rm -f /etc/systemd/user/gnome-remote-desktop-handover.service.d/90-keep-system-rdp-handover.conf
# Eseguire la riga seguente dalla shell dell'utente desktop, non da root.
systemctl --user daemon-reload
sudo systemctl restart gdm3.service
~~~

Non reinstallare `xrdp` come “fix” Wayland: ripristinerebbe la sessione X11 incompatibile descritta sopra.

## Fonti

- [GNOME Remote Login](https://teams.pages.gitlab.gnome.org/Websites/help.gnome.org/gnome-help/remote-login.html): cosa e' Remote Login e porta 3389.
- [LP #2141992](https://bugs.launchpad.net/ubuntu/+source/gnome-remote-desktop/+bug/2141992): bug Ubuntu nel hand-over e stato della correzione.
- [SUSE: headless remote sessions in GNOME](https://www.suse.com/c/headless-remote-sessions-in-gnome-part-3/): uso di `use redirection server name:i:1` per RDSTLS con `mstsc`.
- [Microsoft: attributi RDP](https://learn.microsoft.com/en-us/windows-server/remote/remote-desktop-services/remote-desktop-uri): attributo `use redirection server name`.
