"""Log-likelihood collocates, and the vocabulary of the unsaid.

``laicite-collocates.json`` and ``laicite-implicit.json``. The implicit
bundle is the interesting half: the words that characterise items carrying
the *Laïcité* tag while never using the word.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any, Dict, List

from iwac_stats import keyness_for_slices
from iwac_utils import generate_timestamp

from laicite.lexicon import COLLOCATE_WINDOW
from laicite.scan import SOURCE_TYPES


class CollocatesMixin:
    """``LaiciteGenerator``'s collocates half. Mixed in by ``laicite.generator``."""


    def build_collocates(self) -> Dict[str, Any]:
        """Log-likelihood collocates of the core forms (issue #14, view 5).

        Five slicings, all through ``iwac_stats.keyness_for_slices``:

        ``global``          in-window vocabulary vs the rest of the same documents
        ``by_source_type``  primary sources vs scholarship (see SOURCE_TYPES)
        ``by_decade``       each decade's window vocabulary vs the other decades'
        ``by_country``      each country's vs the others'
        ``by_subset``       each corpus's vs the others'

        ``by_source_type`` is the one to reach for first when a pooled list
        looks odd: scholarship supplies 44% of all occurrences and is written
        in a different language and register from the sources it analyses, so
        "all together" is a genuine mixture rather than a single population.

        The rest answer "and when/where did that change", which a
        single global list cannot. G² is the significance test only; ranking
        is by log-ratio effect size, with Benjamini–Hochberg correction
        inside each slice — ranking by G² is the classic keyness mistake
        that just returns the corpus's most frequent words.

        Scores are computed over **all** text, public or not: they are
        derived statistics, not verbatim reproduction, and restricting them
        to public rows would throw away most of the scholarship corpus for
        no rights benefit. Reading the actual lines stays gated — that is
        what the concordance is for, and the panel says so.
        """
        scans = self.scan_all()
        self.logger.info("Scoring collocates…")

        pooled_window: Counter = Counter()
        pooled_rest: Counter = Counter()
        by_decade: Dict[str, Counter] = defaultdict(Counter)
        by_country: Dict[str, Counter] = defaultdict(Counter)
        by_subset: Dict[str, Counter] = defaultdict(Counter)
        by_source: Dict[str, Counter] = defaultdict(Counter)
        language_windows = defaultdict(Counter)
        language_rest = defaultdict(Counter)
        decade_items: Counter = Counter()
        country_items: Counter = Counter()
        # Document frequency per slice: how many distinct items a token
        # appears in, as opposed to how many times. See _apply_df_floor.
        df: Dict[str, Counter] = defaultdict(Counter)

        for s in scans:
            if not s.window_tokens:
                continue
            distinct = set(s.window_tokens)
            language = " | ".join(sorted(s.extra.get("languages", []))) or "Unknown"
            language_windows[language].update(s.window_tokens)
            language_rest[language].update(s.rest_tokens)
            df["language:" + language].update(distinct)
            pooled_window.update(s.window_tokens)
            pooled_rest.update(s.rest_tokens)
            by_subset[s.subset].update(s.window_tokens)
            source = SOURCE_TYPES.get(s.subset, "primary")
            by_source[source].update(s.window_tokens)
            df["window"].update(distinct)
            df["subset:" + s.subset].update(distinct)
            df["source:" + source].update(distinct)
            # `references` are deliberately absent from the temporal facet.
            # A reference's pub_date is when the ANALYSIS was published, not
            # when the discourse happened, so a 2022 monograph about the
            # 1990s would contribute its vocabulary to the 2020s slice and
            # misattribute it. (It also happens to be the mostly-anglophone
            # corpus, which was making the 2020s slice read as a list of
            # English function-adjacent words rather than a finding.)
            # Scholarship keeps its own slice under `by_subset`.
            if s.year and s.subset != "references":
                decade = f"{s.year // 10 * 10}s"
                by_decade[decade].update(s.window_tokens)
                decade_items[decade] += 1
                df["decade:" + decade].update(distinct)
            for country in s.countries:
                by_country[country].update(s.window_tokens)
                country_items[country] += 1
                df["country:" + country].update(distinct)

        def score(slices: Dict[str, Counter], min_count: int) -> Dict[str, Any]:
            # Two-slice comparisons need both sides populated; a slice with
            # nothing to compare against is dropped by keyness_for_slices.
            usable = {k: v for k, v in slices.items() if sum(v.values()) > 0}
            if len(usable) < 2:
                return {}
            return keyness_for_slices(
                usable, top_n=len(set().union(*(set(c) for c in usable.values()))), min_count=min_count)

        global_scored = score(
            {"window": pooled_window, "rest": pooled_rest}, self.min_collocate_count)
        global_list = self._apply_df_floor(
            global_scored.get("window", []), df["window"])

        # Thin slices cannot support the corpus-wide min_count, so drop
        # slices too small to test rather than reporting noise from them.
        def prune(slices: Dict[str, Counter], items: Counter, floor: int
                  ) -> Dict[str, Counter]:
            return {k: v for k, v in slices.items() if items.get(k, 0) >= floor}

        decades = prune(by_decade, decade_items, self.min_country_items)
        countries = prune(by_country, country_items, self.min_country_items)

        dropped_decades = sorted(set(by_decade) - set(decades))
        dropped_countries = sorted(set(by_country) - set(countries))
        if dropped_decades or dropped_countries:
            # Never cap coverage silently: a slice missing from the panel
            # must be explainable, not merely absent.
            self.logger.info(
                f"  collocates: dropped thin slices — decades {dropped_decades}, "
                f"countries {dropped_countries} (< {self.min_country_items} items)")

        # Both source-type slices are large (roughly 11.5k vs 9.2k
        # occurrences), so they carry the full corpus-wide min_count rather
        # than the relaxed thin-slice one.
        by_source_type = self._floor_slices(
            score(by_source, self.min_collocate_count), df, "source:")
        by_subset_scored = self._floor_slices(
            score(by_subset, self.min_slice_count), df, "subset:")
        dropped_subsets = sorted(set(by_subset) - set(by_subset_scored))
        if dropped_subsets:
            self.logger.info(
                f"  collocates: no token cleared the document-frequency floor "
                f"in subsets {dropped_subsets}")

        out = {
            "generated_at": generate_timestamp(),
            "window": COLLOCATE_WINDOW,
            "method": (
                "Dunning log-likelihood as the significance test, "
                "Benjamini-Hochberg corrected within each slice, ranked by "
                "log-ratio effect size."
            ),
            "reference": (
                "The rest of the same documents — a collocate sits near the "
                "word more than it does elsewhere in writing already about it."
            ),
            "source_scope": (
                "Press, periodicals, archives and YouTube are primary sources; "
                "scholarship is separate. Language, genre and length can "
                "confound pooled comparisons. Use the within-language view "
                "to compare keyword windows with the rest of those texts."
            ),
            "decade_scope": (
                "Press, periodicals and archival documents only. Scholarship "
                "is excluded from the temporal slices: a reference is dated by "
                "when the analysis was published, not by the period it "
                "analyses, so it would misattribute its vocabulary to the "
                "decade it was written in."
            ),
            "min_count": self.min_collocate_count,
            "top_n": self.top_collocates,
            "min_document_frequency": self.min_document_frequency,
            "global": global_list,
            "by_language": {lang: self._apply_df_floor(
                score({"window": window, "rest": language_rest[lang]},
                      self.min_collocate_count).get("window", []), df["language:" + lang])
                for lang, window in language_windows.items()},
            "comparators": {"global": "windows_vs_rest_same_documents",
                            "by_language": "windows_vs_rest_same_language_documents",
                            "other_slices": "windows_vs_other_slices_windows"},
            "by_source_type": by_source_type,
            "by_decade": self._floor_slices(
                score(decades, self.min_slice_count), df, "decade:"),
            "by_country": self._floor_slices(
                score(countries, self.min_slice_count), df, "country:"),
            "by_subset": by_subset_scored,
            "slice_sizes": {
                "decade": {k: decade_items[k] for k in decades},
                "country": {k: country_items[k] for k in countries},
                "subset": {k: sum(1 for s in scans if s.subset == k and s.window_tokens)
                           for k in by_subset},
                "source_type": {
                    k: sum(1 for s in scans
                           if SOURCE_TYPES.get(s.subset) == k and s.window_tokens)
                    for k in by_source
                },
            },
            "source_members": {
                k: sorted(sub for sub, t in SOURCE_TYPES.items() if t == k)
                for k in by_source
            },
            "dropped_slices": {
                "decades": dropped_decades, "countries": dropped_countries,
                "reason": f"fewer than {self.min_country_items} items",
                # A different reason, so a different key: these slices were
                # large enough to test and simply produced nothing that
                # appears in enough distinct documents to be vocabulary.
                "subsets": dropped_subsets,
                "subsets_reason": (
                    f"no token appeared in at least "
                    f"{self.min_document_frequency} distinct documents"
                ),
            },
        }
        self.logger.info(
            f"  collocates: {len(out['global'])} global, "
            f"{len(out['by_source_type'])} source types, "
            f"{len(out['by_decade'])} decades, {len(out['by_country'])} countries "
            f"(document-frequency floor {self.min_document_frequency})")
        return out

    def _apply_df_floor(
        self, scored: List[Dict[str, Any]], df: Counter
    ) -> List[Dict[str, Any]]:
        """Drop tokens confined to too few documents, and record the DF.

        A token repeated many times inside one or two items scores as
        strongly as one used steadily across fifty — but the first is
        usually an artefact (a scanner watermark stamped on every page, a
        proper name recurring through one long interview, a mis-OCRed word
        repeated down one bad scan) and the second is vocabulary. Requiring
        presence in several distinct documents separates them without
        touching domain terms, which recur across documents by nature.

        Applied AFTER scoring, so the Benjamini-Hochberg denominator still
        covers every token that was actually tested.
        """
        proper = self._entity_tokens()
        out = []
        for entry in scored:
            n_docs = int(df.get(entry["token"], 0))
            if n_docs < self.min_document_frequency:
                continue
            entry = dict(entry)
            entry["documents"] = n_docs
            # Catalogued entity names are kept and MARKED rather than
            # dropped: "who was speaking laïcité in this decade" is a
            # finding, not noise. They are excluded only from the implicit
            # lexicon, where the slice is small enough that they crowd out
            # everything else.
            if entry["token"] in proper:
                entry["proper"] = True
            out.append(entry)
        return out[:self.top_collocates]

    def _floor_slices(
        self, scored: Dict[str, List[Dict[str, Any]]], df: Dict[str, Counter],
        prefix: str,
    ) -> Dict[str, List[Dict[str, Any]]]:
        """``_apply_df_floor`` across every slice of one facet."""
        out = {}
        for name, entries in scored.items():
            kept = self._apply_df_floor(entries, df.get(prefix + name, Counter()))
            if kept:
                out[name] = kept
        return out

    def build_implicit(self) -> Dict[str, Any]:
        """The vocabulary of the tagged-but-unsaid (review idea A).

        Items an archivist indexed under *Laïcité* that never use the word
        looked like a natural experiment: what vocabulary does the press use
        to argue laïcité *without* the term? Keyness of that slice against
        the items that do say it should answer directly.

        **Measured, it does not.** The idea was proposed expecting ~232 such
        articles, from the issue's arithmetic of 513 tagged minus 281 saying
        "laïcité". Counting the full core lexicon (``laïque``, ``laïc``,
        ``laïcisation``, …) rather than the single word leaves only **53**,
        and at that size the test has nothing to find: of the terms reaching
        significance, almost every one occurs in a single document. Requiring
        presence in even three of the 53 leaves a handful, and those are
        still names too local to be in the authority file, or one-off nouns
        from one article.

        So this builder reports a **negative result** rather than a ranked
        list: the 53 items appear to be tagged for heterogeneous reasons —
        each about its own matter — not because a consistent alternative
        vocabulary for laïcité exists in them. That is worth stating, and it
        is a far more defensible thing to publish than a list of surnames
        dressed as a discovery. The diagnostics that support the verdict ship
        alongside it so a reader can check the reasoning, and the moment the
        slice grows the same code yields a real list.
        """
        scans = self.scan_all()
        proper = self._entity_tokens()
        tagged_only: Counter = Counter()
        said: Counter = Counter()
        df_tagged: Counter = Counter()
        n_tagged_only = n_said = 0
        for s in scans:
            vocab = s.window_tokens + s.rest_tokens
            if s.is_tagged and not s.said:
                tagged_only.update(vocab)
                df_tagged.update(set(vocab))
                n_tagged_only += 1
            elif s.said:
                said.update(vocab)
                n_said += 1

        # Catalogued entity names are removed from BOTH sides here. With a slice this
        # small every name is perfectly slice-specific, so an unfiltered run
        # returns a list of people and organisations that appear in a handful
        # of Beninese articles — true, but it answers "who is named in these
        # 53 documents", not "how is laïcité argued without the word".
        for counter in (tagged_only, said):
            for token in list(counter):
                if token in proper:
                    del counter[token]

        scored: Dict[str, Any] = {}
        significant: List[Dict[str, Any]] = []
        if n_tagged_only and n_said:
            scored = keyness_for_slices(
                {"tagged_only": tagged_only, "said": said},
                top_n=len(set(tagged_only) | set(said)),
                min_count=max(3, self.min_slice_count // 2),
            )
            significant = [
                dict(e, documents=int(df_tagged.get(e["token"], 0)))
                for e in scored.get("tagged_only", [])
            ]

        # A term confined to one or two of ~50 documents is that document's
        # subject matter, not the slice's signature.
        surviving = [
            e for e in significant
            if e["documents"] >= self.min_implicit_documents
        ]
        spread = Counter(
            min(e["documents"], 5) for e in significant
        )
        # The verdict the panel renders. "supported" only when enough terms
        # recur across documents to describe a shared vocabulary at all.
        has_vocabulary = len(surviving) >= self.min_implicit_terms
        self.logger.info(
            f"  implicit lexicon: {n_tagged_only} tagged-but-unsaid vs {n_said} "
            f"saying items → {len(significant)} significant, {len(surviving)} "
            f"in ≥{self.min_implicit_documents} documents → "
            f"{'shared vocabulary' if has_vocabulary else 'NO shared vocabulary'}")
        return {
            "generated_at": generate_timestamp(),
            "slice_sizes": {"tagged_only": n_tagged_only, "said": n_said},
            "tokens_tested": {
                "tagged_only": sum(tagged_only.values()),
                "said": sum(said.values()),
            },
            "note": (
                "Keyness of items tagged Laïcité that never use the word, "
                "against those that do. Catalogued entity names are removed "
                "from both sides, and a term must recur across distinct "
                "documents to count — otherwise the list is just the names "
                "and one-off nouns of a handful of items."
            ),
            "min_documents": self.min_implicit_documents,
            "min_terms_for_verdict": self.min_implicit_terms,
            "entity_names_excluded": True,
            # The verdict, and the evidence for it. `has_vocabulary` is what
            # the panel branches on: when false it states the negative result
            # instead of rendering `terms`, because a ranked list of
            # single-document words reads as a discovery when it is not one.
            "has_vocabulary": has_vocabulary,
            "diagnostics": {
                "significant_terms": len(significant),
                "surviving_terms": len(surviving),
                # How many documents each significant term occurs in, capped
                # at 5+. A distribution piled on 1 is the whole argument.
                "document_spread": {str(k): spread.get(k, 0) for k in range(1, 6)},
            },
            "verdict_is_heuristic": True,
            "terms": surviving[:self.top_collocates],
            # Kept for audit even when the verdict is negative: a reader
            # should be able to see exactly what was rejected and why.
            "rejected_terms": [
                e for e in significant
                if e["documents"] < self.min_implicit_documents
            ][:40],
        }
