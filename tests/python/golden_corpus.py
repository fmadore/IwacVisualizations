"""A small, synthetic IWAC dataset for the generator golden test.

Seven subsets with the real column names and types (see DATA_NOTES.md and
the ``iwac-data`` skill), small enough to run offline in a second and big
enough that every covered generator has something to count, rank, map and
fan out. Nothing here is real collection content: the people, titles and
texts are invented, and the places are only placed roughly where they are.

Everything is a pure function of the row index, so the corpus is the same on
every machine and every run. Change it deliberately, then regenerate the
goldens with ``UPDATE_GOLDEN=1`` and review the diff.
"""
from __future__ import annotations

from typing import Dict, List

import numpy as np
import pandas as pd

#: The live sentiment panel (config/sentiment-models.json ``active``).
MODELS = ("gpt_5_6_luna", "mistral_small_2603", "deepseek_v4_flash_0731",
          "gemma_4_31b_it", "qwen3_8_27b", "claude_haiku_5_5")
CENTRALITE = ("Très central", "Central", "Secondaire", "Marginal", "Non abordé")
POLARITE = ("Très positif", "Positif", "Neutre", "Négatif", "Très négatif", "Non applicable")
SUBJECTIVITE = ("Très objectif", "Plutôt objectif", "Mixte", "Plutôt subjectif", "Très subjectif")

COUNTRIES = ("Bénin", "Burkina Faso", "Côte d'Ivoire", "Niger", "Togo", "Nigeria")
NEWSPAPERS = (
    ("La Gazette du Golfe", "Bénin"),
    ("Le Quotidien du Faso", "Burkina Faso"),
    ("L'Écho d'Abidjan", "Côte d'Ivoire"),
    ("Le Courrier du Sahel", "Niger"),
    ("La Voix de Lomé", "Togo"),
)
PERIODICALS = (
    ("Le Croissant", "Burkina Faso"),
    ("Al-Hikma", "Bénin"),
)

# Index o:ids are int64 in the dataset; every other subset stores strings.
PERSONS = (
    (1001, "Amadou Diallo", "Amadou", "Diallo", "Homme"),
    (1002, "Fatimata Ouédraogo", "Fatimata", "Ouédraogo", "Femme"),
    (1003, "Moussa Koné", "Moussa", "Koné", "Homme"),
    (1004, "Aïcha Mama", "Aïcha", "Mama", "Femme"),
    (1005, "Issa Sow", "Issa", "Sow", "Homme"),
)
ORGANISATIONS = (
    (1101, "Association des élèves musulmans"),
    (1102, "Union des musulmans du Togo"),
    (1103, "Conseil islamique du Bénin"),
    (1104, "Communauté musulmane du Faso"),
)
# (o:id, Titre, "lat, lng", Partie de)
PLACES = (
    (1201, "Bénin", "9.30, 2.31", ""),
    (1202, "Burkina Faso", "12.24, -1.56", ""),
    (1203, "Côte d'Ivoire", "7.54, -5.55", ""),
    (1204, "Niger", "17.61, 8.08", ""),
    (1205, "Togo", "8.62, 0.82", ""),
    (1211, "Cotonou", "6.37, 2.39", "Bénin"),
    (1212, "Ouagadougou", "12.37, -1.52", "Burkina Faso"),
    (1213, "Abidjan", "5.35, -4.01", "Côte d'Ivoire"),
    (1214, "Niamey", "13.51, 2.11", "Niger"),
    (1215, "Lomé", "6.13, 1.22", "Togo"),
    (1216, "Bobo-Dioulasso", "11.18, -4.30", "Burkina Faso"),
)
SUBJECTS = (
    (1301, "Ramadan"), (1302, "Tabaski"), (1303, "Mosquées"), (1304, "Éducation"),
    (1305, "Laïcité"), (1306, "Pèlerinage"), (1307, "Islam"), (1308, "Femmes"),
    (1309, "Jeunesse"), (1310, "Radicalisation"),
)
EVENTS = ((1401, "Congrès islamique de 2004"),)

TOPICS = (
    (0, "mosquée prière fidèle imam"),
    (1, "école enseignement élève franco-arabe"),
    (2, "pèlerinage mecque hadj voyage"),
    (3, "sécurité terrorisme attaque armée"),
)

WORDS = (
    "musulmans", "mosquée", "prière", "imam", "communauté", "fidèles", "ramadan",
    "jeûne", "école", "enseignement", "laïcité", "état", "religion", "paix",
    "pèlerinage", "mecque", "jeunesse", "femmes", "islamisme", "terrorisme",
    "jihad", "charia", "dialogue", "tolérance", "association", "union", "conseil",
)

DIM = 8


def _date(i: int, start_year: int = 1996) -> str:
    year = start_year + (i * 3) % 25
    month = 1 + (i * 5) % 12
    day = 1 + (i * 7) % 27
    return f"{year:04d}-{month:02d}-{day:02d}"


def _hijri(i: int) -> Dict[str, object]:
    return {"hijri_year": 1416 + (i * 3) % 25, "hijri_month": 1 + (i * 4) % 12,
            "hijri_day": 1 + (i * 5) % 29}


def _text(i: int, n: int) -> str:
    return " ".join(WORDS[(i * 7 + k * 3) % len(WORDS)] for k in range(n))


def _vector(i: int, salt: int = 0) -> np.ndarray:
    angle = (i * 37 + salt * 11) % 360
    base = np.array([np.cos(np.radians(angle + 45 * k)) for k in range(DIM)], dtype=np.float32)
    return base / np.linalg.norm(base)


def _pipe(*values: str) -> str:
    return "|".join(v for v in values if v)


def _common(prefix: str, i: int, oid: int) -> Dict[str, object]:
    return {
        "o:id": str(oid),
        "identifier": f"iwac-{prefix}-{i:07d}",
        "added_date": f"20{20 + i % 6}-0{1 + i % 9}-1{i % 9}",
        "iwac_url": f"https://islam.zmo.de/s/afrique_ouest/item/{oid}",
        "thumbnail": f"https://islam.zmo.de/files/medium/{oid}.jpg",
    }


def articles(n: int = 24) -> pd.DataFrame:
    rows: List[Dict[str, object]] = []
    for i in range(n):
        oid = 5000 + i
        paper, country = NEWSPAPERS[i % len(NEWSPAPERS)]
        topic_id, topic_label = TOPICS[i % len(TOPICS)]
        ocr = _text(i, 60 + (i % 5) * 10)
        # Two organisations named in the running text, for the org
        # co-occurrence windows (tests/python/golden_org_targets.json).
        if i % 3 == 0:
            ocr += " le conseil islamique du bénin " + _text(i + 5, 12)
        if i % 4 == 1:
            ocr += " union des musulmans du togo " + _text(i + 9, 12)
        row = _common("article", i, oid)
        row.update({
            "iiif_manifest": f"https://islam.zmo.de/iiif/{oid}/manifest",
            "PDF": f"https://islam.zmo.de/files/original/{oid}.pdf",
            "URL": "",
            "source": "Collection Frédérick Madore",
            "title": f"Article de synthèse numéro {i + 1}",
            "author": _pipe(PERSONS[i % len(PERSONS)][1], PERSONS[(i + 2) % len(PERSONS)][1] if i % 4 == 0 else ""),
            "newspaper": paper,
            "country": country,
            "pub_date": _date(i),
            **_hijri(i),
            "subject": _pipe(SUBJECTS[i % len(SUBJECTS)][1], SUBJECTS[(i + 3) % len(SUBJECTS)][1],
                             ORGANISATIONS[i % len(ORGANISATIONS)][1] if i % 3 == 0 else "",
                             PERSONS[(i + 1) % len(PERSONS)][1] if i % 2 == 0 else "",
                             EVENTS[0][1] if i % 8 == 0 else ""),
            "spatial": _pipe(PLACES[5 + i % 6][1], PLACES[i % 5][1]),
            "language": "Français",
            "nb_pages": float(1 + i % 3),
            "OCR": ocr,
            "OCR_is_public": i % 6 != 5,
            "nb_mots": len(ocr.split()),
            "Richesse_Lexicale_OCR": round(0.55 + (i % 9) * 0.03, 4),
            "Lisibilite_OCR": round(40.0 + (i % 11) * 2.5, 2),
            "lemma_text": ocr,
            "lemma_nostop": ocr,
            "lda_topic_id": float(topic_id) if i % 10 != 9 else -1.0,
            "lda_topic_prob": round(0.4 + (i % 5) * 0.1, 3),
            "lda_topic_label": topic_label,
            "lda_topic_topk": f"{topic_id}:0.6|{(topic_id + 1) % 4}:0.3",
            "lda_model_name": "lda-sha256:golden",
            "descriptionAI": f"Résumé de l'article {i + 1}.",
            "descriptionAI_en": f"Summary of article {i + 1}.",
            "embedding_OCR": _vector(i),
            "related_articles": "",
        })
        for m, model in enumerate(MODELS):
            declined = (i + m) % 13 == 0
            row[f"{model}_centralite_islam_musulmans"] = "" if declined else CENTRALITE[(i + m) % 5]
            row[f"{model}_centralite_justification"] = "" if declined else "Justification."
            row[f"{model}_polarite"] = "" if declined else POLARITE[(i * 2 + m) % 6]
            row[f"{model}_polarite_justification"] = "" if declined else "Justification."
            row[f"{model}_subjectivite_score"] = "" if declined else SUBJECTIVITE[(i + 2 * m) % 5]
            row[f"{model}_subjectivite_justification"] = "" if declined else "Justification."
        row["consensus_g2_centralite"] = CENTRALITE[i % 5]
        row["consensus_g2_polarite"] = POLARITE[(i * 2) % 6]
        row["consensus_g2_subjectivite_score"] = float(1 + i % 5)
        row["sentiment_g2_disagreement"] = "polarite" if i % 7 == 0 else ""
        rows.append(row)
    frame = pd.DataFrame(rows)
    # Neighbour lists as upstream writes them: within the subset, self
    # excluded, descending score, ties by string o:id.
    ids = frame["o:id"].tolist()
    vectors = np.stack(frame["embedding_OCR"].tolist())
    related = []
    for i in range(len(ids)):
        if i % 4 == 3:          # an empty cell: the generator computes it
            related.append("")
            continue
        scores = vectors @ vectors[i]
        order = sorted((j for j in range(len(ids)) if j != i), key=lambda j: (-round(float(scores[j]), 6), ids[j]))
        related.append("|".join(f"{ids[j]}:{float(scores[j]):.4f}" for j in order[:10]))
    frame["related_articles"] = related
    return frame


def publications(n: int = 8) -> pd.DataFrame:
    rows = []
    for i in range(n):
        oid = 6000 + i
        paper, country = PERIODICALS[i % len(PERIODICALS)]
        ocr = _text(i + 50, 80)
        row = _common("publication", i, oid)
        row.update({
            "iiif_manifest": f"https://islam.zmo.de/iiif/{oid}/manifest",
            "PDF": f"https://islam.zmo.de/files/original/{oid}.pdf",
            "title": f"{paper}, numéro {i + 1}",
            "author": PERSONS[i % len(PERSONS)][1] if i % 2 else "",
            "newspaper": paper,
            "country": country,
            "pub_date": _date(i, 2001),
            **_hijri(i + 3),
            "issue": str(i + 1),
            "tableOfContents": f"Éditorial|Dossier {i + 1}|Actualités" if i % 3 else "",
            "embedding_tableOfContents": _vector(i, 3) if i % 3 else None,
            "subject": _pipe(SUBJECTS[(i + 1) % len(SUBJECTS)][1], SUBJECTS[(i + 4) % len(SUBJECTS)][1]),
            "spatial": PLACES[5 + i % 6][1],
            "language": "Français",
            "nb_pages": 12 + i,
            "URL": "",
            "source": "Collection Frédérick Madore",
            "OCR": ocr,
            "OCR_is_public": True,
            "nb_mots": len(ocr.split()),
            "lemma_text": ocr,
            "lemma_nostop": ocr,
            "lda_topic_id": float(i % 4),
            "lda_topic_prob": 0.35,
            "lda_topic_label": TOPICS[i % 4][1],
            "lda_topic_topk": f"{i % 4}:0.35|{(i + 1) % 4}:0.2",
            "lda_model_name": "lda-sha256:golden-publications",
        })
        rows.append(row)
    return pd.DataFrame(rows)


def references(n: int = 6) -> pd.DataFrame:
    classes = ("Article de revue", "Chapitre", "Livre", "Thèse", "Rapport", "Ouvrage collectif")
    rows = []
    for i in range(n):
        oid = 7000 + i
        english = i % 3 == 2
        row = {
            "o:id": str(oid),
            "iwac_url": f"https://islam.zmo.de/s/afrique_ouest/item/{oid}",
            "identifier": f"iwac-reference-{i:07d}",
            "added_date": f"2022-0{1 + i}-15",
            "o:resource_class": classes[i % len(classes)],
            "title": f"Étude sur l'islam au Sahel, volume {i + 1}",
            "author": _pipe(f"Auteur{i}, Prénom", "Madore, Frédérick" if i % 2 == 0 else ""),
            "editor": "Éditeur, Prénom" if i % 3 == 1 else "",
            "review_of": "",
            "publisher": ("Karthala", "Brill", "L'Harmattan")[i % 3],
            "pub_date": str(2005 + i * 2),
            "type": classes[i % len(classes)],
            "book_title": "",
            "chapter": "",
            "volume": "",
            "issue": "",
            "abstract": f"Résumé de la référence {i + 1}." if i % 2 == 0 else "",
            "abstract_en": "",
            "edition": "",
            "nb_pages": "250",
            "page_start": "",
            "page_end": "",
            "extent": "",
            "is_part_of": "",
            "provenance": "",
            "subject": _pipe(SUBJECTS[i % len(SUBJECTS)][1], SUBJECTS[(i + 5) % len(SUBJECTS)][1]),
            "spatial": _pipe(PLACES[i % 5][1]),
            "language": "Anglais" if english else "Français",
            "doi": f"10.1000/golden.{i}" if i % 2 == 0 else "",
            "URL": "",
            "OCR": _text(i + 90, 40) if i % 2 == 0 else "",
            "OCR_is_public": False,
            "embedding_abstract": _vector(i, 7) if i % 2 == 0 else None,
            "nb_mots": 40 if i % 2 == 0 else 0,
            "country": COUNTRIES[i % 5],
            "lemma_text": "",
            "lemma_nostop": "",
            "lda_topic_id": float(i % 4) if i % 2 == 0 else None,
            "lda_topic_prob": 0.5 if i % 2 == 0 else None,
            "lda_topic_label": TOPICS[i % 4][1] if i % 2 == 0 else "",
            "lda_topic_topk": f"{i % 4}:0.5" if i % 2 == 0 else "",
            "lda_model_name": "lda-legacy-sha256:golden-references" if i % 2 == 0 else "",
        }
        rows.append(row)
    return pd.DataFrame(rows)


def documents(n: int = 3) -> pd.DataFrame:
    rows = []
    for i in range(n):
        oid = 8000 + i
        ocr = _text(i + 120, 50)
        row = _common("document", i, oid)
        row.update({
            "iiif_manifest": f"https://islam.zmo.de/iiif/{oid}/manifest",
            "PDF": f"https://islam.zmo.de/files/original/{oid}.pdf",
            "title": f"Lettre circulaire {i + 1}",
            "author": ORGANISATIONS[i % len(ORGANISATIONS)][1],
            "contributor": "Frédérick Madore",
            "country": COUNTRIES[i % 5],
            "pub_date": _date(i + 40),
            **_hijri(i + 40),
            "descriptionAI": f"Lettre {i + 1}.",
            "descriptionAI_en": f"Letter {i + 1}.",
            "subject": SUBJECTS[(i + 2) % len(SUBJECTS)][1],
            "spatial": PLACES[5 + i][1],
            "language": "Français",
            "type": "Lettre",
            "nb_pages": 2,
            "source": "Collection Frédérick Madore",
            "rights": "",
            "OCR": ocr,
            "OCR_is_public": True,
            "nb_mots": len(ocr.split()),
            "lemma_text": ocr,
            "lemma_nostop": ocr,
            "embedding_OCR": _vector(i, 13),
            "related_articles": "",
        })
        rows.append(row)
    return pd.DataFrame(rows)


def audiovisual(n: int = 4) -> pd.DataFrame:
    rows = []
    for i in range(n):
        oid = 9000 + i
        youtube = i % 2 == 0
        row = _common("audiovisual", i, oid)
        row.update({
            "iiif_manifest": "" if youtube else f"https://islam.zmo.de/iiif/{oid}/manifest",
            "PDF": "" if youtube else f"https://islam.zmo.de/files/original/{oid}.mp4",
            "URL": f"https://www.youtube.com/watch?v=golden{i}" if youtube else "",
            "source_type": "youtube" if youtube else "deposited",
            "title": f"Prêche du vendredi {i + 1}",
            "creator": PERSONS[i % len(PERSONS)][1],
            "publisher": ORGANISATIONS[i % len(ORGANISATIONS)][1],
            "country": ("Burkina Faso", "Nigeria", "Bénin", "Togo")[i],
            "pub_date": _date(i + 60, 2010),
            **_hijri(i + 60),
            "description": f"Description de l'enregistrement {i + 1}." if youtube else "",
            "descriptionAI": "",
            "descriptionAI_en": "",
            "volume": "", "issue": "", "is_part_of": "",
            "extent": f"PT{20 + i * 5}M",
            "duration_seconds": (20 + i * 5) * 60,
            "medium": "" if youtube else "DVD",
            "type": "Vidéo",
            "rights": "", "contributor": "",
            "subject": SUBJECTS[(i + 6) % len(SUBJECTS)][1],
            "spatial": PLACES[5 + i][1],
            "language": "Français" if i < 3 else "Haoussa",
            "source": "",
            "OCR": "", "nb_mots": 0, "OCR_is_public": False,
        })
        rows.append(row)
    return pd.DataFrame(rows)


def images(n: int = 3) -> pd.DataFrame:
    rows = []
    for i in range(n):
        oid = 9500 + i
        place = PLACES[5 + i]
        lat, lng = (float(x) for x in place[2].split(","))
        row = _common("image", i, oid)
        row.update({
            "iiif_manifest": f"https://islam.zmo.de/iiif/{oid}/manifest",
            "image_url": f"https://islam.zmo.de/files/original/{oid}.jpg",
            "title": f"Mosquée de {place[1]}",
            "type": "Photographie",
            "creator": "Frédérick Madore",
            "pub_date": _date(i + 80, 2015),
            **_hijri(i + 80),
            "description": "",
            "rights": "In Copyright - Educational Use Permitted",
            "subject": "Mosquées",
            "spatial": place[1],
            "coordinates": place[2],
            "country": place[3],
            "latitude": lat,
            "longitude": lng,
            "embedding_image": _vector(i, 17),
        })
        rows.append(row)
    return pd.DataFrame(rows)


def index() -> pd.DataFrame:
    """Authority records, with the aggregates computed from the content subsets."""
    entries = (
        [(oid, title, "Personnes", {"Prénom": first, "Nom": last, "Genre": genre}) for oid, title, first, last, genre in PERSONS]
        + [(oid, title, "Organisations", {}) for oid, title in ORGANISATIONS]
        + [(oid, title, "Lieux", {"Coordonnées": coords, "Partie de": part}) for oid, title, coords, part in PLACES]
        + [(oid, title, "Sujets", {}) for oid, title in SUBJECTS]
        + [(oid, title, "Événements", {}) for oid, title in EVENTS]
    )
    content = [articles(), publications(), references(), audiovisual()]
    roles = {"articles": ("subject", "spatial", "author"), "publications": ("subject", "spatial", "author"),
             "references": ("subject", "spatial", "author", "editor", "publisher"),
             "audiovisual": ("subject", "spatial", "creator", "publisher")}
    rows = []
    for oid, title, kind, extra in entries:
        dates: List[str] = []
        countries: Dict[str, int] = {}
        frequency = 0
        for name, frame in zip(roles, content):
            for _, doc in frame.iterrows():
                terms = set()
                for column in roles[name]:
                    terms.update(t.strip() for t in str(doc.get(column) or "").split("|") if t.strip())
                if title in terms:
                    frequency += 1
                    dates.append(str(doc["pub_date"]))
                    for c in str(doc.get("country") or "").split("|"):
                        if c:
                            countries[c] = countries.get(c, 0) + 1
        row = {
            "o:id": oid,
            "identifier": f"iwac-index-{oid:07d}",
            "added_date": "2021-03-01",
            "iwac_url": f"https://islam.zmo.de/s/afrique_ouest/item/{oid}",
            "thumbnail": "",
            "Titre": title,
            "Titre alternatif": "",
            "Type": kind,
            "Description": f"Notice {title}.",
            "Date création": "", "date": "", "Relation": "", "Remplacé par": "",
            "Partie de": extra.get("Partie de", ""),
            "A une partie": "",
            "spatial": "",
            "Prénom": extra.get("Prénom", ""),
            "Nom": extra.get("Nom", ""),
            "Genre": extra.get("Genre", ""),
            "Naissance": "",
            "Coordonnées": extra.get("Coordonnées", ""),
            "frequency": frequency,
            "first_occurrence": min(dates) if dates else "",
            "last_occurrence": max(dates) if dates else "",
            "countries": "|".join(sorted(countries, key=lambda c: (-countries[c], c))),
        }
        rows.append(row)
    return pd.DataFrame(rows)


def corpus() -> Dict[str, pd.DataFrame]:
    """Every subset, keyed by its Hugging Face config name."""
    return {
        "articles": articles(),
        "publications": publications(),
        "references": references(),
        "documents": documents(),
        "audiovisual": audiovisual(),
        "images": images(),
        "index": index(),
    }
