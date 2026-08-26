#!/usr/bin/env python3
"""Extract an NVIDIA VBIOS image embedded in an HP firmware payload.

This is the cleaned, runnable version of the extraction approach supplied in
the recovery notes. It searches a raw payload and LZMA streams for PCI option
ROMs, then writes the multi-image VBIOS matching the requested PCI device ID.
"""

from __future__ import annotations

import argparse
import lzma
import struct
import sys
from pathlib import Path

PCI_ROM_SIGNATURE = b"\x55\xaa"
PCIR_SIGNATURE = b"PCIR"


def parse_u16(buffer: bytes, offset: int) -> int:
    if offset + 2 > len(buffer):
        raise ValueError("u16 fuori dal buffer")
    return struct.unpack_from("<H", buffer, offset)[0]


def option_rom_length(buffer: bytes, start: int) -> tuple[int, bool, int]:
    """Return total length, last-image flag and code type for an option ROM."""
    pcir_offset = parse_u16(buffer, start + 0x18)
    pcir = start + pcir_offset
    if pcir + 0x16 > len(buffer) or buffer[pcir : pcir + 4] != PCIR_SIGNATURE:
        raise ValueError("header PCIR non valido")
    length = parse_u16(buffer, pcir + 0x10) * 512
    if length <= 0 or start + length > len(buffer):
        raise ValueError("lunghezza ROM non valida")
    is_last = bool(buffer[pcir + 0x15] & 0x80)
    return length, is_last, buffer[pcir + 0x14]


def matching_rom(buffer: bytes, start: int, wanted_device: int) -> bytes | None:
    if start + 0x1A > len(buffer):
        return None
    try:
        pcir = start + parse_u16(buffer, start + 0x18)
    except ValueError:
        return None
    if pcir + 8 > len(buffer) or buffer[pcir : pcir + 4] != PCIR_SIGNATURE:
        return None

    vendor, device = struct.unpack_from("<HH", buffer, pcir + 4)
    if vendor != 0x10DE or device != wanted_device:
        return None

    images_length = 0
    current = start
    while current < len(buffer) and buffer[current : current + 2] == PCI_ROM_SIGNATURE:
        try:
            length, is_last, code_type = option_rom_length(buffer, current)
        except ValueError as error:
            print(f"[!] ROM @ {current:#x}: {error}")
            return None
        image_type = "UEFI GOP" if code_type == 3 else "Legacy VBIOS"
        print(f"    -> Immagine {image_type}: {length} bytes")
        images_length += length
        current += length
        if is_last:
            break
    return buffer[start : start + images_length] if images_length else None


def scan(buffer: bytes, label: str, wanted_device: int) -> bytes | None:
    offset = 0
    while True:
        index = buffer.find(PCI_ROM_SIGNATURE, offset)
        if index < 0:
            return None
        offset = index + 2
        if index + 0x1A > len(buffer):
            continue
        try:
            pcir = index + parse_u16(buffer, index + 0x18)
        except ValueError:
            continue
        if pcir + 8 > len(buffer) or buffer[pcir : pcir + 4] != PCIR_SIGNATURE:
            continue
        vendor, device = struct.unpack_from("<HH", buffer, pcir + 4)
        if vendor != 0x10DE:
            continue
        print(f"[+] ROM NVIDIA in {label} @ {index:#x} -> Device ID: {device:#06x}")
        rom = matching_rom(buffer, index, wanted_device)
        if rom is not None:
            print("    ===> [MATCH] Device ID richiesto individuato")
            return rom


def lzma_streams(payload: bytes, window_size: int):
    """Yield likely LZMA streams, following the original recovery heuristic."""
    for index in range(max(0, len(payload) - 13)):
        if payload[index] != 0x5D or payload[index + 1 : index + 3] != b"\x00\x00":
            continue
        chunk = payload[index : index + window_size]
        try:
            yield f"LZMA @ {index:#x}", lzma.decompress(chunk, format=lzma.FORMAT_ALONE)
        except lzma.LZMAError:
            pass
        try:
            yield (
                f"LZMA RAW @ {index:#x}",
                lzma.decompress(
                    payload[index + 5 : index + window_size],
                    format=lzma.FORMAT_RAW,
                    filters=[{"id": lzma.FILTER_LZMA1, "dict_size": 1 << 23}],
                ),
            )
        except lzma.LZMAError:
            pass


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="payload firmware, ad esempio 084C0.bin")
    parser.add_argument(
        "--device-id", default="1c8d", help="PCI device ID esadecimale NVIDIA (default: 1c8d)"
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("/usr/share/kvm/gtx1050_hp_native.rom"),
        help="file ROM da creare",
    )
    parser.add_argument("--force", action="store_true", help="sovrascrive l'output esistente")
    parser.add_argument(
        "--lzma-window-mib", type=int, default=10, help="finestra massima per stream LZMA (default: 10)"
    )
    args = parser.parse_args()

    try:
        wanted_device = int(args.device_id, 16)
    except ValueError:
        parser.error("--device-id deve essere esadecimale, ad esempio 1c8d")
    if args.output.exists() and not args.force:
        parser.error(f"output gia esistente: {args.output} (usa --force per sovrascrivere)")

    payload = args.input.read_bytes()
    print(f"[*] Analisi completa di {args.input} ({len(payload)} bytes)...")
    rom = scan(payload, "RAW", wanted_device)
    if rom is None:
        for label, decompressed in lzma_streams(payload, args.lzma_window_mib * 1024 * 1024):
            rom = scan(decompressed, label, wanted_device)
            if rom is not None:
                break

    if rom is None:
        print(f"[!] Device ID {wanted_device:#06x} non presente in {args.input}.")
        return 1
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(rom)
    print(f"[OK] ROM estratta in {args.output} ({len(rom)} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
