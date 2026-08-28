#!/usr/bin/env python3
"""Build the technical PDF report for this repository."""

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (
    Image,
    KeepTogether,
    PageBreak,
    Paragraph,
    Preformatted,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output" / "pdf" / "relazione-passthrough-gtx1050.pdf"
EVIDENCE = ROOT / "evidence" / "nvtop-glxgears-proof.png"


def on_page(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(colors.HexColor("#199B74"))
    canvas.setLineWidth(0.7)
    canvas.line(1.7 * cm, A4[1] - 1.35 * cm, A4[0] - 1.7 * cm, A4[1] - 1.35 * cm)
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#4B5563"))
    canvas.drawString(1.7 * cm, 0.95 * cm, "GTX 1050 Mobile Optimus passthrough - Proxmox")
    canvas.drawRightString(A4[0] - 1.7 * cm, 0.95 * cm, f"Pagina {doc.page}")
    canvas.restoreState()


def build():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    styles = getSampleStyleSheet()
    styles.add(
        ParagraphStyle(
            name="TitleGreen",
            parent=styles["Title"],
            fontName="Helvetica-Bold",
            fontSize=25,
            leading=30,
            textColor=colors.HexColor("#087F5B"),
            alignment=TA_CENTER,
            spaceAfter=18,
        )
    )
    styles.add(
        ParagraphStyle(
            name="HeadingGreen",
            parent=styles["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=15,
            leading=19,
            textColor=colors.HexColor("#087F5B"),
            spaceBefore=10,
            spaceAfter=7,
        )
    )
    styles.add(
        ParagraphStyle(
            name="Small",
            parent=styles["BodyText"],
            fontSize=8.6,
            leading=11,
        )
    )
    styles.add(
        ParagraphStyle(
            name="Reference",
            parent=styles["BodyText"],
            fontSize=7.4,
            leading=8.7,
            spaceAfter=0,
        )
    )
    styles.add(
        ParagraphStyle(
            name="Callout",
            parent=styles["BodyText"],
            backColor=colors.HexColor("#E9F8F1"),
            borderColor=colors.HexColor("#87D7B8"),
            borderWidth=0.5,
            borderPadding=9,
            leading=14,
            spaceBefore=6,
            spaceAfter=10,
        )
    )
    body = styles["BodyText"]
    body.fontSize = 10.2
    body.leading = 14.2
    code = ParagraphStyle(
        "Code", fontName="Courier", fontSize=7.5, leading=9.4, backColor=colors.HexColor("#F4F6F8"), borderPadding=6
    )
    doc = SimpleDocTemplate(
        str(OUT),
        pagesize=A4,
        rightMargin=1.7 * cm,
        leftMargin=1.7 * cm,
        topMargin=1.9 * cm,
        bottomMargin=1.55 * cm,
        title="GTX 1050 Mobile Optimus passthrough su Proxmox",
        author="Documentazione tecnica di recupero",
    )

    def p(text, style=body):
        return Paragraph(text, style)

    def h(text):
        return Paragraph(text, styles["HeadingGreen"])

    def bullets(items):
        return [p(f"- {item}") for item in items]

    story = []
    story += [Spacer(1, 2.0 * cm), p("GTX 1050 Mobile", styles["TitleGreen"])]
    story += [p("Passthrough Optimus su Proxmox", styles["TitleGreen"])]
    story += [Spacer(1, 0.45 * cm)]
    story += [
        p(
            "Relazione tecnica: diagnosi, recupero della VBIOS OEM, SSDT ACPI dinamica, switch idempotente tra VM Linux, Secure Boot e benchmark.",
            styles["Callout"],
        ),
        Spacer(1, 0.6 * cm),
    ]
    overview = [
        ["Componente", "Esito"],
        ["Portatile", "HP Pavilion Laptop 15-cs1xxx, scheda madre HP 856A"],
        ["Host", "Proxmox VE 9.1.5, kernel 6.17.9, IOMMU e VFIO attivi"],
        ["GPU", "NVIDIA GP107M GTX 1050 Mobile (Pascal), PCI ID 10de:1c8d"],
        ["Firmware", "VBIOS OEM HP inclusa nel repository privato, 169472 byte, 86.07.5F.00.2C"],
        ["Ubuntu", "Driver NVIDIA 580.173.02, 4096 MiB, nvidia-smi valido"],
        ["Kali", "SeaBIOS/Q35; switch reale Ubuntu -> Kali -> Ubuntu riuscito"],
        ["Switch VM", "Cleanup, discovery PCI/ACPI e SSDT riusciti in entrambe le direzioni"],
        ["Prova rendering", "Wayland/Xwayland: renderer GTX 1050; glxgears circa 60 FPS con VSync RDP"],
    ]
    table = Table(overview, colWidths=[4.2 * cm, 11.2 * cm])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#087F5B")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTNAME", (0, 1), (0, -1), "Helvetica-Bold"),
                ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#C7D4CF")),
                ("BACKGROUND", (0, 1), (-1, -1), colors.HexColor("#F7FCF9")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story += [table, Spacer(1, 0.55 * cm), p("Repository: proxmox-gtx1050-mobile-passthrough", styles["Small"]), PageBreak()]

    story += [h("1. Problema e criterio di successo")]
    story += [
        p(
            "Una GPU mobile Optimus non e una GPU desktop isolata: nel Pavilion 15-cs1xxx il display fisico resta normalmente collegato alla iGPU e il driver NVIDIA puo richiedere la propria VBIOS attraverso ACPI. hostpci assegna correttamente il dispositivo PCI, ma non aggiunge automaticamente un metodo ACPI _ROM: per questo il passthrough standard con una ROM PCI non era sufficiente.",
        ),
        p(
            "La GTX 1050 Mobile di questo caso usa GP107M, una GPU Pascal laptop con 640 CUDA core nella configurazione GTX 1050 e 4 GiB verificati nel guest. In Optimus la NVIDIA e render-only: puo accelerare CUDA/OpenGL/Vulkan, ma non ha necessariamente un CRTC o un connettore display assegnabile. La procedura e quindi mirata a NVIDIA mobile/Optimus e richiede una VBIOS OEM coerente; non e una soluzione universale per ogni GPU laptop.",
        ),
        p(
            "Il criterio di successo non e solo vedere una riga in lspci. La GPU deve essere assegnabile a una VM, il driver proprietario deve caricare, nvidia-smi deve riportare nome, driver e memoria, e un processo grafico deve usare realmente la GPU.",
        ),
        p(
            "Questa relazione distingue sempre [NODO] e [VM]. Il nodo Proxmox e il laptop fisico: possiede GPU, IOMMU e comandi qm/lspci/gpu-vm-switch. Ubuntu e Kali sono VM: qui vivono driver NVIDIA, nvidia-smi e MOK. noVNC e la console grafica Proxmox necessaria per schermate prima del kernel, come MOK Manager.",
            styles["Callout"],
        ),
        h("2. Termini fondamentali"),
    ]
    terms = [
        ["Host / guest / VMID", "Host: computer fisico Proxmox. Guest: computer virtuale. VMID: numero Proxmox della VM, qui Ubuntu 1001 e Kali 1000."],
        ["BDF", "Indirizzo PCI dominio:bus:device.funzione. La GPU host e 0000:02:00.0."],
        ["VBIOS / ROM", "Firmware della GPU; in questo caso il file .rom contiene la VBIOS OEM."],
        ["IOMMU e VFIO", "Isolano DMA e assegnano il dispositivo reale a QEMU invece che al driver host."],
        ["Optimus muxless", "La iGPU guida il pannello; NVIDIA e render-only e puo dipendere dai metodi ACPI della piattaforma."],
        ["ACPI", "Descrizione firmware dell'hardware e dei metodi richiamati dal sistema operativo."],
        ["ASL / AML / SSDT", "ASL e testo, AML e bytecode compilato, SSDT e tabella ACPI aggiuntiva."],
        ["_ROM", "Metodo ACPI che fornisce una porzione della ROM al driver, dati offset e dimensione."],
        ["fw_cfg", "Canale QEMU per fornire piccoli blob al guest; qui trasporta la VBIOS."],
        ["MOK", "Machine Owner Key: certificato da registrare prima del kernel per fidare moduli DKMS con Secure Boot."],
        ["OVMF / Q35 / QGA", "UEFI QEMU, chipset PCIe virtuale e Guest Agent usato per discovery e verifica nel guest."],
        ["nvidia-smi / nvtop / glxgears", "Stato driver/VRAM, monitor GPU e rendering OpenGL con FPS. Usati insieme, non sono la stessa prova."],
        ["dry-run / self-test", "Simulazione senza modifiche e compilazione/disassemblaggio AML di prova. Non sono benchmark del driver guest."],
    ]
    term_rows = [
        [Paragraph(f"<b>{name}</b>", styles["Small"]), Paragraph(description, styles["Small"])]
        for name, description in terms
    ]
    term_table = Table(term_rows, colWidths=[3.0 * cm, 12.4 * cm])
    term_table.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#D1D5DB")), ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#E9F8F1")), ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("FONTSIZE", (0, 0), (-1, -1), 8.8), ("LEADING", (0, 0), (-1, -1), 11), ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6), ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
    story += [term_table, PageBreak()]

    story += [h("2b. Prove reali: strumenti, risultati e limiti")]
    story += [
        p("Ogni prova e riportata con il suo strumento, per non presentare una semplice verifica di configurazione come benchmark o compatibilita universale."),
        Preformatted(
            "# [NODO] prerequisiti osservati\n"
            "cat /proc/cmdline\n"
            "test -d /sys/kernel/iommu_groups\n"
            "lspci -nnk -s 02:00.0\n"
            "gpu-vm-switch --self-test\n"
            "\n# [VM Ubuntu] driver osservato\n"
            "nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader",
            code,
        ),
    ]
    story += bullets(
        [
            "Nodo: flag IOMMU e gruppi presenti; lspci ha mostrato Kernel driver in use: vfio-pci.",
            "Generatore ACPI: gpu-vm-switch --self-test ha concluso self-test: ok. Prova AML, non il driver guest.",
            "Trasferimento reale: Ubuntu 1001 OVMF/Q35 -> Kali 1000 SeaBIOS/Q35 -> Ubuntu 1001; cleanup, discovery e SSDT sono riusciti in entrambe le direzioni.",
            "Ubuntu: nvidia-smi ha restituito NVIDIA GeForce GTX 1050, driver 580.173.02, 4096 MiB.",
            "Rendering: prima il display diagnostico :2 ha mostrato GLX NVIDIA; dopo il fix KMS il desktop Wayland/Xwayland restituisce NVIDIA GTX 1050. I circa 60 FPS di glxgears in RDP sono VSync, non benchmark di gioco.",
            "Secure Boot off: il codice/prompt sono stati esaminati ma la sostituzione EFI non e stata eseguita sulla Ubuntu principale; nessuna prova runtime viene rivendicata.",
        ]
    )
    story += [h("2c. Claim laptop: cosa si applica davvero")]
    story += bullets(
        [
            "Optimus muxless: coerente con il caso. La dGPU puo rendere senza guidare il pannello; non e stato mappato il cablaggio di ogni porta fisica del Pavilion.",
            "VBIOS: il file HP e integro (55 aa, PCIR, 10de:1c8d, 169472 byte). Qui non e stato tagliato alcun header UEFI: ROM BAR sola falliva, fw_cfg + SSDT _ROM funziona.",
            "FLR/reset: non e stato provato che manchi. Il test Ubuntu -> Kali -> Ubuntu senza reboot host dimostra che il reboot Proxmox non e obbligatorio in questo flusso; reset_method resta un controllo sysfs da eseguire senza scrivere reset.",
            "D3cold/_DSM: sono rischi laptop possibili ma la SSDT risolve _ROM, non emula metodi energetici proprietari. Non sono stati attribuiti come causa del guasto.",
            "IOMMU/ACS: VFIO richiede valutare il gruppo; lo script non usa ACS override. Code 43 e Windows-specifico e non e stato testato dai guest Linux.",
            "GVT-g, SR-IOV, Looking Glass e Sunshine/Moonlight sono alternative o trasporto display: non sostituiscono VFIO/VBIOS/ACPI e non sono stati installati qui.",
        ]
    )

    story += [h("3. Perche la soluzione ACPI era necessaria")]
    story += [
        p(
            "Il solo romfile espone una ROM nella configurazione PCI virtuale. Il driver della GTX 1050 Mobile, nel percorso Optimus, cerca invece _ROM nel device ACPI. Per questo rombar=1 mostrava byte ROM ma non risolveva l'inizializzazione del driver. VBIOS e file .rom sono qui lo stesso firmware; rombar e invece una finestra PCI virtuale, non il metodo ACPI.",
        ),
        p(
            "La soluzione passa lo stesso file VBIOS OEM mediante fw_cfg. Una SSDT in AML si aggancia al device della GPU, legge il file una volta, lo mantiene in un buffer e implementa _ROM restituendo il segmento richiesto. rombar=0 resta intenzionale.",
        ),
        Preformatted(
            "gtx1050_hp_native.rom sul nodo\n"
            "        |\n"
            "        v\n"
            "QEMU fw_cfg -> SSDT AML (buffer FWBI) -> _ROM(offset,length) -> driver NVIDIA",
            code,
        ),
        Preformatted(
            "0000:02:00.0\n"
            "|    |  |  +-- funzione 0: GPU\n"
            "|    |  +----- dispositivo 00\n"
            "|    +-------- bus 02\n"
            "+------------- dominio PCI 0000",
            code,
        ),
        h("4. PCI -> ACPI senza valori fissi"),
        p("Il guest restituisce la catena PCI con lspci -PP. Ogni hop viene convertito nel nome ACPI Sxx: valore = slot * 8 + funzione."),
        Preformatted(
            "00:1c.0/01:00.0\n"
            "1c.0 -> 0x1c * 8 + 0 = 0xe0 -> SE0\n"
            "00.0 -> 0x00 * 8 + 0 = 0x00 -> S00\n"
            "Scope finale: \\_SB.PCI0.SE0.S00",
            code,
        ),
        p("ASL e il testo generato; iasl lo compila in AML, il bytecode che QEMU carica. External dichiara il device gia presente nella DSDT, Scope lo apre, RINT legge fw_cfg nel buffer FWBI e _ROM restituisce Mid(FWBI, offset, length). Lo script avvia brevemente la VM, scopre questa topologia reale e genera la SSDT specifica della VM. Cosi il metodo puo adattarsi a un'altra NVIDIA mobile, se vengono indicati BDF host e VBIOS OEM corretti."),
        PageBreak(),
        h("4b. SSDT: lettura guidata"),
        Preformatted(
            "External (\\_SB.PCI0.SE0.S00, DeviceObj)  # device esistente\n"
            "Scope (\\_SB.PCI0.SE0.S00)                # aggiungi metodi alla GPU\n"
            "Name (FWIT, 0) / Name (FWBI, Buffer(){}) # flag + buffer VBIOS\n"
            "OperationRegion (... 0x510, 2)           # porte QEMU fw_cfg\n"
            "FISL (...)                                # trova nome e dimensione blob\n"
            "RINT ()                                   # carica una volta FWBI\n"
            "_ROM (offset,length) -> Mid(FWBI,...)     # risposta al driver",
            code,
        ),
        p("RWRD, RDWD e RBUF sono lettori rispettivamente a 16 bit, 32 bit e buffer; Serialized evita letture concorrenti. Il walkthrough del repository spiega ogni blocco e anche il limite a 4 KiB per richiesta _ROM."),
    ]

    story += [h("5. Switch GPU idempotente")]
    story += bullets(
        [
            "Prima del primo switch: --prepare-host installa acpica-tools/pciutils, installa la ROM OEM se diversa, aggiunge solo flag IOMMU/VFIO mancanti e aggiorna initramfs; il reboot e sempre esplicito.",
            "Menu numerato oppure --vm VMID; preflight di Q35, firmware, Guest Agent, BDF e ROM. Secure Boot viene letto nel guest prima del cleanup.",
            "Ramo idempotente: se una sola VM ha gia hostpci, SSDT, fw_cfg e nvidia-smi funzionante, il tool non modifica ne riavvia.",
            "Ricerca proprietario e cleanup mirato: soltanto hostpci della GPU, romfile/rombar collegati, argomenti SSDT/fw_cfg, CPU hidden e SSDT generata dal tool.",
            "Assegnazione alla destinazione, boot temporaneo con lspci -PP, conversione PCI->ACPI, ASL->AML e boot finale con -acpitable e -fw_cfg.",
            "Driver della distro, riavvio se serve, nvidia-smi e benchmark. Il trap finale riaccende la sorgente prima attiva senza GPU, anche dopo un errore.",
            "Nessuna conversione forzata di BIOS, OVMF, SeaBIOS, Q35 o vga: questi restano proprieta della VM.",
            "Se hostpci, SSDT/fw_cfg e nvidia-smi sono gia corretti nella VM richiesta, non opera ne riavvia; se resta solo MOK, non ricostruisce lo switch.",
            "Test reale completato: Ubuntu 1001 OVMF/Q35 -> Kali 1000 SeaBIOS/Q35 -> Ubuntu 1001; cleanup e SSDT sono stati rigenerati in entrambe le direzioni.",
        ]
    )
    story += [h("Comandi principali"), Preformatted(
        "gpu-vm-switch --prepare-host --rom-source ./firmware/gtx1050_hp_native.rom --yes\n"
        "gpu-vm-switch --prepare-host --rom-source ./firmware/gtx1050_hp_native.rom --reboot --yes\n"
        "gpu-vm-switch\n"
        "gpu-vm-switch --vm 1001 --yes\n"
        "gpu-vm-switch --vm 1001 --dry-run --yes\n"
        "gpu-vm-switch --gpu 0000:03:00 --rom /usr/share/kvm/oem.rom --vm 123 --yes\n"
        "gpu-vm-switch --vm 123 --skip-drivers --yes",
        code,
    )]
    story += [p("Driver automatici: Ubuntu, Debian, Kali, Arch, Fedora, RHEL, Rocky e AlmaLinux. Per Debian la sorgente contrib non-free non-free-firmware e aggiunta solo se non e gia presente; la logica gestisce anche il formato Deb822. Il BIOS del laptop resta l'unico prerequisito non automatizzabile: VT-d/AMD-Vi deve essere attivo prima del boot Proxmox.")]
    story += [PageBreak(), h("5b. Procedura riproducibile e criteri di prova"), Preformatted(
        "# nodo: prima di applicare\n"
        "sha256sum firmware/gtx1050_hp_native.rom\n"
        "lspci -nnk -s 0000:02:00.0\n"
        "gpu-vm-switch --prepare-host --rom-source ./firmware/gtx1050_hp_native.rom --dry-run --yes\n"
        "\n# nodo: applicazione e controllo dopo reboot\n"
        "gpu-vm-switch --prepare-host --rom-source ./firmware/gtx1050_hp_native.rom --yes\n"
        "cat /proc/cmdline; lspci -nnk -s 0000:02:00.0; gpu-vm-switch --self-test\n"
        "\n# switch: simulazione, applicazione, prova driver\n"
        "gpu-vm-switch --vm 1001 --dry-run --yes\n"
        "gpu-vm-switch --vm 1001 --yes\n"
        "qm guest exec 1001 -- /usr/bin/nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader",
        code,
    )]
    story += [p("La sequenza e deliberatamente divisa in inventario, dry-run, applicazione e osservazione. Il risultato positivo richiede: hash ROM atteso, IOMMU e vfio-pci dopo reboot, self-test AML riuscito, hostpci con args SSDT/fw_cfg e nvidia-smi con exitcode 0. nvidia-glxgears e nvtop provano poi il rendering. Il runbook del repository aggiunge comandi esatti per QEMU Guest Agent, Secure Boot/MOK, prova Ubuntu -> Kali -> Ubuntu e condizioni in cui fermarsi; il validatore documentale non viene spacciato per prova hardware.")]
    story += [h("6. Secure Boot senza automazione fittizia")]
    story += [
        p(
            "MOK non e NVIDIA e non e una password Linux. Secure Boot e la politica UEFI della VM; DKMS puo compilare nvidia.ko localmente e firmarlo con una chiave nuova; MOK (Machine Owner Key) e il certificato pubblico autorizzato dal proprietario; shim porta quella autorizzazione nella catena Linux.",
            styles["Callout"],
        ),
        p("Se il pacchetto contiene un modulo gia firmato da una chiave fidata, MOK non compare. Il caso MOK e: driver installato -> DKMS compila e firma -> il kernel non conosce ancora il certificato pubblico -> il modulo e rifiutato. La password temporanea di mokutil protegge solo la richiesta pendente fino al reboot; non firma il modulo e non e la password dell'account."),
        Preformatted(
            "script: legge Secure Boot prima del cleanup -> installa driver se manca -> prova nvidia-smi\n"
            "  -> se fallisce con Secure Boot: stampa istruzioni, ma non esegue mokutil --import\n"
            "  -> utente: mokutil --import certificato.der -> reboot\n"
            "  -> UEFI avvia shim; MOK Manager prima del kernel\n"
            "  -> Enroll MOK -> Continue -> Yes + password temporanea\n"
            "  -> reboot: shim rende la chiave disponibile, modulo ammesso, nvidia-smi\n"
            "  -> gpu-vm-switch --mok-manual: sola verifica idempotente",
            code,
        ),
        p("Lo script legge lo stato reale nel guest con mokutil oppure con la variabile EFI SecureBoot prima del cleanup e dopo QEMU Guest Agent. Nel menu interattivo propone Secure Boot off; con --yes non lo cambia mai senza --disable-secure-boot. Con --mok-manual conserva Secure Boot: soltanto se il controllo finale nvidia-smi fallisce, lascia GPU/SSDT/fw_cfg invariati, mostra chiavi pendenti e cerca certificati DKMS per noVNC; l'import e la schermata MOK restano manuali."),
        Preformatted("gpu-vm-switch --vm 123 --mok-manual\n"
                     "gpu-vm-switch --vm 123 --disable-secure-boot --yes", code),
        p("MOK Manager e prima del kernel: SSH, rete e QEMU Guest Agent non possono premere tasti; appare solo se una richiesta e pendente. L'alternativa Secure Boot off e permanente e solo OVMF/efidisk0 4m. Prima crea EFI/BOOT/BOOTX64.EFI, copia variabili e metadata in /usr/share/kvm/optimus-gpu-switch/efi-backups/ e sostituisce efidisk0 con un template senza chiavi; l'originale rimane unused. Il rollback resta attivo fino al primo boot con Guest Agent. Questo evita MOK ma abbassa la protezione della catena di boot e non e stato eseguito sulla Ubuntu principale: usare snapshot e noVNC."),
        PageBreak(),
        h("6 - Accesso RDP Wayland della VM Ubuntu"),
        p("Il primo server RDP era xrdp/xorgxrdp: autenticava ma apriva una sessione X11. GNOME 50 richiedeva XDG_SESSION_TYPE=wayland e terminava la sessione, causando finestra nera/disconnessione. Il fallback Flashback X11 ha mostrato il desktop, ma non e la soluzione Wayland. Il 2026-08-27 sono stati rimossi Flashback, xrdp, xorgxrdp, file di sessione e processi X11 orfani. L'autoremove non e stato eseguito: il driver 580 attivo e stato poi marcato manuale e una simulazione non propone pacchetti NVIDIA."),
        p("E stato configurato GNOME Remote Desktop 50.2 in modalita system (Remote Login): gnome-remote-desktop-daemon e attivo sulla porta 3389. Il client e sempre mstsc.exe Windows: il profilo RDSTLS UTF-16 fornisce use redirection server name:i:1 e audiomode:i:0 per riprodurre l'audio remoto sul PC. L'audio playback e stato ascoltato e confermato manualmente dall'utente. Il 2026-08-27 e stata trovata la causa della differenza tra file e GUI: Documents\\Default.rdp, il profilo nascosto della GUI mstsc, aveva use redirection server name:i:0. Dopo il redirect GNOME il client sceglieva NLA e il server riportava SAM database/SEC_E_NO_CREDENTIALS, non un guasto GPU. Il valore e stato corretto e verificato a :i:1; quindi anche digitando l'IP nella app preinstallata eredita RDSTLS. Il server emette davvero Sending server redirection e avvia il greeter/handover. Nello stesso giorno e stato creato lo snapshot Proxmox pre-rdp-handover-backport-20260827 e installato il backport locale gnome-settings-daemon 50.0-1ubuntu1+rdphandover1: una guardia impedisce a gsd-sharing di spegnere il servizio di hand-over mentre il daemon RDP di sistema e vivo. Il test visivo diretto mstsc greeter->desktop dopo questa correzione resta da ripetere. Nessun PPA e stato installato."),
    ]

    story += [h("7. Benchmark e prova di rendering")]
    story += [
        p("glmark2 da SSH ha fallito con Could not initialize canvas: e previsto, perche glmark2 X11 necessita un display. Il DRM della GPU mobile render-only non offre un CRTC utile al test. E stato quindi creato Xorg NVIDIA headless su :2 e il wrapper nvidia-glxgears: e un display diagnostico, non il desktop Wayland."),
        Preformatted(
            "# Nel terminale della sessione RDP/Wayland\n"
            "glxinfo -B | grep -E 'OpenGL vendor|OpenGL renderer'\n"
            "# NVIDIA Corporation / NVIDIA GeForce GTX 1050/PCIe/SSE2\n"
            "glxgears  # circa 60 FPS: sincronizzato a VSync RDP\n"
            "__GL_SYNC_TO_VBLANK=0 glxgears  # solo contatore non sincronizzato\n"
            "watch -n 1 nvidia-smi\n"
            "nvtop",
            code,
        ),
        p("La causa del software rendering era nvidia_drm modeset=0 in due vecchi file locali, non VFIO o la VBIOS. Dopo modeset=1, initramfs e reboot, GNOME seleziona nvidia-drm primario e Xwayland usa NVIDIA. htop non visualizza i contatori NVIDIA perche legge CPU e RAM; nvidia-smi e nvtop interrogano invece driver e GPU."),
    ]
    if EVIDENCE.exists():
        image = Image(str(EVIDENCE))
        image._restrictSize(16.3 * cm, 9.9 * cm)
        story += [Spacer(1, 0.25 * cm), KeepTogether([image, Spacer(1, 0.12 * cm), p("Figura 1 - precedente prova sul display diagnostico Xorg :2: prova renderer, non benchmark universale.", styles["Small"])])]
    story += [
        PageBreak(),
        h("7b. Omarchy: desktop headless GTX e Moonlight"),
        p(
            "Il 28 agosto 2026 e stato verificato un percorso distinto dal precedente desktop VirtIO: Hyprland usa AQ_DRM_DEVICES=/dev/dri/gtx1050 e AQ_NO_KMS_REQUIREMENT=1 e crea l'uscita Wayland headless omarchy-gtx. Il fallback inattivo e 1920x1200/60; ogni nuova apertura Desktop in Moonlight passa larghezza, altezza e FPS a Sunshine, che invoca un helper Lua Hyprland e imposta l'uscita prima della cattura. Il campione HEVC ha mostrato 60.19 FPS, host processing latency 7.6/8.8/7.9 ms e 0% frame persi; nvidia-smi pmon ha mostrato Hyprland come processo grafico della GTX e Sunshine con enc=28. Il mismatch precedente era GBM 1920x1080/client 1920x1200.",
        ),
        Preformatted(
            "Moonlight W x H x FPS -> Sunshine Desktop prep -> hl.monitor(omarchy-gtx)\n"
            "GTX -> Hyprland -> omarchy-gtx -> Sunshine GBM/Wayland -> h264_nvenc o hevc_nvenc -> Moonlight\n"
            "prova: Hyprland nella tabella NVIDIA; Sunshine enc>0 durante lo stream",
            code,
        ),
        p(
            "L'output QEMU VirtIO rimane nel file Proxmox soltanto come console noVNC di recupero: non e selezionato dal compositor. Non e stato quindi eseguito vga:none senza un'ulteriore prova utente; questa scelta preserva una strada di rollback. Il tentativo di forzare una EDID sul connettore NVIDIA disconnesso aveva lasciato guest SSH e QEMU Guest Agent non raggiungibili ed e stato rimosso, non mantenuto.",
        ),
        p(
            "Il build stabile precedente, compatibile con il driver Pascal 580, aveva SUNSHINE_ENABLE_CUDA=OFF e forzava frame NV12 in RAM per evitare un errore di scala: NVENC restava hardware ma la CPU non era zero. Nel test Sunshine era circa al 51% di una CPU logica, mentre Hyprland circa al 3-4%; htop puo mostrare i thread separati e non devono essere sommati. Il pacchetto Sunshine Arch ufficiale e stato provato e subito annullato: h264_nvenc ha fallito per reference frames non supportati sulla GTX 1050 ed e ricaduto a libx264 software.",
        ),
        p(
            "Il comando dinamico non usa hyprctl keyword: Omarchy/Hyprland 0.56 usa la configurazione Lua e keyword e un parser legacy che non modifica il monitor. Il test reale di hyprctl eval hl.monitor(...) ha cambiato omarchy-gtx da 1920x1200 a 1920x1080@60 e lo ha ripristinato senza riavvio. Una sola uscita resta condivisa: due client contemporanei non ricevono due risoluzioni indipendenti. GameStream non prevede clipboard guest-verso-client: Ctrl+Alt+Shift+V invia testo dal client al guest; una clipboard bidirezionale richiede un secondo canale fidato. Per TV si usa Moonlight (mirror interattivo/NVENC), non DLNA che serve solo file multimediali.",
        ),
        p(
            "Il profilo Moonlight Windows era 1920x1200/60 a 23000 kbps. Il primo 40 Mbps fisso era solo una prova diagnostica: il tool ora replica il default Moonlight e riabilita autoadjustbitrate, che per 1920x1200/60/YUV 4:4:4 calcola 46000 kbps. Il flag ricalcola al cambio di formato, non reagisce al jitter frame per frame; il target non misura i byte precisi sul cavo. NVENC enc=28, enc=30 in nvidia-smi pmon e 38% in NVTOP sono occupazione dell'encoder, non Mbps o utilizzo totale GPU. Per clipboard reale KDE Connect e installato, paired fra Omarchy e Windows e autorizzato solo sulla LAN TCP/UDP 1714-1764; ogni PC futuro richiede pairing manuale. La GTX resta assegnabile a una VM sola: GTX 1050 Mobile non e vGPU NVIDIA supportata e vGPU Unlock non e stato installato.",
        ),
        p(
            "Il 28 agosto 2026 e stato compilato in un percorso separato un canary Sunshine con CUDA 12.8 e GCC 14 isolati: compila cuda.cu con --generate-code per sm_61, ha SUNSHINE_ENABLE_CUDA=ON ed e installato in /opt/sunshine-cuda12. La drop-in 29-cuda12-canary.conf lo rende attivo soltanto se Sunshine trova h264_nvenc; puo essere ritirata in modo idempotente da omarchy-sunshine-cuda12-canary rollback. Il probe ha inoltre trovato hevc_nvenc: Sunshine ora rileva automaticamente HEVC e lascia H.264 come fallback, mentre AV1 resta disabilitato perche Pascal non lo codifica in hardware. CUDA non attiva NVENC, ma puo mantenere in VRAM la superficie catturata prima dell'encoder e ridurre copie CPU/RAM. Il campione runtime prova HEVC/NVENC; non dichiara zero-copy o una riduzione CPU finche non viene confrontato con un campione equivalente. Il preset P3 e mantenuto: 7.9 ms host e zero drop non richiedono P2/P1. CUDA 13 non puo compilare offline per Pascal compute capability 6.1.",
        ),
    ]
    story += [h("8. Estrazione della VBIOS OEM")]
    story += [
        p("Il punto di partenza e il pacchetto driver/firmware ufficiale HP per il Pavilion 15-cs1xxx, estratto localmente fino al payload, per esempio 084C0.bin. Lo script Python non scarica nulla: cerca la signature PCI option ROM 55 aa, verifica PCIR, vendor NVIDIA e device 1c8d. Scansiona il payload RAW e stream LZMA, quindi estrae tutte le immagini della ROM fino al flag finale."),
        Preformatted(
            "python3 scripts/extract_gtx1050_rom.py /tmp/084C0.bin \\\n  --device-id 1c8d \\\n  --output /usr/share/kvm/gtx1050_hp_native.rom",
            code,
        ),
        p("Per rendere riproducibile questo laboratorio privato, la ROM estratta e inclusa come firmware/gtx1050_hp_native.rom: 169472 byte, VBIOS 86.07.5F.00.2C, SHA-256 33abd3bc3f658b0536da0617a76076b56e5af124701271211d6d127cda22c322. E firmware OEM, non universale: verificare licenza e usare --force solo dopo confronto di vendor, device ID e origine del payload."),
        h("9. Tentativi che non hanno risolto il problema"),
    ]
    failed = [
        ["Solo romfile / rombar", "Il driver Optimus non leggeva la ROM dalla sola finestra PCI.", "SSDT _ROM + fw_cfg."],
        ["ACPI scritto a mano", "Cambiando bridge cambia lo scope del device.", "Discovery lspci -PP e conversione Sxx."],
        ["glmark2 via SSH", "Mancava un canvas X11.", "Xorg NVIDIA :2 e glxgears."],
        ["Wayland con llvmpipe", "Due override locali disabilitavano nvidia_drm KMS.", "modeset=1, initramfs, reboot e glxinfo NVIDIA."],
        ["Autoremove NVIDIA", "Pacchetti attivi potevano essere automatici.", "apt-mark manual e simulazione pulita; script lo fa dopo install."],
        ["Prima installazione Kali", "Headers/DKMS non pronti.", "Headers, build tools, DKMS e riavvio."],
        ["Repo Debian riscritta", "Automazione non idempotente.", "Verifica componenti prima di aggiungere."],
    ]
    failed_rows = [
        [Paragraph(cell, styles["Small"]) for cell in row]
        for row in failed
    ]
    failed_header = [
        Paragraph("<b>Tentativo</b>", styles["Small"]),
        Paragraph("<b>Perche falliva</b>", styles["Small"]),
        Paragraph("<b>Correzione</b>", styles["Small"]),
    ]
    failed_table = Table([failed_header] + failed_rows, colWidths=[4.0 * cm, 5.7 * cm, 5.7 * cm])
    failed_table.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#087F5B")), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white), ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#D1D5DB")), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("FONTSIZE", (0, 0), (-1, -1), 7.4), ("LEADING", (0, 0), (-1, -1), 8.7), ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4), ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]))
    story += [failed_table, Spacer(1, 0.2 * cm)]
    story += [h("10. Ripetere il procedimento")]
    story += [
        p(
            "Checklist: verificare IOMMU/VFIO e audio; estrarre la VBIOS OEM e controllare BDF/PCI ID; "
            "configurare Q35 e Guest Agent; usare gpu-vm-switch con --gpu e --rom; testare il renderer "
            "con nvidia-glxgears su display NVIDIA headless; scegliere consapevolmente MOK oppure "
            "--disable-secure-boot per OVMF.",
            styles["Small"],
        )
    ]
    story += [h("Riferimenti")]
    story += [
        p("QEMU fw_cfg: https://qemu-project.gitlab.io/qemu/specs/fw_cfg.html", styles["Reference"]),
        p("ACPI: https://uefi.org/acpi/specs", styles["Reference"]),
        p("Proxmox VE Administration Guide: https://pve.proxmox.com/pve-docs/pve-admin-guide.html", styles["Reference"]),
        p("NVIDIA driver kernel modules: https://docs.nvidia.com/datacenter/tesla/driver-installation-guide/kernel-modules.html", styles["Reference"]),
        p("NVIDIA GTX 1050 laptop / Pascal: https://www.nvidia.com/en-us/geforce/news/nvidia-geforce-gtx-1050-laptops/", styles["Reference"]),
        p("Linux kernel VFIO: https://docs.kernel.org/driver-api/vfio.html", styles["Reference"]),
        p("Linux PCI reset sysfs ABI: https://docs.kernel.org/6.10/admin-guide/abi-testing.html", styles["Reference"]),
        p("NVIDIA Optimus Linux: https://download.nvidia.com/XFree86/Linux-x86_64/455.28/README/optimus.html", styles["Reference"]),
        p("NVIDIA PRIME Render Offload: https://download.nvidia.com/XFree86/Linux-x86_64/575.64/README/primerenderoffload.html", styles["Reference"]),
        p("Intel i915 / GVT-g: https://docs.kernel.org/next/gpu/i915.html", styles["Reference"]),
        p("ACPICA / iasl: https://acpica.org/", styles["Reference"]),
        p("NVIDIA CUDA 13 release notes: https://docs.nvidia.com/cuda/archive/13.0.0/cuda-toolkit-release-notes/index.html", styles["Reference"]),
        p("NVIDIA CUDA architecture / driver matrix: https://docs.nvidia.com/datacenter/tesla/drivers/cuda-toolkit-driver-and-architecture-matrix.html", styles["Reference"]),
        p("Sunshine build documentation: https://github.com/LizardByte/Sunshine/blob/master/docs/building.md", styles["Reference"]),
        p("Sunshine app prep commands / client resolution variables: https://github.com/LizardByte/Sunshine/blob/master/docs/app_examples.md", styles["Reference"]),
        p("Hyprland monitors Lua API: https://wiki.hypr.land/Configuring/Basics/Monitors/", styles["Reference"]),
        p("Moonlight setup and text input: https://github.com/moonlight-stream/moonlight-docs/wiki/Setup-Guide", styles["Reference"]),
    ]
    doc.build(story, onFirstPage=on_page, onLaterPages=on_page)
    print(OUT)


if __name__ == "__main__":
    build()
