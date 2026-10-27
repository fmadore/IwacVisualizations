"""Hausa exposition, Arabic citation and religious formulae — one label a token.

The Arabic in these transcripts is transliterated (curator, issue #31), so
script cannot tell the layers apart, and the transliteration is loose ASR
Latin with no ʿ, ḥ or macrons to test for. What does separate them is
**density**: running Hausa is roughly half function words (*da*, *ya*,
*sai*, *wannan*…), while a recited verse or hadith has almost none and
accumulates Arabic ones instead (*wa … minhuma … lakum … innallaha kana*).
So a token is labelled Arabic when the window around it holds at least two
Arabic cues and at most one Hausa one, and an Arabic run shorter than three
tokens is folded back into the Hausa around it — a lone *qala* inside a
Hausa sentence is a loan in use, not a citation.

Formulae are matched first, as whole phrases, longest first, and taken out
of both layers: *sallallahu alaihi wa sallam* would otherwise top the Arabic
list and, its *wa* being shared, distort the window test as well.

This is a heuristic and is published as one. Its boundary is fuzzy by nature
— *addini*, *shari'a*, *ilimi*, *da'awa* are Arabic loans that are fully
Hausa, and they carry no cue weight, so they stay in the Hausa layer unless
they sit inside a citation.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, FrozenSet, List, Sequence, Tuple

from albani.normalize import Token, fold, keys_of, match_key

RESOURCES_PATH = Path(__file__).with_name("stopwords.json")

HAUSA = "ha"
ARABIC = "ar"
FORMULA_PREFIX = "fx:"

#: Half-width of the classifier window, in tokens.
WINDOW = 4
#: Arabic cues needed in the window, and the most Hausa cues it may hold.
MIN_ARABIC_CUES = 2.0
MAX_HAUSA_CUES = 1
#: An Arabic run shorter than this is relabelled Hausa.
MIN_ARABIC_RUN = 3
#: Words a run may absorb at each edge (see `label_tokens`).
EDGE_EXTENSION = 3
#: English-cue share above which a segment is treated as English.
ENGLISH_SHARE = 0.12


def _keys(words: Sequence[str]) -> FrozenSet[str]:
    return frozenset(match_key(fold(w)) for w in words if fold(w))


@dataclass
class Resources:
    hausa_stop: FrozenSet[str]
    arabic_stop: FrozenSet[str]
    english: FrozenSet[str]
    noise: FrozenSet[str]
    neutral: FrozenSet[str]
    suffixes: Tuple[str, ...]
    consonant_loans: FrozenSet[str]
    #: first key → [(variant keys, formula id)], longest variant first
    formulae: Dict[str, List[Tuple[Tuple[str, ...], str]]] = field(default_factory=dict)
    formula_labels: Dict[str, str] = field(default_factory=dict)

    @property
    def hausa_cues(self) -> FrozenSet[str]:
        return self.hausa_stop - self.neutral

    @property
    def arabic_cues(self) -> FrozenSet[str]:
        return self.arabic_stop - self.neutral


_CACHE: Dict[str, Resources] = {}


def resources() -> Resources:
    if "r" not in _CACHE:
        data = json.loads(RESOURCES_PATH.read_text(encoding="utf-8"))
        res = Resources(
            hausa_stop=_keys(data["hausa_bashir_2024"] + data["hausa"]),
            arabic_stop=_keys(data["arabic"]),
            english=_keys(data["english"]),
            noise=_keys(data.get("noise", [])),
            neutral=_keys(data["layers"]["neutral"]),
            suffixes=tuple(data["layers"]["arabic_suffixes"]),
            consonant_loans=_keys(data["layers"]["consonant_loans"]),
        )
        for formula in data["formulae"]:
            res.formula_labels[formula["id"]] = formula["label"]
            for variant in formula["variants"]:
                keys = keys_of(variant)
                if not keys:
                    raise ValueError(f"stopwords.json: empty formula variant in {formula['id']}")
                res.formulae.setdefault(keys[0], []).append((keys, formula["id"]))
        for options in res.formulae.values():
            options.sort(key=lambda kv: -len(kv[0]))
        _CACHE["r"] = res
    return _CACHE["r"]


# Hausa words end in a vowel, -n or -r (-s in a few loans); transliterated
# Arabic routinely ends in a consonant (lakum, muslimun's -n aside: haqq,
# rabbil, nahmaduhu… -m, -k, -l, -b, -d, -t, -f, -h, -q) and spells the
# Arabic fricatives with digraphs Hausa does not use. Both are weak cues —
# loans like malam, imam and littafin's linker defeat them one at a time —
# which is why they only count half and only in a window with no Hausa.
_CONSONANT_FINAL = frozenset("bdfhklmpqtz")
_DIGRAPHS = ("th", "dh", "kh", "gh", "q")


def _arabic_weight(token: Token, res: Resources) -> float:
    key = token.key
    if key in res.arabic_cues:
        return 1.0
    if key in res.hausa_stop or key in res.consonant_loans:
        return 0.0
    weight = 0.0
    if len(key) >= 5 and key.endswith(res.suffixes):
        weight += 0.5
    surface = token.surface
    if len(surface) >= 3 and surface[-1] in _CONSONANT_FINAL:
        weight += 0.5
    if any(d in surface for d in _DIGRAPHS):
        weight += 0.5
    return min(weight, 1.0)


def label_tokens(tokens: Sequence[Token]) -> List[str]:
    """One label per token: ``"ha"``, ``"ar"`` or ``"fx:<formula id>"``.

    Runs on one speaker turn at a time; a window never reaches into the
    next speaker's words.
    """
    res = resources()
    n = len(tokens)
    labels: List[str] = [""] * n

    i = 0
    while i < n:
        options = res.formulae.get(tokens[i].key)
        matched = False
        if options:
            for keys, fid in options:
                end = i + len(keys)
                if end <= n and all(tokens[i + k].key == keys[k] for k in range(len(keys))):
                    for k in range(i, end):
                        labels[k] = FORMULA_PREFIX + fid
                    i = end
                    matched = True
                    break
        if not matched:
            i += 1

    # The window test runs over the words that are left, so a formula
    # neither counts as Arabic nor breaks up the Hausa around it.
    positions = [k for k in range(n) if not labels[k]]
    hausa = res.hausa_cues
    h_cue = [1 if tokens[k].key in hausa else 0 for k in positions]
    a_cue = [_arabic_weight(tokens[k], res) for k in positions]
    raw: List[str] = []
    for j in range(len(positions)):
        lo, hi = max(0, j - WINDOW), min(len(positions), j + WINDOW + 1)
        a = sum(a_cue[lo:hi])
        h = sum(h_cue[lo:hi])
        cited = a >= MIN_ARABIC_CUES and h <= MAX_HAUSA_CUES and a > h
        raw.append(ARABIC if cited else HAUSA)

    # Fold short Arabic runs back into the Hausa.
    j = 0
    while j < len(raw):
        if raw[j] == ARABIC:
            k = j
            while k < len(raw) and raw[k] == ARABIC:
                k += 1
            if k - j < MIN_ARABIC_RUN:
                for m in range(j, k):
                    raw[m] = HAUSA
            j = k
        else:
            j += 1
    # A citation's edge words sit in windows that reach into the Hausa
    # around it, so they vote Hausa ("… wa antum muslimun | to wannan…").
    # Let each run absorb up to EDGE_EXTENSION neighbours that are not
    # themselves Hausa function words.
    arabic_runs = [j for j, lab in enumerate(raw) if lab == ARABIC]
    for j in arabic_runs:
        for step in (-1, 1):
            k = j + step
            for _ in range(EDGE_EXTENSION):
                if not 0 <= k < len(raw) or raw[k] == ARABIC or h_cue[k]:
                    break
                raw[k] = ARABIC
                k += step
    for j, k in enumerate(positions):
        labels[k] = raw[j]
    return labels


def formula_label(fid: str) -> str:
    return resources().formula_labels.get(fid, fid)


def english_share(tokens: Sequence[Token]) -> float:
    """Share of tokens that are English cue words (no Hausa homographs)."""
    if not tokens:
        return 0.0
    english = resources().english
    return sum(1 for t in tokens if t.key in english) / len(tokens)


def is_english(tokens: Sequence[Token]) -> bool:
    return english_share(tokens) >= ENGLISH_SHARE
