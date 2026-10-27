"""Write tests/browser/fixtures/data/albani-sermons/ from the test transcripts.

The browser fixture for the Albani Zaria sermons block reads these bundles.
They are the generator's real output on a four-recording corpus: the
current-format test transcript twice — one public, one private, so the
concordance has lines and the withheld count is not zero — one recording in
the legacy format and one not yet transcribed. Re-run after a change to the
generator's payload shape:

    python tests/browser/build_albani_fixture.py
"""
import sys
import tempfile
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
from albani.generator import AlbaniSermonsGenerator  # noqa: E402
from iwac_utils import save_json  # noqa: E402

FIXTURES = ROOT / "tests" / "fixtures" / "albani"
OUT = ROOT / "tests" / "browser" / "fixtures" / "data" / "albani-sermons"
CREATOR = "Muhammad Auwal Albani Zaria"


def row(o_id, title, **fields):
    base = {"o:id": o_id, "title": title,
            "iwac_url": f"https://islam.zmo.de/s/westafrica/item/{o_id}",
            "source_type": "deposited", "creator": CREATOR, "pub_date": "",
            "extent": "", "duration_seconds": 3600, "language": "Haoussa|Arabe",
            "subject": "", "OCR": "", "OCR_is_public": True,
            "iiif_manifest": "", "is_part_of": ""}
    return {**base, **fields}


def main() -> None:
    current = (FIXTURES / "current-format.txt").read_text(encoding="utf-8")
    legacy = (FIXTURES / "legacy-format.txt").read_text(encoding="utf-8")
    frame = pd.DataFrame([
        row("15889", "Ziyarar 'Yan Uwa Daga Gombe", OCR=current, duration_seconds=11940),
        row("15869", "Gurbacewar Tarbiyyah", OCR=current, OCR_is_public=False,
            pub_date="2008-05-25", duration_seconds=11160),
        row("15878", "Shari'a", OCR=legacy, duration_seconds=5700),
        row("15884", 'Ta\'aziyar "Yan Uwa Daga Ghana"', language="Anglais",
            pub_date="2013", duration_seconds=4200),
    ])
    with tempfile.TemporaryDirectory() as tmp:
        gen = AlbaniSermonsGenerator(Path(tmp), frame=frame, fetch_manifests=False)
        bundles = gen.build_all()
        gen.check_rights(bundles)
    OUT.mkdir(parents=True, exist_ok=True)
    for name, payload in bundles.items():
        # Pinned, so a rebuild changes a file only when its content does.
        payload["generated_at"] = "2026-10-27T00:00:00Z"
        save_json(payload, OUT / name, minify=False)


if __name__ == "__main__":
    main()
