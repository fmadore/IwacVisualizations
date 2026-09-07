"""The laïcité dossier generator, one module per bundle.

Mirrors ``asset/js/charts/laicite/`` module for module: what
``collocates.js`` renders, ``collocates.py`` computes. The entry point
stays at ``scripts/generate_laicite.py`` so every existing invocation,
CI step and doc reference keeps working.
"""
from laicite.generator import LaiciteGenerator

__all__ = ["LaiciteGenerator"]
