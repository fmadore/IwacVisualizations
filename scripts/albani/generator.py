"""``AlbaniSermonsGenerator`` — the bundles behind the ``albani-sermons`` block.

Writes ``asset/data/albani-sermons/``:

``metadata.json``     the corpus: every recording, its status and sizes
``vocabulary.json``   frequency lists per layer (Hausa / Arabic) + formulae
``lexicon.json``      the seed lexicons and their counts, per recording, per year
``collocates.json``   which words travel with each category (G² gate, log-ratio rank)
``network.json``      lexicon terms and their strongest collocates, as a graph
``overlap.json``      where the youth and politics lexicons fire together
``keyness.json``      each recording / period / mode against the rest
``concordance-<theme>.json``  KWIC lines — RIGHTS-GATED on ``OCR_is_public``

**Units.** The speaker turn is the unit of co-occurrence: a window never
crosses into the next speaker's words, because the text is ASR output whose
punctuation cannot be trusted for sentences. The 20-minute segment is the
"document" for dispersion, document-frequency floors and keyness.

**Scopes.** Every count that could mix voices is published twice: ``all``
counted segments, and ``monologue`` only (see ``albani.corpus``). English
segments are in neither.

**Rights (curator, issue #31).** Aggregates — frequencies, collocates,
networks, keyness, per-segment counts — are published for every transcript,
private or public. Text that could be read back is not: KWIC lines come only
from rows whose ``OCR_is_public`` is true, and no aggregate carries a string
longer than three words. ``check_rights`` tests that boundary on the actual
payloads before anything is written, rather than trusting this paragraph.
"""
from __future__ import annotations

import csv
import logging
import os
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

import pandas as pd

from iwac_stats import keyness_for_slices
from iwac_utils import (
    DATASET_ID, generate_timestamp, iter_records, load_dataset_safe, save_json,
)

from albani.corpus import (
    ANALYSED, COLUMNS, EXCHANGE, EXCHANGE_MAIN_SHARE, LEGACY, MONOLOGUE,
    Recording, SegmentScan, TurnScan, build_recording, fetch_media, is_albani,
)
from albani.layers import ARABIC, ENGLISH_SHARE, FORMULA_PREFIX, HAUSA, formula_label, resources
from albani.lexicon import Entry, Hit, Lexicon
from albani.normalize import SurfaceTable, fold
from albani.transcript import window_label

SCOPES = ("all", MONOLOGUE)

CONCORDANCE_PREFIX = "concordance-"

#: A seed form needs this many occurrences before its distributional
#: neighbours are worth a reviewer's time.
MIN_NEIGHBOUR_QUERY = 10

#: The most words any string in an aggregate bundle may hold (issue #31:
#: "no n-gram longer than a short phrase (cap at 3 tokens)").
MAX_AGGREGATE_WORDS = 3


class RightsError(AssertionError):
    """A bundle would publish text the rights rules forbid."""


def _window_positions(hit: Hit, n: int, width: int) -> range:
    return range(max(0, hit.start - width), min(n, hit.end + width))


class AlbaniSermonsGenerator:
    def __init__(
        self,
        output_dir: Path,
        repo_id: str = DATASET_ID,
        minify: bool = False,
        window: int = 5,
        overlap_window: int = 10,
        top_terms: int = 150,
        top_collocates: int = 30,
        min_collocate_count: int = 5,
        min_segments: int = 3,
        min_recordings: int = 2,
        network_collocates: int = 20,
        kwic_per_entry: int = 100,
        kwic_context: int = 130,
        period_split: str = "2009-07-01",
        fetch_manifests: bool = True,
        frame: Optional[pd.DataFrame] = None,
    ):
        self.output_dir = Path(output_dir)
        self.repo_id = repo_id
        self.minify = minify
        self.window = window
        self.overlap_window = overlap_window
        self.top_terms = top_terms
        self.top_collocates = top_collocates
        self.min_collocate_count = min_collocate_count
        self.min_segments = min_segments
        self.min_recordings = min_recordings
        self.network_collocates = network_collocates
        self.kwic_per_entry = kwic_per_entry
        self.kwic_context = kwic_context
        self.period_split = period_split
        self.fetch_manifests = fetch_manifests
        self.frame = frame
        self.lexicon = Lexicon.load()
        self.res = resources()
        self.surfaces = SurfaceTable()
        self.recordings: List[Recording] = []
        self._loaded = False
        self.logger = logging.getLogger(__name__)

    # ------------------------------------------------------------------ #
    #  Loading                                                             #
    # ------------------------------------------------------------------ #

    def load(self) -> List[Recording]:
        if self._loaded:
            return self.recordings
        df = self.frame
        if df is None:
            df = load_dataset_safe("audiovisual", repo_id=self.repo_id,
                                   token=os.getenv("HF_TOKEN"), columns=COLUMNS,
                                   required=True)
        rows = [r for r in iter_records(df) if is_albani(r)]
        rows.sort(key=lambda r: int(str(r.get("o:id"))) if str(r.get("o:id")).isdigit() else 0)
        self.logger.info(f"Albani Zaria corpus: {len(rows)} deposited recordings")
        for row in rows:
            rec = build_recording(row, self.lexicon)
            if rec.status == ANALYSED and self.fetch_manifests:
                fetch_media(rec)
            for seg in rec.segments:
                for turn in seg.turns:
                    self.surfaces.add(turn.tokens)
            self.recordings.append(rec)
        by_status = Counter(r.status for r in self.recordings)
        self.logger.info(f"  status: {dict(by_status)}")
        self._loaded = True
        return self.recordings

    def analysed(self) -> List[Recording]:
        return [r for r in self.load() if r.status == ANALYSED]

    # ------------------------------------------------------------------ #
    #  Token helpers                                                       #
    # ------------------------------------------------------------------ #

    def _is_content(self, key: str, label: str) -> bool:
        if len(key) < 2 or label.startswith(FORMULA_PREFIX) or key in self.res.noise:
            return False
        if label == ARABIC:
            return key not in self.res.arabic_stop
        return key not in self.res.hausa_stop

    def _segments(self, scope: str) -> Iterable[Tuple[Recording, SegmentScan]]:
        for rec in self.analysed():
            for seg in rec.segments:
                if seg.in_scope(scope):
                    yield rec, seg

    def _display(self, key: str) -> str:
        return self.surfaces.display(key)

    # ------------------------------------------------------------------ #
    #  metadata.json                                                       #
    # ------------------------------------------------------------------ #

    def build_metadata(self) -> Dict[str, Any]:
        recs = self.load()
        out_recs = []
        totals = Counter()
        layer_totals = Counter()
        for rec in recs:
            entry: Dict[str, Any] = {
                "o": rec.o_id, "t": rec.title, "u": rec.url,
                "d": rec.date or None, "y": rec.year,
                "dur": rec.duration_seconds, "lang": rec.languages,
                "subj": rec.subjects, "st": rec.status,
            }
            if rec.series:
                entry["ser"] = rec.series
            totals[rec.status] += 1
            totals["seconds"] += rec.duration_seconds or 0
            if rec.status == ANALYSED:
                layers = Counter()
                for seg in rec.segments:
                    if not seg.counted:
                        continue
                    for turn in seg.turns:
                        for label in turn.labels:
                            layers["fx" if label.startswith(FORMULA_PREFIX) else label] += 1
                entry.update({
                    "pub": rec.public,
                    "parts": rec.parts,
                    # The media file behind each part, for window links.
                    "m": [m["url"] for m in rec.media],
                    "segs": len(rec.segments),
                    "x": sum(1 for s in rec.segments if s.mode == EXCHANGE and s.counted),
                    "en": sum(1 for s in rec.segments if s.english),
                    "w": sum(s.n_tokens for s in rec.segments if s.counted),
                    "wm": sum(s.n_tokens for s in rec.segments if s.in_scope(MONOLOGUE)),
                    "layers": {k: layers.get(k, 0) for k in (HAUSA, ARABIC, "fx")},
                })
                totals["seconds_analysed"] += rec.duration_seconds or 0
                totals["segments"] += len(rec.segments)
                totals["segments_exchange"] += entry["x"]
                totals["segments_english"] += entry["en"]
                totals["words"] += entry["w"]
                totals["words_monologue"] += entry["wm"]
                totals["public"] += 1 if rec.public else 0
                layer_totals.update(entry["layers"])
            out_recs.append(entry)
        return {
            "generated_at": generate_timestamp(),
            "creator": "Muhammad Auwal Albani Zaria",
            "lexicon_status": self.lexicon.status,
            "totals": {
                "recordings": len(recs),
                "analysed": totals[ANALYSED],
                "legacy": totals[LEGACY],
                "untranscribed": totals["untranscribed"],
                "public_transcripts": totals["public"],
                "seconds": totals["seconds"],
                "seconds_analysed": totals["seconds_analysed"],
                "segments": totals["segments"],
                "segments_exchange": totals["segments_exchange"],
                "segments_english": totals["segments_english"],
                "words": totals["words"],
                "words_monologue": totals["words_monologue"],
                "layers": {k: layer_totals.get(k, 0) for k in (HAUSA, ARABIC, "fx")},
            },
            "recordings": out_recs,
            "params": {
                "window": self.window,
                "overlap_window": self.overlap_window,
                "min_collocate_count": self.min_collocate_count,
                "min_segments": self.min_segments,
                "min_recordings": self.min_recordings,
                "period_split": self.period_split,
                "exchange_main_share": EXCHANGE_MAIN_SHARE,
                "english_share": ENGLISH_SHARE,
                "segment_minutes": 20,
            },
        }

    # ------------------------------------------------------------------ #
    #  vocabulary.json                                                     #
    # ------------------------------------------------------------------ #

    def build_vocabulary(self) -> Dict[str, Any]:
        scopes = {}
        for scope in SCOPES:
            counts = {HAUSA: Counter(), ARABIC: Counter()}
            seg_df = {HAUSA: Counter(), ARABIC: Counter()}
            rec_df = {HAUSA: defaultdict(set), ARABIC: defaultdict(set)}
            running = Counter()
            formulae = Counter()
            formula_recs: Dict[str, Set[str]] = defaultdict(set)
            for rec, seg in self._segments(scope):
                seen = {HAUSA: set(), ARABIC: set()}
                for turn in seg.turns:
                    previous = ""
                    for tok, label in zip(turn.tokens, turn.labels):
                        if label.startswith(FORMULA_PREFIX):
                            fid = label[len(FORMULA_PREFIX):]
                            # One formula occurrence spans several tokens;
                            # count it once, on its first word.
                            if previous != label:
                                formulae[fid] += 1
                                formula_recs[fid].add(rec.o_id)
                            previous = label
                            running["fx"] += 1
                            continue
                        previous = label
                        running[label] += 1
                        if self._is_content(tok.key, label):
                            counts[label][tok.key] += 1
                            seen[label].add(tok.key)
                for layer in (HAUSA, ARABIC):
                    seg_df[layer].update(seen[layer])
                    for key in seen[layer]:
                        rec_df[layer][key].add(rec.o_id)
            layers = {}
            for layer in (HAUSA, ARABIC):
                terms = [
                    {"w": self._display(k), "n": n, "s": seg_df[layer][k],
                     "r": len(rec_df[layer][k])}
                    for k, n in counts[layer].most_common()
                    if seg_df[layer][k] >= (self.min_segments if layer == HAUSA else 1)
                ][:self.top_terms]
                layers[layer] = {
                    "running": running[layer],
                    "types": len(counts[layer]),
                    "content": sum(counts[layer].values()),
                    "terms": terms,
                }
            scopes[scope] = {
                "layers": layers,
                "formulae": [
                    {"id": fid, "label": formula_label(fid), "n": n,
                     "r": len(formula_recs[fid])}
                    for fid, n in formulae.most_common()
                ],
                "formula_tokens": running["fx"],
            }
        return {"generated_at": generate_timestamp(), "scopes": scopes}

    # ------------------------------------------------------------------ #
    #  Hit collection — shared by lexicon, collocates, network, overlap    #
    # ------------------------------------------------------------------ #

    def _content_window(self, turn: TurnScan, positions: Iterable[int],
                        exclude: Set[int]) -> List[str]:
        out = []
        for p in positions:
            if p in exclude:
                continue
            tok, label = turn.tokens[p], turn.labels[p]
            if self._is_content(tok.key, label):
                out.append(tok.key)
        return out

    def _theme_hits(self, turn: TurnScan, theme: str, core_only: bool = True) -> List[Hit]:
        return [h for h in turn.hits
                if h.entry.theme == theme and h.entry.pooled and (h.entry.core or not core_only)]

    # ------------------------------------------------------------------ #
    #  lexicon.json                                                        #
    # ------------------------------------------------------------------ #

    def build_lexicon(self) -> Dict[str, Any]:
        self.load()
        entries = self.lexicon.entries
        counts = {s: Counter() for s in SCOPES}
        seg_df = {s: Counter() for s in SCOPES}
        rec_df = {s: defaultdict(set) for s in SCOPES}
        excluded = Counter()
        surfaces: Dict[str, Counter] = defaultdict(Counter)
        by_recording = {s: [] for s in SCOPES}
        by_year: Dict[str, Dict[int, Dict[str, Any]]] = {s: {} for s in SCOPES}

        for scope in SCOPES:
            per_rec: Dict[str, Dict[str, Any]] = {}
            for rec, seg in self._segments(scope):
                row = per_rec.setdefault(rec.o_id, {
                    "o": rec.o_id, "w": 0, "themes": Counter(), "categories": Counter()})
                row["w"] += seg.n_tokens
                seen = set()
                for turn in seg.turns:
                    for hit in turn.hits:
                        e = hit.entry
                        counts[scope][e.id] += 1
                        seen.add(e.id)
                        rec_df[scope][e.id].add(rec.o_id)
                        if e.pooled:
                            row["categories"][f"{e.theme}.{e.category}"] += 1
                    # Theme totals count POSITIONS, not hits: categories are
                    # independent, so "tsarin mulki" is a constitution hit
                    # and a rule hit, and a theme total must not count it twice.
                    for theme in self.lexicon.themes:
                        covered = set()
                        for hit in self._theme_hits(turn, theme):
                            covered.add(hit.start)
                        row["themes"][theme] += len(covered)
                    if scope == "all":
                        for hit in turn.hits:
                            surfaces[hit.entry.id][" ".join(
                                t.surface for t in turn.tokens[hit.start:hit.end])] += 1
                        for hit in turn.excluded:
                            excluded[hit.entry.id] += 1
                seg_df[scope].update(seen)
            for o_id, row in per_rec.items():
                by_recording[scope].append({
                    "o": o_id, "w": row["w"],
                    "themes": dict(row["themes"]),
                    "categories": dict(row["categories"]),
                })
            years: Dict[int, Dict[str, Any]] = {}
            recs_by_id = {r.o_id: r for r in self.analysed()}
            for row in by_recording[scope]:
                year = recs_by_id[row["o"]].year
                if not year:
                    continue
                cell = years.setdefault(year, {"year": year, "w": 0, "recordings": 0,
                                               "themes": Counter()})
                cell["w"] += row["w"]
                cell["recordings"] += 1
                cell["themes"].update(row["themes"])
            by_year[scope] = [dict(c, themes=dict(c["themes"])) for _, c in sorted(years.items())]

        themes_out = {}
        for theme, tdata in self.lexicon.themes.items():
            themes_out[theme] = {
                "label_en": tdata["label_en"], "label_fr": tdata["label_fr"],
                "categories": [
                    {"id": cid, "label_en": c["label_en"], "label_fr": c["label_fr"],
                     "core": bool(c.get("core"))}
                    for cid, c in tdata["categories"].items()
                ],
            }
        return {
            "generated_at": generate_timestamp(),
            "status": self.lexicon.status,
            "themes": themes_out,
            "entries": [
                {
                    "id": e.id, "display": e.display, "theme": e.theme,
                    "category": e.category, "core": e.core, "layer": e.layer,
                    "ambiguous": e.ambiguous, "gloss_en": e.gloss_en,
                    "gloss_fr": e.gloss_fr,
                    # Surface forms seen, commonest first. Lexicon forms are
                    # one to three words long by construction.
                    "forms": [f for f, _ in surfaces[e.id].most_common(8)],
                    "n": {s: counts[s][e.id] for s in SCOPES},
                    "s": {s: seg_df[s][e.id] for s in SCOPES},
                    "r": {s: len(rec_df[s][e.id]) for s in SCOPES},
                    "excluded": excluded[e.id],
                }
                for e in entries
            ],
            "by_recording": by_recording,
            "by_year": by_year,
        }

    # ------------------------------------------------------------------ #
    #  collocates.json                                                     #
    # ------------------------------------------------------------------ #

    def _node_sets(self) -> Dict[str, Dict[str, List[Entry]]]:
        """theme → {category id | "pooled": [pooled entries]}."""
        out: Dict[str, Dict[str, List[Entry]]] = {}
        for theme in self.lexicon.themes:
            sets: Dict[str, List[Entry]] = {}
            pooled = []
            for e in self.lexicon.entries:
                if e.theme != theme or not e.pooled:
                    continue
                sets.setdefault(e.category, []).append(e)
                if e.core:
                    pooled.append(e)
            sets["pooled"] = pooled
            out[theme] = sets
        return out

    def _collocate_counts(self, scope: str, ids: Set[str], width: int
                          ) -> Tuple[Counter, Counter, Counter, Dict[str, Set[str]], int]:
        """In-window and out-of-window content counts for one node set.

        Returns ``(window, rest, window_segments, window_recordings, nodes)``
        — the last is how many node occurrences opened a window.
        """
        window, rest = Counter(), Counter()
        seg_df: Counter = Counter()
        rec_df: Dict[str, Set[str]] = defaultdict(set)
        nodes = 0
        for rec, seg in self._segments(scope):
            seen = set()
            for turn in seg.turns:
                hits = [h for h in turn.hits if h.entry.id in ids]
                node_pos: Set[int] = set()
                win_pos: Set[int] = set()
                for hit in hits:
                    node_pos.update(range(hit.start, hit.end))
                    win_pos.update(_window_positions(hit, len(turn.tokens), width))
                nodes += len(hits)
                inside = self._content_window(turn, sorted(win_pos), node_pos)
                window.update(inside)
                seen.update(inside)
                outside = [p for p in range(len(turn.tokens)) if p not in win_pos]
                rest.update(self._content_window(turn, outside, set()))
            seg_df.update(seen)
            for key in seen:
                rec_df[key].add(rec.o_id)
        return window, rest, seg_df, rec_df, nodes

    def _score_collocates(self, window: Counter, rest: Counter, seg_df: Counter,
                          rec_df: Dict[str, Set[str]], exclude: Set[str]) -> List[Dict[str, Any]]:
        if not window or not rest:
            return []
        scored = keyness_for_slices({"window": window, "rest": rest},
                                    top_n=len(window), min_count=self.min_collocate_count)
        out = []
        for e in scored.get("window", []):
            key = e["token"]
            if key in exclude:
                continue
            if seg_df[key] < self.min_segments or len(rec_df[key]) < self.min_recordings:
                continue
            out.append({
                "w": self._display(key), "k": key, "n": e["count"],
                "lr": e["log_ratio"], "g2": e["g2"], "q": e["q"],
                "ratio": e["rate_ratio"], "s": seg_df[key], "r": len(rec_df[key]),
            })
            if len(out) >= self.top_collocates:
                break
        return out

    def build_collocates(self) -> Dict[str, Any]:
        self.load()
        lexicon_keys = self.lexicon.single_word_keys()
        scopes: Dict[str, Any] = {}
        sizes: Dict[str, Any] = {}
        for scope in SCOPES:
            themes = {}
            for theme, sets in self._node_sets().items():
                cats = {}
                for name, entries in sets.items():
                    ids = {e.id for e in entries}
                    window, rest, seg_df, rec_df, nodes = self._collocate_counts(
                        scope, ids, self.window)
                    # The node set's own words are not its collocates; other
                    # lexicon words are, and are flagged for the panel.
                    own = {k[0] for e in entries for k in e.variants if len(k) == 1}
                    scored = self._score_collocates(window, rest, seg_df, rec_df, own)
                    for item in scored:
                        if item["k"] in lexicon_keys:
                            item["lex"] = 1
                    if scored or nodes:
                        cats[name] = {"nodes": nodes, "window_tokens": sum(window.values()),
                                      "terms": scored}
                themes[theme] = cats
            scopes[scope] = themes
            sizes[scope] = sum(seg.n_tokens for _, seg in self._segments(scope))
        return {
            "generated_at": generate_timestamp(),
            "window": self.window,
            "min_count": self.min_collocate_count,
            "min_segments": self.min_segments,
            "min_recordings": self.min_recordings,
            "words": sizes,
            "scopes": scopes,
        }

    # ------------------------------------------------------------------ #
    #  network.json                                                        #
    # ------------------------------------------------------------------ #

    def build_network(self, collocates: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        self.load()
        collocates = collocates or self.build_collocates()
        out: Dict[str, Any] = {}
        for scope in SCOPES:
            graphs = {}
            for theme, sets in self._node_sets().items():
                pooled_ids = {e.id for e in sets["pooled"]}
                if theme == "youth":
                    # Youth's related frames (education, marriage…) are the
                    # interesting neighbours of the youth core, so they join
                    # its graph as terms; politics is all core already.
                    pooled_ids |= {e.id for name, es in sets.items() if name != "pooled" for e in es}
                top = (collocates["scopes"][scope].get(theme, {}).get("pooled", {})
                       .get("terms", []))[:self.network_collocates]
                top_keys = {t["k"]: t for t in top}
                entry_hits: Counter = Counter()
                pair: Counter = Counter()
                coll: Counter = Counter()
                for _, seg in self._segments(scope):
                    for turn in seg.turns:
                        hits = [h for h in turn.hits if h.entry.id in pooled_ids]
                        for hit in hits:
                            entry_hits[hit.entry.id] += 1
                            positions = _window_positions(hit, len(turn.tokens), self.window)
                            node_pos = set(range(hit.start, hit.end))
                            for key in set(self._content_window(turn, positions, node_pos)):
                                if key in top_keys:
                                    coll[(hit.entry.id, key)] += 1
                        for a in range(len(hits)):
                            for b in range(a + 1, len(hits)):
                                ha, hb = hits[a], hits[b]
                                if ha.entry.id == hb.entry.id:
                                    continue
                                if hb.start - ha.end <= self.window:
                                    pair[tuple(sorted((ha.entry.id, hb.entry.id)))] += 1
                by_id = self.lexicon.by_id()
                nodes = []
                kept = {eid for eid, n in entry_hits.items() if n >= self.min_collocate_count}
                for eid in sorted(kept, key=lambda i: -entry_hits[i]):
                    e = by_id[eid]
                    nodes.append({"id": "e:" + eid, "name": e.display, "kind": "term",
                                  "category": e.category, "n": entry_hits[eid]})
                links = []
                for (a, b), n in pair.most_common():
                    if n >= 2 and a in kept and b in kept:
                        links.append({"source": "e:" + a, "target": "e:" + b, "n": n, "kind": "terms"})
                used = set()
                for (eid, key), n in coll.most_common():
                    if n >= 3 and eid in kept:
                        links.append({"source": "e:" + eid, "target": "w:" + key, "n": n,
                                      "kind": "collocate"})
                        used.add(key)
                for key in sorted(used, key=lambda k: -top_keys[k]["n"]):
                    t = top_keys[key]
                    nodes.append({"id": "w:" + key, "name": t["w"], "kind": "collocate",
                                  "n": t["n"], "lr": t["lr"]})
                graphs[theme] = {"nodes": nodes, "links": links}
            out[scope] = graphs
        return {"generated_at": generate_timestamp(), "window": self.window,
                "scopes": out}

    # ------------------------------------------------------------------ #
    #  overlap.json                                                        #
    # ------------------------------------------------------------------ #

    def build_overlap(self) -> Dict[str, Any]:
        self.load()
        width = self.overlap_window
        scopes = {}
        for scope in SCOPES:
            matrix: Counter = Counter()
            per_rec: Dict[str, Counter] = defaultdict(Counter)
            segments = []
            window, rest = Counter(), Counter()
            seg_df: Counter = Counter()
            rec_df: Dict[str, Set[str]] = defaultdict(set)
            for rec, seg in self._segments(scope):
                seg_meet = seg_youth = seg_pol = 0
                seen = set()
                for turn in seg.turns:
                    youth = self._theme_hits(turn, "youth")
                    politics = self._theme_hits(turn, "politics")
                    seg_youth += len({h.start for h in youth})
                    seg_pol += len({h.start for h in politics})
                    win_pos: Set[int] = set()
                    node_pos: Set[int] = set()
                    met = set()
                    for y in youth:
                        for p in politics:
                            gap = max(p.start - y.end, y.start - p.end)
                            if gap <= width:
                                matrix[(y.entry.id, p.entry.id)] += 1
                                met.add(y.start)
                                lo, hi = min(y.start, p.start), max(y.end, p.end)
                                node_pos.update(range(y.start, y.end))
                                node_pos.update(range(p.start, p.end))
                                win_pos.update(range(max(0, lo - self.window),
                                                     min(len(turn.tokens), hi + self.window)))
                    seg_meet += len(met)
                    inside = self._content_window(turn, sorted(win_pos), node_pos)
                    window.update(inside)
                    seen.update(inside)
                    rest.update(self._content_window(
                        turn, [p for p in range(len(turn.tokens)) if p not in win_pos], set()))
                seg_df.update(seen)
                for key in seen:
                    rec_df[key].add(rec.o_id)
                row = per_rec[rec.o_id]
                row["w"] += seg.n_tokens
                row["youth"] += seg_youth
                row["politics"] += seg_pol
                row["meetings"] += seg_meet
                row["segments_both"] += 1 if seg_youth and seg_pol else 0
                if seg_meet:
                    segments.append({
                        "o": rec.o_id, "p": seg.segment.ordinal, "i": seg.segment.index,
                        "of": seg.segment.total, "s": seg.segment.start_seconds,
                        "e": seg.segment.end_seconds, "win": window_label(seg.segment),
                        "md": seg.mode, "meetings": seg_meet, "youth": seg_youth,
                        "politics": seg_pol,
                    })
            segments.sort(key=lambda s: (-s["meetings"], s["o"], s["p"], s["i"]))
            own = self.lexicon.single_word_keys()
            scopes[scope] = {
                "pairs": [{"youth": a, "politics": b, "n": n} for (a, b), n in matrix.most_common()],
                "by_recording": [dict(o=o, **{k: int(v) for k, v in row.items()})
                                 for o, row in per_rec.items()],
                "segments": segments[:25],
                "segments_with_meetings": len(segments),
                "collocates": self._score_collocates(window, rest, seg_df, rec_df, own),
            }
        return {"generated_at": generate_timestamp(), "window": width,
                "context_window": self.window, "scopes": scopes}

    # ------------------------------------------------------------------ #
    #  keyness.json                                                        #
    # ------------------------------------------------------------------ #

    def _keyness(self, slices: Dict[str, Counter], seg_df: Dict[str, Counter],
                 min_df: int, top: int = 25) -> Dict[str, List[Dict[str, Any]]]:
        usable = {k: v for k, v in slices.items() if sum(v.values())}
        if len(usable) < 2:
            return {}
        scored = keyness_for_slices(usable, top_n=10_000, min_count=8, min_log_ratio=1.0)
        out = {}
        for name, entries in scored.items():
            kept = []
            for e in entries:
                if seg_df[name][e["token"]] < min_df:
                    continue
                kept.append({"w": self._display(e["token"]), "n": e["count"],
                             "lr": e["log_ratio"], "g2": e["g2"], "q": e["q"],
                             "ratio": e["rate_ratio"], "s": seg_df[name][e["token"]]})
                if len(kept) >= top:
                    break
            if kept:
                out[name] = kept
        return out

    def _period(self, date: str) -> Optional[str]:
        """``"before"`` / ``"after"`` the split, or None when the date's
        precision straddles it (a bare year in the split's own year, or the
        split's own month when the split is not the 1st)."""
        if not date or len(date) < 4 or not date[:4].isdigit():
            return None
        split = self.period_split
        if len(date) == 4:
            if date == split[:4] and split[5:] != "01-01":
                return None
            date = date + "-01-01"
        elif len(date) == 7:
            if date == split[:7] and split[8:] != "01":
                return None
            date = date + "-01"
        return "before" if date < split else "after"

    def build_keyness(self) -> Dict[str, Any]:
        recs = self.analysed()
        by_rec: Dict[str, Counter] = defaultdict(Counter)
        by_period: Dict[str, Counter] = defaultdict(Counter)
        by_mode: Dict[str, Counter] = defaultdict(Counter)
        df_rec: Dict[str, Counter] = defaultdict(Counter)
        df_period: Dict[str, Counter] = defaultdict(Counter)
        df_mode: Dict[str, Counter] = defaultdict(Counter)
        period_recs: Dict[str, Set[str]] = defaultdict(set)
        sizes = Counter()
        for rec in recs:
            period = self._period(rec.date)
            for seg in rec.segments:
                if not seg.counted:
                    continue
                keys = [t.key for turn in seg.turns
                        for t, lab in zip(turn.tokens, turn.labels) if self._is_content(t.key, lab)]
                distinct = set(keys)
                by_rec[rec.o_id].update(keys)
                df_rec[rec.o_id].update(distinct)
                by_mode[seg.mode].update(keys)
                df_mode[seg.mode].update(distinct)
                sizes["mode:" + seg.mode] += len(keys)
                if period:
                    by_period[period].update(keys)
                    df_period[period].update(distinct)
                    period_recs[period].add(rec.o_id)
        periods_ok = all(len(period_recs[p]) >= 2 for p in ("before", "after"))
        return {
            "generated_at": generate_timestamp(),
            "min_log_ratio": 1.0,
            "by_recording": self._keyness(by_rec, df_rec, min_df=2),
            "by_period": self._keyness(by_period, df_period, min_df=self.min_segments)
            if periods_ok else {},
            "period": {
                "split": self.period_split,
                "recordings": {p: sorted(period_recs[p]) for p in ("before", "after")},
                "undated": sorted(r.o_id for r in recs
                                  if not any(r.o_id in v for v in period_recs.values())),
                "tested": periods_ok,
            },
            "by_mode": self._keyness(by_mode, df_mode, min_df=self.min_segments),
            "mode_tokens": {k.split(":", 1)[1]: v for k, v in sizes.items()},
        }

    # ------------------------------------------------------------------ #
    #  concordance.json — RIGHTS-GATED                                     #
    # ------------------------------------------------------------------ #

    def _snippet(self, text: str, lo: int, hi: int, side: str) -> str:
        """One side of a KWIC line: whitespace collapsed, cut at a word edge.

        Only the OUTER edge is trimmed, as in the laïcité concordance: the
        space between the context and the highlighted match is the only thing
        separating them once the match is its own element.
        """
        piece = re.sub(r"\s+", " ", text[lo:hi])
        if side == "left":
            # Drop a word the window cut in half at its outer edge.
            if lo > 0 and not text[lo - 1].isspace() and not piece.startswith(" "):
                piece = piece.split(" ", 1)[1] if " " in piece else ""
            return piece.lstrip()
        if hi < len(text) and not text[hi].isspace() and not piece.endswith(" "):
            piece = piece.rsplit(" ", 1)[0] if " " in piece else ""
        return piece.rstrip()

    def build_concordance(self, theme: str) -> Dict[str, Any]:
        """KWIC lines for one theme's entries, from public transcripts only.

        One file per theme, because each exhibition section reads its own
        and a reader of the youth section should not download politics.
        """
        recs = self.analysed()
        per_entry: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        withheld = Counter()
        found = Counter()
        for rec in recs:
            for seg in rec.segments:
                for turn in seg.turns:
                    for hit in turn.hits:
                        if hit.entry.theme != theme:
                            continue
                        found[hit.entry.id] += 1
                        if not rec.public:
                            withheld[hit.entry.id] += 1
                            continue
                        start = turn.tokens[hit.start].start
                        end = turn.tokens[hit.end - 1].end
                        per_entry[hit.entry.id].append({
                            "_rec": rec, "_at": start, "e": hit.entry.id,
                            "p": seg.segment.ordinal, "w": seg.segment.index,
                            "of": seg.segment.total, "s": seg.segment.start_seconds,
                            "x": seg.segment.end_seconds, "md": seg.mode,
                            "en": 1 if seg.english else 0,
                            "l": self._snippet(rec.text, max(turn.start, start - self.kwic_context),
                                               start, "left"),
                            "m": " ".join(rec.text[start:end].split()),
                            "r": self._snippet(rec.text, end, min(turn.end, end + self.kwic_context),
                                               "right"),
                        })
        items: List[Dict[str, Any]] = []
        index_of: Dict[str, int] = {}
        rows: List[Dict[str, Any]] = []
        order: List[Tuple[int, int, int]] = []
        emitted = Counter()
        for eid, entry_rows in per_entry.items():
            for row in self._spread(entry_rows, self.kwic_per_entry):
                rec = row.pop("_rec")
                order.append((int(rec.o_id) if rec.o_id.isdigit() else 0, row.pop("_at"), id(row)))
                if rec.o_id not in index_of:
                    index_of[rec.o_id] = len(items)
                    items.append({"o": rec.o_id, "t": rec.title, "u": rec.url, "y": rec.year,
                                  "m": [m["url"] for m in rec.media]})
                row["i"] = index_of[rec.o_id]
                if row["en"] == 0:
                    del row["en"]
                if row["x"] is None:
                    del row["x"]
                rows.append(row)
                emitted[eid] += 1
        # Reading order — recording, then position in it — so the lines of
        # one passage sit together whichever term the reader filters on.
        position = {key: (o, at) for o, at, key in order}
        rows.sort(key=lambda r: position[id(r)])
        return {
            "generated_at": generate_timestamp(),
            "theme": theme,
            "context_chars": self.kwic_context,
            "per_entry_cap": self.kwic_per_entry,
            "items": items,
            "rows": rows,
            "counts": {eid: {"found": found[eid], "withheld": withheld[eid],
                             "emitted": emitted[eid]} for eid in found},
        }

    @staticmethod
    def _spread(rows: List[Dict[str, Any]], cap: int) -> List[Dict[str, Any]]:
        """At most ``cap`` rows, round-robin across recordings.

        Truncating in order would hand the whole budget to the first long
        recording that uses the word. Inside a recording the rows are taken
        in a golden-ratio order, so a recording's share is spread over its
        whole length rather than being its first few minutes.
        """
        if len(rows) <= cap:
            return rows
        by_rec: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        for row in rows:
            by_rec[row["_rec"].o_id].append(row)
        queues = []
        for o_id in sorted(by_rec, key=int):
            queue = by_rec[o_id]
            order = sorted(range(len(queue)), key=lambda i: (i * 0.6180339887) % 1.0)
            queues.append([queue[i] for i in order])
        picked: List[Dict[str, Any]] = []
        depth = 0
        while len(picked) < cap:
            for queue in queues:
                if depth < len(queue) and len(picked) < cap:
                    picked.append(queue[depth])
            depth += 1
        return picked

    # ------------------------------------------------------------------ #
    #  The rights boundary, tested on the payloads                          #
    # ------------------------------------------------------------------ #

    def check_rights(self, bundles: Dict[str, Any]) -> None:
        recs = self.analysed()
        public_ids = {r.o_id for r in recs if r.public}
        for name, payload in bundles.items():
            if not name.startswith(CONCORDANCE_PREFIX):
                continue
            for item in payload.get("items", []):
                if item["o"] not in public_ids:
                    raise RightsError(
                        f"{name} quotes item {item['o']}, whose transcript is private")
        private = [" ".join(fold(w) for w in r.text.split()) for r in recs if not r.public]
        if not private:
            return
        metadata_strings = set()
        for r in self.load():
            metadata_strings.add(r.title)
            metadata_strings.update(r.subjects)
            metadata_strings.add(r.series)
        for name, payload in bundles.items():
            if name.startswith(CONCORDANCE_PREFIX):
                continue
            for value in _strings(payload):
                if value in metadata_strings:
                    continue
                words = value.split()
                if len(words) <= MAX_AGGREGATE_WORDS:
                    continue
                probe = " ".join(fold(w) for w in words)
                if any(probe in text for text in private):
                    raise RightsError(
                        f"{name} carries a {len(words)}-word string found in a private "
                        f"transcript: {value[:60]!r}")

    # ------------------------------------------------------------------ #
    #  Writing                                                             #
    # ------------------------------------------------------------------ #

    def build_all(self) -> Dict[str, Any]:
        collocates = self.build_collocates()
        return {
            "metadata.json": self.build_metadata(),
            "vocabulary.json": self.build_vocabulary(),
            "lexicon.json": self.build_lexicon(),
            "collocates.json": collocates,
            "network.json": self.build_network(collocates),
            "overlap.json": self.build_overlap(),
            "keyness.json": self.build_keyness(),
            **{f"{CONCORDANCE_PREFIX}{theme}.json": self.build_concordance(theme)
               for theme in self.lexicon.themes},
        }

    def write_all(self) -> Dict[str, Any]:
        bundles = self.build_all()
        self.check_rights(bundles)
        out_dir = self.output_dir / "albani-sermons"
        out_dir.mkdir(parents=True, exist_ok=True)
        for name, payload in bundles.items():
            # The metadata is small and read by people; the rest is data.
            save_json(payload, out_dir / name,
                      minify=self.minify if name == "metadata.json" else True)
        meta = bundles["metadata.json"]["totals"]
        self.logger.info(
            f"  albani-sermons: {meta['analysed']} analysed, {meta['legacy']} legacy, "
            f"{meta['untranscribed']} untranscribed; {meta['words']:,} words; "
            f"{sum(len(p['rows']) for n, p in bundles.items() if n.startswith(CONCORDANCE_PREFIX))} "
            f"KWIC lines")
        return bundles

    # ------------------------------------------------------------------ #
    #  The candidate review sheet                                           #
    # ------------------------------------------------------------------ #

    def write_review_sheet(self, path: Path, bundles: Optional[Dict[str, Any]] = None,
                           neighbours: int = 6) -> int:
        """Write the CSV the Hausa-speaking specialist validates (issue #31).

        One row per seed entry, then candidates: top collocates of each
        category not yet in the lexicon, and distributional neighbours of
        the seeds (PPMI + truncated SVD over this corpus). Nothing joins the
        lexicon from here automatically — only rows marked ``accept`` are to
        be folded back into ``albani_lexicon.json`` by hand. Example windows
        come from public transcripts only.
        """
        from albani.neighbours import nearest_neighbours  # numpy only, lazily

        bundles = bundles or self.build_all()
        lexicon = bundles["lexicon.json"]
        collocates = bundles["collocates.json"]["scopes"]["all"]
        examples = self._examples()
        seed_keys = {e.id: [k[0] for k in e.variants if len(k) == 1] for e in self.lexicon.entries}
        all_keys = self.lexicon.single_word_keys()
        top_by_entry = self._entry_collocates()

        rows = []
        for e in lexicon["entries"]:
            rows.append({
                "kind": "seed", "theme": e["theme"], "category": e["category"],
                "form": e["display"], "variants": " | ".join(e["forms"]),
                "layer": e["layer"], "frequency": e["n"]["all"],
                "segments": e["s"]["all"], "recordings": e["r"]["all"],
                "related_to": "", "score": "",
                "top_collocates": ", ".join(top_by_entry.get(e["id"], [])[:8]),
                "examples": "\n".join(examples.get(("e", e["id"]), [])[:3]),
                "flags": "; ".join(filter(None, [
                    "ambiguous" if e["ambiguous"] else "",
                    f"{e['excluded']} excluded by context rule" if e["excluded"] else ""])),
            })
        seen_candidates = set()
        for theme, cats in collocates.items():
            for category, payload in cats.items():
                for t in payload.get("terms", [])[:15]:
                    if t["k"] in all_keys or (theme, t["k"]) in seen_candidates:
                        continue
                    seen_candidates.add((theme, t["k"]))
                    rows.append({
                        "kind": "collocate", "theme": theme, "category": category,
                        "form": t["w"], "variants": " | ".join(self.surfaces.variants(t["k"])),
                        "layer": "", "frequency": t["n"], "segments": t["s"],
                        "recordings": t["r"], "related_to": category,
                        "score": f"log2 ratio {t['lr']}", "top_collocates": "",
                        "examples": "\n".join(examples.get(("k", t["k"]), [])[:3]),
                        "flags": "",
                    })
        vectors_input = []
        for _, seg in self._segments("all"):
            for turn in seg.turns:
                vectors_input.append([t.key for t, lab in zip(turn.tokens, turn.labels)
                                      if self._is_content(t.key, lab)])
        # One query per entry — its commonest single-word form, if it occurs
        # often enough to have a distribution — so the specialist reviews a
        # few neighbours of each term, not eight of every inflected variant.
        query_of = {}
        for e in self.lexicon.entries:
            keys = sorted(seed_keys[e.id], key=lambda k: -self.surfaces.count(k))
            if keys and self.surfaces.count(keys[0]) >= MIN_NEIGHBOUR_QUERY:
                query_of[e.id] = keys[0]
        found = nearest_neighbours(vectors_input, sorted(set(query_of.values())), k=neighbours)
        for e in self.lexicon.entries:
            for key in [query_of[e.id]] if e.id in query_of else []:
                for cand, sim in found.get(key, []):
                    if cand in all_keys or (e.theme, cand) in seen_candidates:
                        continue
                    seen_candidates.add((e.theme, cand))
                    rows.append({
                        "kind": "neighbour", "theme": e.theme, "category": e.category,
                        "form": self._display(cand),
                        "variants": " | ".join(self.surfaces.variants(cand)),
                        "layer": "", "frequency": "", "segments": "", "recordings": "",
                        "related_to": e.display, "score": f"cosine {sim:.2f}",
                        "top_collocates": "",
                        "examples": "\n".join(examples.get(("k", cand), [])[:3]),
                        "flags": "",
                    })
        fields = ["kind", "theme", "category", "form", "variants", "layer", "frequency",
                  "segments", "recordings", "related_to", "score", "top_collocates",
                  "examples", "flags", "decision", "category_assigned", "notes"]
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        # utf-8-sig so a spreadsheet opens ɗ and ƙ correctly.
        with path.open("w", newline="", encoding="utf-8-sig") as fh:
            writer = csv.DictWriter(fh, fieldnames=fields)
            writer.writeheader()
            for row in rows:
                writer.writerow({**row, "decision": "", "category_assigned": "", "notes": ""})
        self.logger.info(f"  review sheet: {len(rows)} rows → {path}")
        return len(rows)

    def _entry_collocates(self) -> Dict[str, List[str]]:
        """Per-entry in-window content words, commonest first — sheet context."""
        out: Dict[str, Counter] = defaultdict(Counter)
        for _, seg in self._segments("all"):
            for turn in seg.turns:
                for hit in turn.hits:
                    positions = _window_positions(hit, len(turn.tokens), self.window)
                    out[hit.entry.id].update(self._content_window(
                        turn, positions, set(range(hit.start, hit.end))))
        return {eid: [self._display(k) for k, _ in c.most_common(12)] for eid, c in out.items()}

    def _examples(self, per_key: int = 3, width: int = 70) -> Dict[Tuple[str, str], List[str]]:
        """Up to three PUBLIC example windows per entry and per content key."""
        out: Dict[Tuple[str, str], List[str]] = defaultdict(list)
        for rec in self.analysed():
            if not rec.public:
                continue
            for seg in rec.segments:
                label = f"[{rec.o_id} part {seg.segment.ordinal}, {window_label(seg.segment)}]"
                for turn in seg.turns:
                    for hit in turn.hits:
                        bucket = out[("e", hit.entry.id)]
                        if len(bucket) < per_key:
                            bucket.append(self._example(rec.text, turn, hit.start, hit.end,
                                                        width, label))
                    for i, tok in enumerate(turn.tokens):
                        bucket = out[("k", tok.key)]
                        if len(bucket) < per_key:
                            bucket.append(self._example(rec.text, turn, i, i + 1, width, label))
        return out

    def _example(self, text: str, turn: TurnScan, a: int, b: int, width: int, label: str) -> str:
        start, end = turn.tokens[a].start, turn.tokens[b - 1].end
        left = self._snippet(text, max(turn.start, start - width), start, "left")
        right = self._snippet(text, end, min(turn.end, end + width), "right")
        return f"{label} …{left.strip()} «{' '.join(text[start:end].split())}» {right.strip()}…"

    def run(self, review_sheet: Optional[Path] = None) -> None:
        bundles = self.write_all()
        if review_sheet:
            self.write_review_sheet(review_sheet, bundles)


def _strings(payload: Any) -> Iterable[str]:
    if isinstance(payload, str):
        yield payload
    elif isinstance(payload, dict):
        for value in payload.values():
            yield from _strings(value)
    elif isinstance(payload, (list, tuple)):
        for value in payload:
            yield from _strings(value)
