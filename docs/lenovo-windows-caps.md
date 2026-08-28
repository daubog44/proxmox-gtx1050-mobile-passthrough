# Caps Lock sul client Lenovo Windows

Questa nota riguarda il **laptop Lenovo con Windows dal quale si usa
Moonlight**, non la VM Omarchy e non Proxmox.

## Diagnosi eseguita

Nel computer locale sono presenti:

- il servizio `LenovoFnAndFunctionKeys` (*Lenovo Fn and function keys service*);
- `LenovoUtilityService.exe`, eseguito dal servizio;
- `FnHotkeyCapsLKNumLK.exe`, suo processo figlio;
- la chiave
  `HKLM\SYSTEM\CurrentControlSet\Services\LenovoFnAndFunctionKeys\VantageToast`.

La chiave contiene `ShowCapslkOSD=1`: e' il flag dell'OSD centrale con l'icona
`abc`. L'OSD non e' generato da Windows in generale, da Moonlight, da Hyprland
o da keyd: e' la funzione Lenovo distribuita insieme al driver dei tasti Fn.

Il LED fisico del tasto Caps e' un'altra cosa: riflette lo stato Caps Lock del
dispositivo HID/Windows. `FnHotkeyCapsLKNumLK.exe` osserva e visualizza questo
stato, ma non offre un'API separata e sicura per comandare solo il LED. Per
questo non bisogna cancellare l'eseguibile dal `DriverStore`: Windows Update
potrebbe ripristinarlo e si romperebbero aggiornamenti o tasti Fn del modello.

## Correzione mirata dell'OSD

Apri **PowerShell** nella cartella del repository:

```powershell
.\clients\lenovo-caps-osd.ps1 -Show
.\clients\lenovo-caps-osd.ps1 -DisableCapsOsd
```

Il secondo comando chiede UAC, imposta solamente `ShowCapslkOSD` a `0` e
riavvia il servizio Lenovo. E' idempotente: ripeterlo lascia il valore a `0`.
Non disattiva Num Lock OSD, non rimuove file e conserva i tasti Fn.

Per annullare:

```powershell
.\clients\lenovo-caps-osd.ps1 -EnableCapsOsd
```

La verifica riproducibile deve mostrare `CapsOsdEnabled : False`:

```powershell
.\clients\lenovo-caps-osd.ps1 -Show
```

## Perche non si spegne tutto il servizio

Questa alternativa e' disponibile solo come ultima risorsa:

```powershell
.\clients\lenovo-caps-osd.ps1 -DisableLenovoService
```

Rimuove anche l'OSD, ma puo' togliere funzioni Fn proprietarie (ad esempio
profili termici, microfono o tasti speciali, a seconda del modello). Il
ripristino e':

```powershell
.\clients\lenovo-caps-osd.ps1 -EnableLenovoService
```

## LED e combinazioni tenute

Se il LED si accende mentre Caps e' fisicamente tenuto in una combinazione,
quello e' il comportamento locale della tastiera Windows: il sistema vede
comunque Caps Lock prima che l'evento arrivi a Moonlight. Il flag OSD risolve
il popup, ma non puo' trasformare il LED in un indicatore del layer Super
remoto. Per farlo occorre intercettare il tasto **sul client Windows** e
ridisegnare l'input prima di Moonlight; e' una configurazione separata e va
validata sul laptop fisico per evitare di interferire con la digitazione
normale. Non e' corretto attribuire questo limite a Omarchy.
