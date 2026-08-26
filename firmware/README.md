# VBIOS OEM inclusa

`gtx1050_hp_native.rom` è la VBIOS estratta dal payload firmware/driver HP originale recuperato per l'HP Pavilion Laptop 15-cs1xxx di questo caso. Non è una ROM universale NVIDIA.

| Proprietà | Valore |
| --- | --- |
| GPU prevista | NVIDIA GP107M GeForce GTX 1050 Mobile |
| PCI ID | `10de:1c8d` |
| Versione VBIOS | `86.07.5F.00.2C` |
| Dimensione | 169472 byte |
| SHA-256 | `33abd3bc3f658b0536da0617a76076b56e5af124701271211d6d127cda22c322` |

La copia è qui solo per rendere riproducibile il laboratorio privato e coincide con la ROM che ha funzionato sul nodo Proxmox. Verifica i termini HP/NVIDIA prima di ridistribuirla. Per un altro laptop usa `scripts/extract_gtx1050_rom.py` sul suo payload OEM e confronta BDF, vendor e device ID prima di assegnarla a una VM.
