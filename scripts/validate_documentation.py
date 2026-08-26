#!/usr/bin/env python3
"""Check documented glossary coverage, local links, diagrams and OEM ROM identity."""

from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ROM = ROOT / "firmware" / "gtx1050_hp_native.rom"
EXPECTED_ROM_SHA256 = "33abd3bc3f658b0536da0617a76076b56e5af124701271211d6d127cda22c322"
EXPECTED_ROM_SIZE = 169472


def require(text: str, terms: tuple[str, ...], label: str) -> None:
    missing = [term for term in terms if term not in text]
    if missing:
        raise AssertionError(f"{label}: contenuti mancanti: {', '.join(missing)}")


def main() -> None:
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    glossary = (ROOT / "docs" / "glossary.md").read_text(encoding="utf-8")
    walkthrough = (ROOT / "docs" / "acpi-line-by-line.md").read_text(encoding="utf-8")
    runbook = (ROOT / "docs" / "reproducible-runbook.md").read_text(encoding="utf-8")
    claims = (ROOT / "docs" / "laptop-passthrough-claim-matrix.md").read_text(
        encoding="utf-8"
    )

    require(
        glossary,
        (
            "**BDF**",
            "**VBIOS**",
            "**IOMMU / VT-d / AMD-Vi**",
            "**VFIO**",
            "**ACPI**",
            "**DSDT**",
            "**SSDT**",
            "**ASL**",
            "**AML**",
            "**`_ROM(offset, length)`**",
            "**`fw_cfg`**",
            "**MOK**",
            "## Idempotenza",
        ),
        "glossario",
    )
    require(
        readme,
        (
            "## Prima dei comandi: dove sei e cosa stai guardando",
            "## Dizionario essenziale: nessun gergo sottinteso",
            "### I comandi e le opzioni usati nei test",
            "## Cosa e stato testato davvero: comando, macchina, risultato e limite",
            "**[NODO]**",
            "**[VM]**",
            "Kernel driver in use: vfio-pci",
            "NVIDIA GeForce GTX 1050, 580.173.02, 4096 MiB",
            "Nessuna prova runtime dichiarata.",
            "## Perche funziona in questo HP, in sette passaggi",
            "docs/laptop-passthrough-claim-matrix.md",
            "Ubuntu -> Kali -> Ubuntu",
            "file gtx1050_hp_native.rom sul nodo Proxmox",
            "QEMU fw_cfg",
            "metodo ACPI _ROM(offset, length)",
            "0000:02:00.0",
            "docs/acpi-line-by-line.md",
            "docs/reproducible-runbook.md",
            "scripts/validate_documentation.py",
            "## Output completo di `gpu-vm-switch --help`",
        ),
        "README",
    )
    require(
        walkthrough,
        (
            "perché hostpci non è bastato",
            "OperationRegion (FWIO, SystemIO, 0x510, 2)",
            "Method (_ROM, 2)",
            "Ubuntu VM 1001 (OVMF/Q35)",
            "Kali VM 1000 (SeaBIOS/Q35)",
        ),
        "walkthrough",
    )
    require(
        runbook,
        (
            "## 1. Inventario non distruttivo del nodo",
            "--prepare-host",
            "--dry-run",
            "gpu-vm-switch --self-test",
            "qm guest exec",
            "nvidia-smi --query-gpu=name,driver_version,memory.total",
            "--mok-manual",
            "nvidia-glxgears",
            "Quando fermarsi",
        ),
        "runbook riproducibile",
    )
    require(
        claims,
        (
            "## Risposta breve: perché questa GTX 1050 funziona nella VM",
            "## 1. NVIDIA Optimus MUXless",
            "## 2. VBIOS, ROM PCI e presunto header da rimuovere",
            "Non rimuove alcun header UEFI",
            "## 3. FLR, reset PCIe e reboot dell'host",
            "non e stato necessario riavviare Proxmox",
            "## 4. Alimentazione ACPI: D3cold e _DSM",
            "## 5. IOMMU group e ACS override",
            "## 6. Windows Code 43",
            "## Alternative: cosa risolvono e cosa non risolvono",
            "## Cosa non si deve concludere",
        ),
        "matrice claim laptop",
    )

    for local_path in (
        ROOT / "evidence" / "nvtop-glxgears-proof.png",
        ROOT / "docs" / "architecture.md",
        ROOT / "docs" / "attempts-and-outcomes.md",
        ROOT / "docs" / "glossary.md",
        ROOT / "docs" / "acpi-line-by-line.md",
        ROOT / "docs" / "reproducible-runbook.md",
        ROOT / "docs" / "laptop-passthrough-claim-matrix.md",
    ):
        if not local_path.is_file():
            raise AssertionError(f"file locale mancante: {local_path.relative_to(ROOT)}")

    if ROM.stat().st_size != EXPECTED_ROM_SIZE:
        raise AssertionError(f"dimensione ROM inattesa: {ROM.stat().st_size}")
    digest = hashlib.sha256(ROM.read_bytes()).hexdigest()
    if digest != EXPECTED_ROM_SHA256:
        raise AssertionError(f"SHA-256 ROM inatteso: {digest}")

    marker = "~~~text\nUso:\n"
    start = readme.index(marker) + len("~~~text\n")
    end = readme.index("\n~~~", start)
    documented_help = readme[start:end].rstrip()
    git_bash = Path(os.environ.get("ProgramFiles", "")) / "Git" / "bin" / "bash.exe"
    bash = str(git_bash) if git_bash.is_file() else (shutil.which("bash") or "bash")
    actual_help = subprocess.run(
        [bash, str(ROOT / "scripts" / "gpu-vm-switch"), "--help"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.rstrip()
    if documented_help != actual_help:
        raise AssertionError("README: l'output --help non corrisponde allo script")

    print("documentazione-validata: glossario, diagrammi, help, link locali e ROM OEM ok")


if __name__ == "__main__":
    main()
