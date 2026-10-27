"""The youth and politics lexicons, loaded and matched.

The instrument lives in ``albani_lexicon.json``, edited by the researchers;
this module only compiles it and finds it in a speaker turn. Read that
file's ``_matching`` and ``_disambiguation`` notes before changing the
rules here — they are the contract the review sheet is written against.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, FrozenSet, List, Sequence, Tuple

from albani.normalize import Token, fold, keys_of, match_key

LEXICON_PATH = Path(__file__).with_name("albani_lexicon.json")


@dataclass(frozen=True)
class Entry:
    id: str
    display: str
    theme: str
    category: str
    core: bool             # the category's `core` flag
    layer: str             # "ha" or "ar" — the layer the term belongs to
    ambiguous: bool
    variants: Tuple[Tuple[str, ...], ...]   # key sequences
    exclude_before: FrozenSet[str]
    gloss_en: str = ""
    gloss_fr: str = ""
    note: str = ""

    @property
    def pooled(self) -> bool:
        """Counted in theme-level statistics (see ``_disambiguation``)."""
        return not self.ambiguous


@dataclass(frozen=True)
class Hit:
    entry: Entry
    start: int     # token index of the first word
    end: int       # token index past the last word


@dataclass
class Lexicon:
    status: str
    themes: Dict[str, Dict]                 # theme → its JSON (labels, categories)
    entries: List[Entry] = field(default_factory=list)
    #: (theme, category) → first key → [(keys, entry)], longest first
    _index: Dict[Tuple[str, str], Dict[str, List[Tuple[Tuple[str, ...], Entry]]]] = field(
        default_factory=dict)

    @classmethod
    def load(cls, path: Path = LEXICON_PATH) -> "Lexicon":
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        lex = cls(status=data.get("status", "seed"), themes=data["themes"])
        seen = set()
        for theme, tdata in data["themes"].items():
            for category, cdata in tdata["categories"].items():
                for raw in cdata["entries"]:
                    if raw["id"] in seen:
                        raise ValueError(f"albani_lexicon.json: duplicate id {raw['id']!r}")
                    seen.add(raw["id"])
                    variants = []
                    for form in raw["variants"]:
                        keys = keys_of(form)
                        if not keys:
                            raise ValueError(f"albani_lexicon.json: empty variant in {raw['id']!r}")
                        variants.append(keys)
                    entry = Entry(
                        id=raw["id"], display=raw["display"], theme=theme,
                        category=category, core=bool(cdata.get("core")),
                        layer=raw.get("layer", "ha"),
                        ambiguous=bool(raw.get("ambiguous")),
                        variants=tuple(dict.fromkeys(variants)),
                        exclude_before=frozenset(
                            match_key(fold(w)) for w in raw.get("exclude_before", [])),
                        gloss_en=raw.get("gloss_en", ""), gloss_fr=raw.get("gloss_fr", ""),
                        note=raw.get("note", ""),
                    )
                    lex.entries.append(entry)
                    index = lex._index.setdefault((theme, category), {})
                    for keys in entry.variants:
                        index.setdefault(keys[0], []).append((keys, entry))
        for index in lex._index.values():
            for options in index.values():
                options.sort(key=lambda kv: -len(kv[0]))
        return lex

    def by_id(self) -> Dict[str, Entry]:
        return {e.id: e for e in self.entries}

    def single_word_keys(self) -> FrozenSet[str]:
        return frozenset(keys[0] for e in self.entries for keys in e.variants if len(keys) == 1)

    def match(self, tokens: Sequence[Token], skip: Sequence[bool] = ()) -> Tuple[List[Hit], List[Hit]]:
        """``(hits, excluded)`` in one speaker turn.

        ``skip[i]`` marks a token no match may start on or cross (a formula
        word). Matches never overlap inside one category; categories are
        matched independently, so a phrase can count in two of them.
        ``excluded`` holds the occurrences a context rule rejected, so the
        decision stays auditable.
        """
        hits: List[Hit] = []
        excluded: List[Hit] = []
        n = len(tokens)
        keys = [t.key for t in tokens]
        for index in self._index.values():
            i = 0
            while i < n:
                options = index.get(keys[i]) if not (skip and skip[i]) else None
                found = None
                if options:
                    for variant, entry in options:
                        end = i + len(variant)
                        if end <= n and tuple(keys[i:end]) == variant and \
                                not (skip and any(skip[i:end])):
                            found = (end, entry)
                            break
                if found is None:
                    i += 1
                    continue
                end, entry = found
                hit = Hit(entry, i, end)
                if i > 0 and keys[i - 1] in entry.exclude_before:
                    excluded.append(hit)
                else:
                    hits.append(hit)
                i = end
        hits.sort(key=lambda h: (h.start, h.entry.id))
        return hits, excluded
