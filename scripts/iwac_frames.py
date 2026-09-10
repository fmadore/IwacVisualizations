"""Process-level memo for Hugging Face subset loads.

**Why this exists.** The 31 generators call
:func:`iwac_utils.load_dataset_safe` 43 times between them, and a CI run
executes them as 31 separate interpreters — so the same seven subsets are
converted to pandas roughly ninety times, ``articles`` about twenty-six of
them. :func:`iwac_utils.load_dataset_safe` says in its own docstring that
the pandas conversion, not the download, is where the memory goes; the
per-run Hugging Face cache added in v1.59.0 (P2) removed the downloads and
left every one of those conversions in place.

A :class:`FrameStore` closes that gap **without touching a single call
site**. It is installed onto ``iwac_utils`` by
:mod:`run_all`; ``load_dataset_safe`` then routes through it, so a
generator's code is identical whether it runs under the runner or as
``python scripts/generate_x.py``. With no store installed the behaviour is
exactly today's — one load per call, nothing retained — which is what
happens for every direct invocation and for the whole test suite.

**One frame per subset, widened on demand.** The store keeps the union of
the columns asked for so far. A generator that wants five scalar columns
gets a five-column load; a later generator that wants the OCR text widens
the cached frame once and every subsequent caller is served from it. A
``columns=None`` request means the whole schema, so it widens the entry to
everything and pins the wide frame for the rest of the run — which is
precisely the sharing that the ~20 unprojected ``articles`` loads want.

**Mutation safety.** pandas 3.x is copy-on-write only, so a projection
handed out here cannot write through to the cached frame, and a caller that
adds or drops a column is working on its own shallow copy's axes. That is
what makes handing out the cached data — rather than a defensive deep copy
per caller — correct rather than merely fast.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

from iwac_utils import DATASET_ID

logger = logging.getLogger(__name__)


# ``columns`` is None for "the whole schema"; otherwise the union of every
# column any caller has asked for so far.
_Key = Tuple[str, str, str]


class _Entry:
    """One cached subset: the frame, and which columns it covers."""

    __slots__ = ("frame", "columns", "failed")

    def __init__(
        self,
        frame: Optional[pd.DataFrame],
        columns: Optional[List[str]],
        failed: bool = False,
    ) -> None:
        self.frame = frame
        self.columns = columns
        self.failed = failed

    def covers(self, want: Optional[List[str]]) -> bool:
        """True when this entry can serve a request for ``want``."""
        if self.columns is None:
            return True            # the whole schema covers anything
        if want is None:
            return False           # a narrow entry cannot serve a wide request
        return set(want).issubset(self.columns)


class FrameStore:
    """Memoize subset loads for the lifetime of one process.

    Args:
        repo_id: Default repository, used only for logging and for the
            ``stats()`` summary; each :meth:`get` carries its own.
        max_subsets: Evict the least-recently-used subset once more than
            this many are held (0 = unbounded). The runner sets a small
            bound so that holding ``articles`` wide does not stack with
            ``publications`` wide while a UMAP fit is running.
    """

    def __init__(self, repo_id: str = DATASET_ID, max_subsets: int = 0) -> None:
        self.repo_id = repo_id
        self.max_subsets = max_subsets
        self._entries: Dict[_Key, _Entry] = {}
        self._order: List[_Key] = []          # LRU, oldest first
        self.hits = 0
        self.loads = 0
        self.widenings = 0

    # -- internals ---------------------------------------------------------

    def _touch(self, key: _Key) -> None:
        if key in self._order:
            self._order.remove(key)
        self._order.append(key)

    def _evict_if_needed(self) -> None:
        if not self.max_subsets:
            return
        while len(self._order) > self.max_subsets:
            victim = self._order.pop(0)
            self._entries.pop(victim, None)
            logger.debug("FrameStore: evicted '%s' from %s", victim[1], victim[0])

    @staticmethod
    def _union(
        held: Optional[List[str]],
        want: Optional[List[str]],
    ) -> Optional[List[str]]:
        """The columns to load so that both requests are served.

        ``None`` on either side means "the whole schema", which absorbs
        the other.
        """
        if held is None or want is None:
            return None
        merged = list(held)
        merged.extend(c for c in want if c not in held)
        return merged

    def _project(
        self,
        frame: pd.DataFrame,
        config_name: str,
        columns: Optional[List[str]],
    ) -> pd.DataFrame:
        """Serve ``columns`` out of a cached frame, in the caller's order.

        Mirrors ``load_dataset_safe``'s contract: a requested column the
        subset does not have is skipped with a warning rather than raising,
        so one column list can be shared across subsets whose schemas
        differ slightly.
        """
        if columns is None:
            # A shallow copy: the data blocks are shared (and copy-on-write
            # protected), but adding or dropping a column on the result
            # cannot change what the next caller sees.
            return frame.copy(deep=False)
        keep = [c for c in columns if c in frame.columns]
        missing = sorted(set(columns) - set(keep))
        if missing:
            logger.warning(
                f"Subset '{config_name}' lacks requested column(s): {missing}"
            )
        return frame[keep]

    # -- the public surface ------------------------------------------------

    def get(
        self,
        config_name: str,
        repo_id: str = DATASET_ID,
        token: Optional[str] = None,
        columns: Optional[List[str]] = None,
        required: bool = False,
    ) -> Optional[pd.DataFrame]:
        """``load_dataset_safe`` semantics, served from the memo when possible."""
        # Imported here rather than at module scope so that installing the
        # store cannot introduce an import cycle: iwac_utils never imports
        # this module.
        import iwac_utils

        try:
            revision = iwac_utils.dataset_revision(repo_id, token)
        except Exception:
            if required:
                raise
            logger.warning("Could not resolve dataset revision for %s", repo_id)
            return None
        key = (repo_id, config_name, revision)
        entry = self._entries.get(key)

        if entry is not None and entry.failed:
            # One failed load is enough; every generator in the run would hit
            # the same 401 or the same missing subset. `required` is still the
            # caller's own decision.
            return self._fail(config_name, repo_id, required)

        if entry is not None and entry.covers(columns):
            self.hits += 1
            self._touch(key)
            assert entry.frame is not None
            logger.info(
                "Reusing cached subset '%s' (%d records)",
                config_name,
                len(entry.frame),
            )
            # An empty subset was a hard error for a `required` caller before
            # it was cached, and stays one after.
            if required and entry.frame.empty:
                raise RuntimeError(
                    f"Required subset '{config_name}' from {repo_id} is empty."
                )
            return self._project(entry.frame, config_name, columns)

        want = self._union(entry.columns if entry else columns, columns)
        if entry is not None:
            self.widenings += 1
            logger.info(
                "Widening cached subset '%s' to %s column(s)",
                config_name,
                "all" if want is None else len(want),
            )

        self.loads += 1
        # `required` goes through to the real loader so that a first failure
        # raises with the diagnostics it has and this store does not (the
        # private-mirror 401 hint, the underlying exception text).
        frame = iwac_utils._load_subset_frame(
            config_name, repo_id=repo_id, token=token,
            columns=want, required=required,
        )

        if frame is None:
            self._entries[key] = _Entry(None, None, failed=True)
            self._touch(key)
            return self._fail(config_name, repo_id, required)

        self._entries[key] = _Entry(frame, want)
        self._touch(key)
        self._evict_if_needed()
        return self._project(frame, config_name, columns)

    @staticmethod
    def _fail(config_name: str, repo_id: str, required: bool) -> None:
        if required:
            raise RuntimeError(
                f"Required subset '{config_name}' could not be loaded from {repo_id}"
            )
        return None

    def clear(self) -> None:
        """Drop everything held. The runner calls this between heavy phases."""
        self._entries.clear()
        self._order.clear()

    def stats(self) -> Dict[str, Any]:
        """Counters for the run summary."""
        return {
            "loads": self.loads,
            "hits": self.hits,
            "widenings": self.widenings,
            "held": [name for _repo, name, _revision in self._order],
        }
