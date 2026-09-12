"""Per-model AI framing against a baseline — ``laicite-sentiment.json``.

The register accumulators live here too: readability and lexical richness
each count their own n, because an article scored for one and not the other
must not be silently read as scoring zero on the second.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any, Dict, Optional

from iwac_utils import (
    generate_timestamp,
    present_sentiment_models,
    subjectivite_ordinal,
)

from laicite.register import _register_bucket, _register_add, _register_means



class SentimentMixin:
    """``LaiciteGenerator``'s sentiment half. Mixed in by ``laicite.generator``."""


    def build_sentiment(self) -> Dict[str, Any]:
        """AI framing of laïcité coverage (view 9).

        `articles` only — the sentiment annotation exists on no other
        subset. Models are reported side by side rather than averaged:
        they disagree, and an average would hide both the disagreement and
        the fact that each figure is model output rather than catalogued
        metadata.

        Subjectivity ships as the full 1-5 distribution, never as a mean.
        The corpus mean is about 3 and the distribution is bimodal — laicite
        coverage splits into a factual register and a polemical one, and the
        mean lands in the trough between them where almost nothing sits.

        Every distribution is paired with the same distribution over the
        whole `articles` corpus, so the panel can answer "is this coverage
        unusual" rather than only "what does it look like".

        The `register` block extends that with the obvious follow-up: the
        subjectivity distribution says the dossier splits into two
        registers, and says nothing about whether they differ in anything
        else. Flesch readability and MATTR lexical richness, per
        subjectivity level, against the corpus at the same level, are the
        two columns that can answer it — see the accumulator notes above
        for what may and may not be done to them.
        """
        scans = self.scan_all()
        articles = [s for s in scans if s.subset == "articles"]
        # `self._sentiment_cols[m]` is a dict of three Nones for a model
        # with no columns, and a non-empty dict is truthy — the obvious
        # `if self._sentiment_cols.get(m)` kept every model in
        # SENTIMENT_MODELS and gave the block a picker entry backed by
        # nothing. present_sentiment_models tests the values.
        models = present_sentiment_models(self._sentiment_cols)

        by_model: Dict[str, Any] = {}
        for model in models:
            polarity: Counter = Counter()
            centrality: Counter = Counter()
            subjectivity: Counter = Counter()
            pol_by_decade: Dict[str, Counter] = defaultdict(Counter)
            pol_by_paper: Dict[str, Counter] = defaultdict(Counter)
            paper_items: Counter = Counter()
            register: Dict[int, Dict[str, float]] = defaultdict(_register_bucket)
            rated = 0

            for s in articles:
                entry = (s.extra.get("sentiment") or {}).get(model) or {}
                if not entry:
                    continue
                rated += 1
                decade = self._decade(s.year)
                pol = entry.get("polarite")
                if pol:
                    polarity[pol] += 1
                    if decade:
                        pol_by_decade[decade][pol] += 1
                    if s.newspaper:
                        pol_by_paper[s.newspaper][pol] += 1
                        paper_items[s.newspaper] += 1
                if entry.get("centralite"):
                    centrality[entry["centralite"]] += 1
                level = self._subjectivity_level(entry.get("subjectivite"))
                if level is not None:
                    subjectivity[level] += 1
                    _register_add(register[level], s.readability, s.richness)

            papers = [
                {
                    "newspaper": name,
                    "items": paper_items[name],
                    "polarity": dict(pol_by_paper[name]),
                }
                for name, n in paper_items.most_common()
                if n >= self.min_newspaper_items
            ]
            base = self._baseline_sentiment.get(model, {})
            by_model[model] = {
                "matched": self._matched_sentiment(model),
                "property_coverage": {"polarity": sum(polarity.values()),
                    "centrality": sum(centrality.values()), "subjectivity": sum(subjectivity.values())},
                "rated": rated,
                "polarity": dict(polarity),
                "centrality": dict(centrality),
                "subjectivity": [subjectivity.get(i, 0) for i in range(1, 6)],
                "polarity_by_decade": {
                    d: dict(c) for d, c in sorted(pol_by_decade.items())
                },
                "by_newspaper": papers,
                # Register: is the polemical half of the bimodal
                # subjectivity distribution also lexically distinct? Five
                # levels, each carrying both metrics for the dossier and
                # for the whole corpus at that same level.
                "register": [
                    {
                        "level": level,
                        "dossier": _register_means(register[level]),
                        "corpus": _register_means(
                            base.get("register", {}).get(level) or _register_bucket()
                        ),
                    }
                    for level in range(1, 6)
                ],
                "corpus": {
                    "rated": base.get("rated", 0),
                    "polarity": dict(base.get("polarity", {})),
                    "subjectivity": [
                        base.get("subjectivity", {}).get(i, 0) for i in range(1, 6)
                    ],
                },
            }

        self.logger.info(
            "  sentiment: " + ", ".join(
                f"{m} {by_model[m]['rated']}/{len(articles)}" for m in models)
            or "  sentiment: no model columns present")
        return {
            "generated_at": generate_timestamp(),
            "models": models,
            "items": len(articles),
            "corpus_items": self.subset_totals.get("articles", 0),
            "min_newspaper_items": self.min_newspaper_items,
            "by_model": by_model,
            # Derived from the resolved roster rather than spelled out:
            # this sentence named the January-February 2026 generation-1
            # models for one release after the generator had already been
            # repointed at the generation-2 columns, i.e. it told readers
            # the wrong models had produced the numbers on screen. A
            # hand-maintained list beside a constant is a list that goes
            # stale — and so is a hand-written count, hence no "Three".
            "ai_note": (
                "These values are model output, not catalogued metadata. "
                "Each of these models annotated the corpus independently: "
                + ", ".join(m.replace("_", "-") for m in models[:-1])
                + (" and " if len(models) > 1 else "")
                + (models[-1].replace("_", "-") if models else "")
                + ". They are reported separately because they disagree."
            ),
        }

    @staticmethod
    def _subjectivity_level(value: Any) -> Optional[int]:
        """The 1-5 subjectivity scale, from either a label or a number.

        Thin wrapper so the two call sites keep reading as domain code;
        the label table itself is shared with every other generator.
        """
        return subjectivite_ordinal(value)

    def _matched_sentiment(self, model):
        """Exact strata, per property, without replacement across strata.

        Controls are non-dossier articles. Weight each eligible control stratum
        to the corresponding dossier stratum. Unmatched targets are reported.
        """
        out = {}
        columns = self._sentiment_cols.get(model, {})
        for prop, column in columns.items():
            if not column:
                continue
            groups = defaultdict(lambda: [Counter(), Counter()])
            eligible = 0
            for record, values in self._sentiment_source_rows:
                value = values.get(column)
                if value is None or str(value).strip() in ("", "nan", "None"):
                    continue
                if not record["year"] or not record["outlet"] or not record["countries"]:
                    eligible += int(record["selected"])
                    continue
                key = (tuple(sorted(record["countries"])), record["year"], record["outlet"])
                groups[key][0 if record["selected"] else 1][str(value)] += 1
                eligible += int(record["selected"])
            target, baseline = Counter(), Counter()
            controls, strata = 0, 0
            for a, b in groups.values():
                if not a or not b:
                    continue
                n, m = sum(a.values()), sum(b.values())
                target.update(a)
                baseline.update({k: v * n / m for k, v in b.items()})
                controls += m
                strata += 1
            out[prop] = {"dossier": dict(target), "weighted_controls": dict(baseline),
                         "matched": sum(target.values()), "eligible": eligible,
                         "control_items": controls, "strata": strata}
        return out
