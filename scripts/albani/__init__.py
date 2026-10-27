"""The Albani Zaria sermons generator (issue #31), one module per concern.

``transcript`` parses the markup, ``normalize`` folds and tokenizes the
Hausa/Arabic text, ``layers`` separates exposition from citation, ``lexicon``
matches the curated research vocabulary, ``corpus`` selects and reads the
recordings, and ``generator`` writes the bundles the ``albani-sermons`` page
block reads.
"""
from albani.generator import AlbaniSermonsGenerator  # noqa: F401
