# Tutorial pratico: tiling manager Omarchy / Hyprland

Omarchy usa Hyprland: non e' un desktop in cui si trascina ogni finestra a
mano, ma un compositor **tiling**. Quando apri una finestra, Hyprland assegna
automaticamente spazio alle finestre del workspace; le scorciatoie cambiano
focus, posizione, dimensione o modalita' della finestra senza cercare il mouse.

Nel setup documentato **Caps Lock e' il tasto `SUPER`**. Quindi ogni volta che
questa guida dice `SUPER`, premi Caps Lock insieme al secondo tasto. I numeri
sono i tasti fisici della riga superiore, non il tastierino numerico.

![Tre tile reali nello stesso workspace: nvtop sopra, Sandustry sotto a sinistra e btop sotto a destra.](../evidence/omarchy-tiling-sandustry-nvtop.png)

Lo screenshot e' una prova del layout reale su `omarchy-gtx`: Sandustry occupa
un tile, `nvtop` uno largo e `btop` il terzo. Nello stesso campione `nvtop`
mostra Sandustry come processo grafico NVIDIA: il tiling non impedisce alla GTX
di renderizzare il gioco.

## Il modello mentale

```text
monitor omarchy-gtx
  └─ workspace attivo (1, 2, 3, ...)
       ├─ tile/finestra A
       ├─ tile/finestra B
       └─ tile/finestra C

special:scratchpad
  └─ pannello temporaneo, per esempio Steam
```

- Un **workspace** e' una scrivania separata. Puoi lasciare terminali e
  monitoraggio su uno, Steam su un altro e il gioco su un terzo.
- Un **tile** e' una finestra gestita automaticamente nel workspace corrente.
- La finestra **attiva** riceve tastiera e comandi di spostamento/ridimensionamento.
- Lo **scratchpad** e' un workspace speciale che appare sopra quello normale:
  in questo setup Steam puo' stare li' e coprire temporaneamente un gioco.

## Le scorciatoie da imparare per prime

| Operazione | Scorciatoia | Risultato |
| --- | --- | --- |
| Cambiare focus | `SUPER` + frecce | Seleziona il tile a sinistra/destra/sopra/sotto. |
| Chiudere | `SUPER + W` | Chiude la finestra attiva. |
| Cambiare workspace | `SUPER + 1` ... `SUPER + 0` | Va al workspace 1 ... 10. |
| Portare la finestra altrove | `SUPER + SHIFT + 1` ... `0` | Sposta la finestra attiva e la segue. |
| Spostare senza seguirla | `SUPER + SHIFT + ALT + 1` ... `0` | La manda altrove, ma tu rimani qui. |
| Workspace successivo/precedente | `SUPER + TAB` / `SUPER + SHIFT + TAB` | Scorre gli workspace. |
| Tornare a quello precedente | `SUPER + CTRL + TAB` | Alterna rapidamente fra due workspace. |
| Ciclo finestre | `ALT + TAB` | Focus sulla prossima finestra. |

Per il lavoro quotidiano il ciclo piu' utile e': apri un terminale, apri il
secondo programma, poi `Caps + freccia` per passare da uno all'altro. Non serve
massimizzare ogni finestra: il layout distribuisce gia' lo spazio.

## Cambiare forma al layout

`SUPER + L` cambia **solo il workspace attivo** fra:

- **dwindle**: ogni nuova finestra divide ricorsivamente una porzione del
  layout. E' adatto a terminale, browser, editor e pannelli di controllo.
- **scrolling**: le finestre sono organizzate lungo una direzione e puoi
  attraversarle. E' comodo quando tieni molte finestre della stessa categoria.

Omarchy salva questa preferenza in
`~/.local/state/omarchy/workspace-layouts/<numero>.lua`, quindi resta dopo il
logout. Non cambia gli altri workspace.

`SUPER + J` alterna la direzione dello split della finestra attiva: usalo se la
prossima finestra dovrebbe comparire sotto invece che a fianco, o viceversa.

## Cambiare una finestra senza romperne il layout

| Obiettivo | Scorciatoia |
| --- | --- |
| Rendere flottante / tornare a tile | `SUPER + T` |
| Fullscreen reale | `SUPER + F` |
| Fullscreen mantenendo il tile | `SUPER + CTRL + F` |
| Larghezza massima | `SUPER + ALT + F` |
| Tenere una finestra sopra alle altre | `SUPER + O` |
| Salvare/ripristinare larghezza | `SUPER + ALT + HOME` / `SUPER + HOME` |
| Scambiare con il tile vicino | `SUPER + SHIFT` + frecce |

Per regolare una divisione usa i tasti `,` e `.` fisici:

- `SUPER + ,` / `SUPER + .`: modifica larghezza di 100 px;
- aggiungi `ALT`: passi di 25 px;
- aggiungi `CTRL`: passi di 300 px;
- aggiungi `SHIFT`: modifica l'altezza.

Con mouse: `SUPER` + trascinamento sinistro muove una finestra flottante;
`SUPER` + trascinamento destro la ridimensiona.

## Scratchpad, Steam e giochi

`SUPER + S` mostra/nasconde `special:scratchpad`; `SUPER + ALT + S` sposta la
finestra attiva nello scratchpad senza seguirla. Nel test Sandustry era corretto
e fullscreen nel workspace 2, ma Steam era visibile nello scratchpad sopra al
gioco. La soluzione non era cambiare driver o chiudere il gioco:

```text
Caps + S       nasconde Steam scratchpad
Caps + 2       torna al workspace dove e' Sandustry
Caps + F       fullscreen del gioco, se non lo e' gia'
```

Una routine ordinata per Moonlight e': workspace 1 monitoraggio, workspace 2
gioco, scratchpad Steam. Quando un gioco parte, chiudi/nascondi Steam con
`Caps + S`; per ritornare alla libreria premi di nuovo `Caps + S`.

## Gruppi e monitor multipli

Un gruppo e' un set di finestre nello stesso spazio del tile, simile a tab:

- `SUPER + G`: crea/rimuove un gruppo;
- `SUPER + ALT + TAB`: finestra successiva nel gruppo;
- `SUPER + ALT + SHIFT + TAB`: precedente;
- `SUPER + ALT` + frecce: inserisce la finestra nel gruppo vicino;
- `SUPER + ALT + G`: estrae la finestra dal gruppo.

Con piu' monitor, `SUPER + SHIFT + ALT` + frecce sposta l'intero workspace sul
monitor indicato; `CTRL + ALT + TAB` passa il focus al monitor successivo.
Nella VM attuale esiste il monitor headless `omarchy-gtx`, quindi questi comandi
non creano un secondo desktop Moonlight: diventano utili se in futuro aggiungi
un secondo output Wayland.

## Come controllare lo stato reale

Da un terminale della sessione grafica:

```bash
hyprctl activeworkspace -j
hyprctl activewindow -j
hyprctl clients -j
```

Il terzo comando elenca per ogni finestra workspace, coordinate, dimensioni,
classe, titolo e stato fullscreen. E' lo strumento corretto quando un programma
sembra “sparito”: prima cercare workspace e scratchpad, poi attribuire il
problema a Steam, Moonlight o ai driver.

La sorgente dei binding preinstallati e'
`/usr/share/omarchy/default/hypr/bindings/tiling.lua`. Per aggiunte personali
usare `~/.config/hypr/bindings.lua`; non modificare il file sotto `/usr/share`,
perche' un update Omarchy lo puo' sostituire. Il file personale e' letto dopo i
default: per cambiare una scorciatoia, prima esegui `hl.unbind(...)`, poi
aggiungi il nuovo `o.bind(...)`.
