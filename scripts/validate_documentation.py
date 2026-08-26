#!/usr/bin/env python3
"""Check documented glossary coverage, local links, diagrams and OEM ROM identity."""

from __future__ import annotations

import hashlib
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
            "Ubuntu -> Kali -> Ubuntu",
            "file gtx1050_hp_native.rom sul nodo Proxmox",
            "QEMU fw_cfg",
            "metodo ACPI _ROM(offset, length)",
            "0000:02:00.0",
            "docs/acpi-line-by-line.md",
            "scripts/validate_documentation.py",
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

    for local_path in (
        ROOT / "evidence" / "nvtop-glxgears-proof.png",
        ROOT / "docs" / "architecture.md",
        ROOT / "docs" / "attempts-and-outcomes.md",
        ROOT / "docs" / "glossary.md",
        ROOT / "docs" / "acpi-line-by-line.md",
    ):
        if not local_path.is_file():
            raise AssertionError(f"file locale mancante: {local_path.relative_to(ROOT)}")

    if ROM.stat().st_size != EXPECTED_ROM_SIZE:
        raise AssertionError(f"dimensione ROM inattesa: {ROM.stat().st_size}")
    digest = hashlib.sha256(ROM.read_bytes()).hexdigest()
    if digest != EXPECTED_ROM_SHA256:
        raise AssertionError(f"SHA-256 ROM inatteso: {digest}")

    print("documentazione-validata: glossario, diagrammi, link locali e ROM OEM ok")


if __name__ == "__main__":
    main()
