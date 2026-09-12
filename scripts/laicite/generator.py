"""``LaiciteGenerator`` — the class the fifteen view modules are mixed into.

**Why this file is short.** The generator used to be 2,420 lines and 41
methods in one class, which is a poor fit for what it actually is: a shared
scan (``laicite.scan``) plus fifteen independent bundle builders that read
the resulting ``List[ItemScan]`` and write one JSON file each. The package
now mirrors ``asset/js/charts/laicite/`` module for module, and this file
holds only what is genuinely shared — the run's parameters, the composition,
and ``write_all``, which is the map of which builder writes which bundle.

Each view is a mixin rather than a collaborator object because every builder
reads the same handful of run parameters and the same ``self.scans``; passing
that state explicitly to fifteen constructors would be more plumbing, not
less. The mixins are behaviourally identical to the methods they were —
``build_x`` still means the same thing, ``self`` still resolves the same way.
"""
from __future__ import annotations

import logging
import random
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

import pandas as pd

from iwac_utils import DATASET_ID, save_json

from laicite.lexicon import Lexicon
from laicite.scan import ItemScan

from laicite.scan import ScanMixin
from laicite.overview import OverviewMixin
from laicite.documents import DocumentsMixin
from laicite.trends import TrendsMixin
from laicite.collocates import CollocatesMixin
from laicite.corpora import CorporaMixin
from laicite.actors import ActorsMixin
from laicite.arenas import ArenasMixin
from laicite.sentiment import SentimentMixin
from laicite.semantic import SemanticMixin
from laicite.bylines import BylinesMixin
from laicite.circulation import CirculationMixin
from laicite.places import PlacesMixin
from laicite.references import ReferencesMixin
from laicite.concordance import ConcordanceMixin
from laicite.research import ResearchMixin


class LaiciteGenerator(
    ScanMixin,
    OverviewMixin,
    DocumentsMixin,
    TrendsMixin,
    CollocatesMixin,
    CorporaMixin,
    ActorsMixin,
    ArenasMixin,
    SentimentMixin,
    SemanticMixin,
    BylinesMixin,
    CirculationMixin,
    PlacesMixin,
    ReferencesMixin,
    ConcordanceMixin,
    ResearchMixin,
):
    """Build the laïcité dossier bundles from five IWAC subsets.

    The bases are the fifteen view modules; the order is the order
    ``write_all`` writes them, and none of them override each other's names.
    """

    def __init__(
        self,
        output_dir: Path,
        repo_id: str = DATASET_ID,
        minify: bool = False,
        max_snippets: int = 3000,
        min_country_items: int = 3,
        top_collocates: int = 40,
        min_collocate_count: int = 8,
        min_slice_count: int = 5,
        min_document_frequency: int = 3,
        min_implicit_documents: int = 4,
        min_implicit_terms: int = 8,
        min_newspaper_items: int = 5,
        min_actor_items: int = 4,
        min_place_items: int = 3,
        min_byline_items: int = 3,
        seed: int = 20260804,
    ):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.repo_id = repo_id
        self.minify = minify
        self.max_snippets = max_snippets
        self.min_country_items = min_country_items
        self.top_collocates = top_collocates
        self.min_collocate_count = min_collocate_count
        self.min_slice_count = min_slice_count
        self.min_document_frequency = min_document_frequency
        self.min_implicit_documents = min_implicit_documents
        self.min_implicit_terms = min_implicit_terms
        self.min_newspaper_items = min_newspaper_items
        self.min_actor_items = min_actor_items
        self.min_place_items = min_place_items
        self.min_byline_items = min_byline_items
        self._entities: Optional[Set[str]] = None
        #: Cached (X, scans) from _member_embeddings — two views need it.
        self._member_vectors: Optional[Tuple[Any, List["ItemScan"]]] = None
        self._index_df: Optional[pd.DataFrame] = None
        self._index_loaded = False
        #: Resolved per-model sentiment column names, filled while scanning
        #: `articles` (the only subset that carries them).
        self._sentiment_cols: Dict[str, Dict[str, Optional[str]]] = {}
        self.rng = random.Random(seed)
        self.lex = Lexicon()
        self.logger = logging.getLogger(__name__)

        self.scans: List[ItemScan] = []
        self.texts: Dict[Tuple[str, str], Dict[str, str]] = {}
        self.subset_totals: Dict[str, int] = {}
        self.subset_public: Dict[str, int] = {}
        self.subset_fulltext: Dict[str, int] = {}
        self.source_records = []
        self._sentiment_source_rows = []
        self.laity_by_subset: Dict[str, int] = defaultdict(int)
        self.state_by_subset: Dict[str, int] = defaultdict(int)
        #: Sentiment over the WHOLE `articles` corpus, dossier or not. The
        #: comparison is what turns view 9 from a table into a finding, and
        #: it is free here — the rows are already in memory during the scan.
        self._baseline_sentiment: Dict[str, Dict[str, Any]] = {}

    def write_all(self) -> None:
        self.scan_all()

        save_json(self.build_research(), self.output_dir / "laicite-research.json", minify=True)

        metadata = self.build_metadata()
        save_json(metadata, self.output_dir / "laicite-metadata.json",
                  minify=self.minify)

        documents = self.build_documents()
        save_json(documents, self.output_dir / "laicite-documents.json",
                  minify=self.minify)

        countries = self.build_countries()
        save_json(countries, self.output_dir / "laicite-countries.json",
                  minify=self.minify)

        # Data-heavy bundles are always minified regardless of --minify:
        # never human-diffed, not committed, lazy-loaded client-side —
        # the same rule the scary-terms trends/wordcloud/places bundles use.
        trends = self.build_trends()
        save_json(trends, self.output_dir / "laicite-trends.json", minify=True)

        # Phase 2 — corpus linguistics. Each is lazy-loaded by its own view.
        save_json(self.build_collocates(),
                  self.output_dir / "laicite-collocates.json", minify=True)
        save_json(self.build_implicit(),
                  self.output_dir / "laicite-implicit.json", minify=self.minify)
        save_json(self.build_corpora(),
                  self.output_dir / "laicite-corpora.json", minify=self.minify)
        save_json(self.build_seasonality(),
                  self.output_dir / "laicite-seasonality.json", minify=self.minify)

        # Phase 3 — context. Same lazy-load contract as Phase 2: each is
        # fetched only when its view first activates.
        save_json(self.build_actors(),
                  self.output_dir / "laicite-actors.json", minify=True)
        save_json(self.build_arenas(),
                  self.output_dir / "laicite-arenas.json", minify=True)
        save_json(self.build_sentiment(),
                  self.output_dir / "laicite-sentiment.json", minify=True)
        save_json(self.build_places(),
                  self.output_dir / "laicite-places.json", minify=True)
        save_json(self.build_semantic(),
                  self.output_dir / "laicite-semantic.json", minify=True)
        save_json(self.build_circulation(),
                  self.output_dir / "laicite-circulation.json", minify=True)
        save_json(self.build_bylines(),
                  self.output_dir / "laicite-bylines.json", minify=self.minify)
        save_json(self.build_references(),
                  self.output_dir / "laicite-references.json", minify=True)

        index, files = self.build_concordance()
        save_json(index, self.output_dir / "laicite-concordance.json",
                  minify=self.minify)
        for subset, payload in files.items():
            save_json(payload,
                      self.output_dir / f"laicite-concordance-{subset}.json",
                      minify=True)

    def run(self) -> None:
        self.write_all()
        self.logger.info("Laïcité data generation complete")
