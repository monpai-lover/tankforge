# BMP-K-64 source archive

`BMP_K_64_ATGM.glb` is the unmodified 8,208,292-byte GLB recovered from the user's
`BMP_K_64_ATGM.html` model-data payload. The HTML was read as text and its gzip/base64
payload decoded; no viewer script was executed. SHA-256:
`5be15d88ed8899c724d67a68f8beae1f1b8c93c3afeb22584ca4010beaeb5805`.

The user supplied this as their project/model and authorized game integration and
repository publication. The GLB's asset.generator is “BMP-K-64 ATGM variant
photographic exterior reconstruction 1.1”; it does not declare an author or license.
This archive preserves that metadata and does not assign MIT or another third-party
license to it. See `../repair-source.json` for source hashes and measured poses.

Run `python tools/repair_bmp_k64.py` from the repository root (NumPy and Pillow).
This source supplies the common chassis and Konkurs mount. The missing standalone
KPVT/Kornet sources are not reconstructed: their complete original packed geometry
comes from the pinned Git revision recorded by the tool and provenance receipt.
