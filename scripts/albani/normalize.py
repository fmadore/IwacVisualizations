"""Folding and tokenizing for the Hausa / transliterated-Arabic transcripts.

This is **not** ``iwac_utils.fold_plain``, the French accent fold. Three
facts about this corpus shape it (issue #31, "Preprocessing decisions"):

* **Hooked letters are inconsistent.** Some recordings are transcribed with
  ɓ ɗ ƙ ƴ throughout (hundreds per transcript), others almost without them
  (15889: three in 25,000 words). So every form folds to plain ASCII —
  ɓ→b, ɗ→d, ƙ→k, and ƴ→'y, its standard ASCII spelling. The fold is lossy
  in one direction only, and knowingly: the unhooked text *already* merges
  real minimal pairs (*dan* "in order to" / *ɗan* "son of"; *kare* "dog" /
  *ƙare* "to finish"), so a lexicon entry built on one of them needs a
  context rule or has to go.
* **The Arabic is loose ASR Latin.** No ʿ, ḥ or macrons to speak of
  (*Rabi'in al-awwal*, *muqaddima*), and the same word arrives as *hadith*,
  *hadisi*, *Hadeeth*, *qur'ani*, *kur'ani*, *shari'ah*, *shari'a*. The
  *matching key* (``match_key``) collapses that variation — q→k, doubled
  letters single, a final *-ah* to *-a* — for matching and counting only.
  What a reader sees is always the commonest surface form behind a key
  (``SurfaceTable``), never the key itself.
* **Apostrophes carry meaning** and are kept in the key: *'ya'ya*
  (offspring) is not *yaya* (how), and *shari'a* keeps its glottal stop.
  Curly, modifier and ayn/hamza marks all fold onto the ASCII ``'``; a
  leading one survives only before *y* (the *'y* letter of *'yan*), and a
  trailing one never does.

Tokens keep their character offsets into the original transcript, which is
what the concordance is cut from.
"""
from __future__ import annotations

import json
import re
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Tuple

NORMALIZATION_PATH = Path(__file__).with_name("normalization.json")

# Letters are any Unicode letter (ɗ, ā, ʿ-free Latin…), joined by internal
# apostrophes of any typography; hyphens and everything else split. The
# leading-apostrophe rule is applied after matching (see `tokenize`).
_APOSTROPHE_CHARS = "'’‘ʼʾʿ`´"
_TOKEN_RE = re.compile(
    r"[" + _APOSTROPHE_CHARS + r"]?[^\W\d_]+(?:[" + _APOSTROPHE_CHARS + r"][^\W\d_]+)*")

# The ASR's elision mark, and any other bracketed aside inside a text line.
# Its words are not the speaker's.
_INLINE_ASIDE = re.compile(r"\[[^\]\n]*\]")

_HOOKS = {
    "ɓ": "b", "Ɓ": "b", "ɗ": "d", "Ɗ": "d", "ƙ": "k", "Ƙ": "k",
    "ƴ": "'y", "Ƴ": "'y",
}


def fold(token: str) -> str:
    """Lowercase plain-ASCII form of one token, apostrophes unified.

    >>> fold("Ɗalibai"), fold("ƴan"), fold("Shari’ah"), fold("ḥadīth")
    ('dalibai', "'yan", "shari'ah", 'hadith')
    """
    out = []
    for ch in token:
        if ch in _HOOKS:
            out.append(_HOOKS[ch])
        elif ch in _APOSTROPHE_CHARS:
            out.append("'")
        else:
            decomposed = unicodedata.normalize("NFD", ch)
            out.append(decomposed[0].lower() if decomposed else ch.lower())
    folded = "".join(out)
    # Only the 'y letter takes a leading apostrophe; quotes are not words.
    if folded.startswith("'") and not folded.startswith("'y"):
        folded = folded.lstrip("'")
    folded = folded.rstrip("'")
    return re.sub(r"[^a-z']", "", folded)


_DOUBLE = re.compile(r"([a-z])\1+")


def match_key(folded: str) -> str:
    """The key variants are matched and counted on. Lossy by design.

    >>> match_key("kur'ani") == match_key("qur'ani")
    True
    >>> match_key("tarbiyya") == match_key("tarbiya")
    True
    >>> match_key("shari'ah") == match_key("shari'a")
    True
    >>> match_key("'ya'ya") == match_key("yaya")
    False
    """
    key = folded.replace("q", "k")
    key = _DOUBLE.sub(r"\1", key)
    if len(key) > 3 and key.endswith("ah"):
        key = key[:-1]
    return key


@dataclass(frozen=True)
class Token:
    surface: str     # folded form, for display
    key: str         # match_key(surface), for matching and counting
    start: int       # offset into the original transcript
    end: int


def _load_joins() -> Dict[Tuple[str, str], str]:
    data = json.loads(NORMALIZATION_PATH.read_text(encoding="utf-8"))
    joins = {}
    for split, joined in data.get("joins", {}).items():
        parts = split.split()
        if len(parts) != 2:
            raise ValueError(f"normalization.json: join {split!r} is not two words")
        joins[(match_key(fold(parts[0])), match_key(fold(parts[1])))] = fold(joined)
    return joins


_JOINS: Dict[Tuple[str, str], str] = {}


def joins() -> Dict[Tuple[str, str], str]:
    if not _JOINS:
        _JOINS.update(_load_joins())
    return _JOINS


def tokenize(text: str, start: int = 0, end: int = -1) -> List[Token]:
    """Tokens of ``text[start:end]`` with offsets into ``text``.

    Bracketed asides are skipped, and the word-division join rule
    (``normalization.json``: *kan su* → *kansu*, *da ke* → *dake*) merges
    the ASR's split forms into one token spanning both, so the two spellings
    count as one word.
    """
    if end < 0:
        end = len(text)
    span = text[start:end]
    skip = [(m.start() + start, m.end() + start) for m in _INLINE_ASIDE.finditer(span)]
    tokens: List[Token] = []
    for m in _TOKEN_RE.finditer(span):
        s, e = m.start() + start, m.end() + start
        if any(a <= s < b for a, b in skip):
            continue
        surface = fold(m.group(0))
        if not surface or surface == "'y":
            continue
        tokens.append(Token(surface, match_key(surface), s, e))
    table = joins()
    if not table:
        return tokens
    out: List[Token] = []
    i = 0
    while i < len(tokens):
        if i + 1 < len(tokens):
            joined = table.get((tokens[i].key, tokens[i + 1].key))
            if joined is not None:
                out.append(Token(joined, match_key(joined), tokens[i].start, tokens[i + 1].end))
                i += 2
                continue
        out.append(tokens[i])
        i += 1
    return out


class SurfaceTable:
    """The commonest surface form behind each key — what the reader sees.

    Counting runs on keys, so *tarbiyya* and *tarbiya* are one word; the
    word cloud then labels it with whichever spelling the transcripts use
    most, instead of printing the key (*tarbiya*), which is a spelling no
    one wrote if every occurrence happened to be doubled.
    """

    def __init__(self) -> None:
        self._forms: Dict[str, Counter] = defaultdict(Counter)

    def add(self, tokens: Iterable[Token]) -> None:
        for tok in tokens:
            self._forms[tok.key][tok.surface] += 1

    def display(self, key: str) -> str:
        forms = self._forms.get(key)
        if not forms:
            return key
        return min(forms.items(), key=lambda kv: (-kv[1], kv[0]))[0]

    def count(self, key: str) -> int:
        return sum((self._forms.get(key) or Counter()).values())

    def variants(self, key: str, limit: int = 6) -> List[str]:
        forms = self._forms.get(key) or Counter()
        return [f for f, _ in sorted(forms.items(), key=lambda kv: (-kv[1], kv[0]))[:limit]]


def keys_of(phrase: str) -> Tuple[str, ...]:
    """A curated phrase as the key sequence the text is matched against."""
    return tuple(t.key for t in tokenize(phrase))
