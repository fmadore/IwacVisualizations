"""Accent folding and the tunable laïcité lexicon.

The two folds are the load-bearing pair: ``fold_preserving`` keeps character
offsets so a concordance snippet can be cut out of readable text with its
original casing and diacritics, while ``fold_plain`` is the ASCII lowercase
form the tokenizer and the collocate vocabularies run on. Nothing here knows
about subsets or bundles.
"""
from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path
from typing import Any, Dict, List, Sequence, Set




LEXICON_PATH = Path(__file__).with_name("laicite_lexicon.json")

# Post-fold tokenizer: runs on `fold_plain()` output (ASCII, lowercased),
# so a bare a-z class is exact here. Deliberately NOT iwac_utils.TOKEN_RE,
# which is the Unicode word-cloud tokenizer for raw text.
ASCII_TOKEN_RE = re.compile(r"[a-z]+")

# Half-width of the collocation window, in tokens. ±5 is the corpus-
# linguistics default and the span the issue specifies.
COLLOCATE_WINDOW = 5
# Minimum token length kept in the collocate/keyness vocabularies, matching
# iwac_utils.tokenize. Shorter tokens are function words in French.
MIN_TOKEN_LEN = 4


def fold_preserving(text: str) -> str:
    """Lowercase + strip diacritics, mapping each input char to exactly one
    output char so offsets into the folded string index the original.

    ``str.lower()`` plus a plain NFD-normalize-and-strip would be shorter,
    but NFD changes string length (``é`` → ``e`` + U+0301), and on
    already-decomposed input the strip changes it again. Character offsets
    are what the concordance is built on, so the mapping has to be 1:1.
    """
    out: List[str] = []
    for ch in text:
        decomposed = unicodedata.normalize("NFD", ch)
        base = decomposed[0] if decomposed else ch
        out.append(base.lower())
    return "".join(out)


def fold_plain(text: str) -> str:
    """Offset-agnostic fold, for lexicon terms and tag comparisons."""
    if not isinstance(text, str):
        return ""
    return "".join(
        c for c in unicodedata.normalize("NFD", text.lower())
        if unicodedata.category(c) != "Mn"
    )


def _form_to_pattern(form: str) -> str:
    """Compile one curated surface form into a regex fragment.

    Multi-word forms match across flexible whitespace, and an elided
    article (``l'État``) also matches the OCR spelling that drops the
    apostrophe (``l Etat``).
    """
    folded = fold_plain(form)
    parts = re.split(r"[\s']+", folded)
    parts = [re.escape(p) for p in parts if p]
    return r"[\s']+".join(parts)


class Lexicon:
    """The curated frame lexicon plus the laity/state disambiguator."""

    def __init__(self, path: Path = LEXICON_PATH):
        with path.open(encoding="utf-8") as fh:
            raw = json.load(fh)
        self.raw = raw
        self.frames: Dict[str, Dict[str, Any]] = raw["frames"]
        self.membership_frames: List[str] = list(raw["membership_frames"])
        self.authority: Dict[str, Any] = raw.get("authority", {})

        self.patterns: Dict[str, re.Pattern] = {}
        for name, spec in self.frames.items():
            # Longest first so "état laïc" wins over the bare "laïc" at the
            # same position; the scan takes non-overlapping matches.
            forms = sorted(spec["forms"], key=len, reverse=True)
            alternation = "|".join(_form_to_pattern(f) for f in forms)
            self.patterns[name] = re.compile(r"\b(?:" + alternation + r")\b")

        # Ambiguous forms, per frame, as folded whole tokens.
        self.ambiguous: Dict[str, Set[str]] = {
            name: {fold_plain(f) for f in spec.get("ambiguous", [])}
            for name, spec in self.frames.items()
        }

        # Every word appearing in any curated form, as folded tokens. These
        # are the selection criterion, so they are excluded from collocate
        # and keyness vocabularies — otherwise every slice would return the
        # selectors as their own top result.
        self.all_form_tokens: Set[str] = set()
        for spec in self.frames.values():
            for form in spec["forms"]:
                self.all_form_tokens.update(ASCII_TOKEN_RE.findall(fold_plain(form)))
        self.all_form_tokens.update(ASCII_TOKEN_RE.findall(fold_plain(" ".join(self.frames))))

        # Bilingual corpus: iwac_utils.STOPWORDS is French-only, and the
        # scholarly subset is largely English. Plus digitisation artefacts,
        # which are not vocabulary at all.
        self.extra_stopwords: Set[str] = {
            fold_plain(w) for w in raw.get("stopwords_en", [])
        } | {fold_plain(w) for w in raw.get("ocr_noise", [])}

        d = raw["disambiguation"]
        self.state_left = {fold_plain(w) for w in d["state_left"]}
        self.state_right = {fold_plain(w) for w in d["state_right"]}
        self.laity_left = {fold_plain(w) for w in d["laity_left"]}
        self.laity_bare_plural_left = {
            fold_plain(w) for w in d["laity_bare_plural_left"]
        }
        self.laity_near = {fold_plain(w) for w in d["laity_near"]}
        self.state_near = {fold_plain(w) for w in d["state_near"]}

    def frame_labels(self) -> Dict[str, Dict[str, str]]:
        """Reader-facing labels and captions, per frame.

        The sidecar's bare ``note`` is deliberately NOT emitted: it is the
        internal rationale for whoever edits the lexicon (why a nearly-empty
        frame is kept, why a family is re-counted here rather than joined
        from the scary-terms bundles) and it is English-only. The caption
        the panel renders is ``note_en`` / ``note_fr``.
        """
        return {
            name: {
                "en": spec.get("label_en", name),
                "fr": spec.get("label_fr", name),
                "note_en": spec.get("note_en", ""),
                "note_fr": spec.get("note_fr", ""),
                # Optional sibling block this frame overlaps with, as a
                # registry slug. Data rather than a JS conditional so the
                # "which frame points where" judgement stays beside the
                # word list that motivates it; the panel renders a link
                # for any frame that declares one and nothing for the
                # rest.
                "cross_block": spec.get("cross_block", ""),
                "cross_en": spec.get("cross_en", ""),
                "cross_fr": spec.get("cross_fr", ""),
            }
            for name, spec in self.frames.items()
        }

    # -- disambiguation ---------------------------------------------------

    def classify_ambiguous(self, tokens: Sequence[str], idx: int) -> str:
        """Return ``'state'`` or ``'laity'`` for an ambiguous hit.

        An immediate qualifier decides when one is present; otherwise a
        narrow neighbourhood vote does, defaulting to ``state`` on a tie
        (the dossier's own concept is the more likely reading inside a
        corpus already filtered to it).
        """
        token = tokens[idx]
        if token == "laicat":          # the body of lay people, never the principle
            return "laity"

        left1 = tokens[idx - 1] if idx >= 1 else ""
        left2 = tokens[idx - 2] if idx >= 2 else ""
        right1 = tokens[idx + 1] if idx + 1 < len(tokens) else ""
        right2 = tokens[idx + 2] if idx + 2 < len(tokens) else ""

        if left1 in self.state_left or left2 in self.state_left:
            return "state"
        if left1 in self.laity_left or left2 in self.laity_left:
            return "laity"
        # "des laïcs" / "les laïcs" as a bare plural noun is the laity;
        # the adjective reading would need a noun to qualify.
        if token.endswith("s") and left1 in self.laity_bare_plural_left:
            return "laity"
        if right1 == "de" and right2 in self.state_right:
            return "state"

        lo, hi = max(0, idx - 8), min(len(tokens), idx + 9)
        window = tokens[lo:hi]
        laity_votes = sum(1 for t in window if t in self.laity_near)
        state_votes = sum(1 for t in window if t in self.state_near)
        return "laity" if laity_votes > state_votes else "state"
