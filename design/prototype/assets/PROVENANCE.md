# Asset provenance

The design project's asset transfer API caps single files at 256 KiB, which truncated three
of the five PNGs. Resolution per file:

| File | Status |
| --- | --- |
| `Check-A.png` | Original, complete (177,846 bytes). |
| `Update-CRM.png` | Original, complete (186,145 bytes). |
| `List-Building.png` | Reconstructed from the truncated original: 461/512 scanlines (90%) decoded cleanly; the missing bottom rows were transparent margin. Visually complete. |
| `Clay_Arch_3D.png` | Substituted with the identical brand mark (`Clay_Logo_Icon.png`) from the Terra-derived asset set in `Manager-Forecasts-Weekly/public/brand/assets/` — same colorful 3D arch render, 1024×768. Displayed at 24×24, indistinguishable. |
| `Clay_Logo_3D_Blk.png` | Substituted with the identical primary wordmark (`Clay_Logo_Primary_Blk.png`) from the same set — same "clay" wordmark + 3D arch, 3152×1006. Displayed at 44px height, indistinguishable. |

To restore the byte-exact originals, re-export `assets/Clay_Arch_3D.png`,
`assets/Clay_Logo_3D_Blk.png`, and `assets/List-Building.png` from the Claude Design project
("Run monitor prototype review", `78e9368b-ab2d-445b-9cb4-8a5b8c82f680`) with a transfer
method that isn't capped at 256 KiB, and overwrite the files here and in `public/`.
