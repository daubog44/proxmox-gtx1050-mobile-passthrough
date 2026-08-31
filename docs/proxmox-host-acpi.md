# Errori ACPI periodici sulla console fisica PVE

Questo riguarda il **nodo Proxmox HP Pavilion 15-cs1xxx**, non la VM Omarchy.
Il kernel PVE `6.17.9-1-pve` riceve periodicamente un evento dal controller
integrato del portatile (EC) e prova a valutare il metodo firmware
`\_SB.PCI0.LPCB.EC0._Q33`. Quel metodo HP accede alla regione ACPI `CMS0`
(`SystemCMOS`), per la quale il kernel non possiede un handler; quindi ACPI lo
interrompe con `AE_NOT_EXIST`. Le righe successive “No Local Variables” e “No
Arguments” sono diagnostica del medesimo metodo abortito, non errori autonomi.

L'osservazione sul nodo e' stata: BIOS HP **F.23** del 25 dicembre 2020 e
ricorrenza quasi esatta di circa 30 minuti. Non c'e' un timer systemd, un
evento QEMU o un processo della VM associato al momento dei messaggi. Perciò
non e' causato da VFIO, dalla GPU passthrough, Moonlight o Omarchy.

## Cosa fare, nell'ordine corretto

1. Controllare nella pagina HP per lo SKU del portatile se esiste un BIOS più
   recente di F.23. HP ha pubblicato F.24 / SoftPaq `SP135625` per la famiglia
   Pavilion 15-cs1xxx. La nota ufficiale non elenca funzionalità utente,
   correzioni ACPI, GPU o virtualizzazione: dichiara un aggiornamento di
   sicurezza per la utility firmware Insyde (dicembre 2021). Quindi F.24 ha
   senso come aggiornamento di sicurezza e come unico tentativo ragionevole
   di correggere il firmware alla fonte, **non** come fix `_Q33` promesso.
   L'aggiornamento BIOS resta manuale, con alimentatore collegato e backup,
   non un comando Proxmox automatico.
2. Dopo l'eventuale aggiornamento, verificare dal nodo con
   `journalctl -k -b | rg 'SystemCMOS|EC0._Q33'`. L'assenza di nuove righe per
   più di un intervallo di 30 minuti è la prova utile.
3. Se HP non offre un aggiornamento più recente o non risolve, lasciare il
   comportamento documentato: il kernel sta già fermando il solo metodo
   difettoso. Non impostare `quiet`, `loglevel=3`, `acpi=off`, `acpi_osi=` o
   blacklist ACPI: nasconderebbero messaggi importanti o possono rompere
   batteria, termiche, sospensione e gestione energia del nodo.

La pubblicazione HP che elenca F.24 per Pavilion 15-cs1xxx è
[HPSBHF03759](https://support.hp.com/at-de/document/ish_5242666-5276882-16/hpsbhf03759).
Non dimostra che F.24 corregga `_Q33`: dimostra soltanto che F.23 non è
l'ultimo firmware noto per la famiglia. La verifica post-aggiornamento resta
necessaria.
