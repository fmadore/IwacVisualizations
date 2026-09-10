import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
import iwac_utils
import validate_data as validation
from run_all import GENERATORS
import numpy as np
from iwac_embeddings import rank_cosine_matrix


class PublicationTests(unittest.TestCase):
    def test_columnar_semantic_ids_are_validated_individually(self):
        sources = {'articles': {'ids': ['1', '2'], 'publicOcrIds': []}}
        self.assertFalse(validation.check_references('laicite-semantic.json', {'o_id': [1, 2]}, sources))
        self.assertEqual(validation.check_references('laicite-semantic.json', {'o_id': [1, 999]}, sources),
                         ['laicite-semantic.json: unknown item 999'])

    def test_dashboard_identity_matches_filename_and_source_subset(self):
        sources = {'articles': {'ids': ['1', '2'], 'publicOcrIds': []},
                   'publications': {'ids': ['3'], 'publicOcrIds': []}}
        self.assertFalse(validation.check_references('article-dashboards/1.json', {'article': {'o_id': 1}}, sources))
        self.assertTrue(validation.check_references('article-dashboards/1.json', {'article': {'o_id': 2}}, sources))
        self.assertTrue(validation.check_references('article-dashboards/3.json', {'article': {'o_id': 3}}, sources))
        self.assertFalse(validation.check_references('publication-dashboards/3.json', {'o_id': 3}, sources))

    def test_compact_record_links_and_malformed_concordance_rows(self):
        sources = {'articles': {'ids': ['1'], 'publicOcrIds': ['1']}}
        self.assertTrue(validation.check_references('on-this-day/h/01-01.json',
                        {'items': [[2000, '999', 'Title', 'Source', 'a', '', '']]}, sources))
        self.assertTrue(validation.check_references('on-this-day/01-01.json', {}, sources))
        good = {'items': [{'o': '1'}], 'rows': [{'i': 0, 'd': 'OCR'}]}
        self.assertFalse(validation.check_references('laicite-concordance-articles.json', good, sources))
        for payload in ({}, {'items': [{'o': '999'}], 'rows': []},
                        {'items': [{}], 'rows': [None, {'i': True}, {'i': 0, 'd': 'OCR'}]}):
            self.assertTrue(validation.check_references('laicite-concordance-articles.json', payload, sources))

    def test_required_sidecars_are_checked_by_python(self):
        self.assertIn('laicite-concordance.json', validation.REQUIRED_FILES)
        with tempfile.TemporaryDirectory() as root:
            self.assertIn('laicite-concordance.json: missing', validation.validate(Path(root)))

    def test_publication_ranking_preserves_scores_and_ties(self):
        sims = np.array([[-np.inf, 0.5, 0.5], [0.5, -np.inf, 0], [0.5, 0, -np.inf]])
        for k in (1, 2, 8):
            count = min(k, 2)
            old_ids = np.argpartition(-sims, count, axis=1)[:, :count]
            old_scores = np.take_along_axis(sims, old_ids, axis=1)
            order = np.argsort(-old_scores, axis=1)
            ids, scores = rank_cosine_matrix(sims, k)
            np.testing.assert_array_equal(ids, np.take_along_axis(old_ids, order, axis=1))
            np.testing.assert_array_equal(scores, np.take_along_axis(old_scores, order, axis=1))
        self.assertEqual(rank_cosine_matrix(np.array([[-np.inf]]), 3)[0].shape, (1, 0))

    def test_eligible_outputs_are_independent_of_successful_writes(self):
        with tempfile.TemporaryDirectory() as root, patch.object(iwac_utils, '_EXPECTED_OUTPUTS', set()), patch.object(iwac_utils, '_WRITTEN_OUTPUTS', set()):
            directory = Path(root)
            iwac_utils.expect_item_outputs(directory, [1, 2])
            iwac_utils.save_json({'ok': True}, directory / '1.json')
            self.assertEqual(iwac_utils._EXPECTED_OUTPUTS - iwac_utils._WRITTEN_OUTPUTS,
                             {str((directory / '2.json').resolve())})

    def test_partial_build_cannot_write_a_manifest(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            proof = directory / 'proof.json'
            proof.write_text(json.dumps({'outputs': {'article_dashboards': []}}))
            with self.assertRaisesRegex(ValueError, 'complete generator run'):
                validation.write_manifest(directory, proof)

    def test_revision_is_resolved_once_per_repository(self):
        with patch.dict(iwac_utils._DATASET_REVISIONS, {}, clear=True), patch.dict(
            os.environ, {'IWAC_DATASET_REVISION': 'a' * 40}
        ):
            self.assertEqual(iwac_utils.dataset_revision(iwac_utils.DATASET_ID), 'a' * 40)
            os.environ['IWAC_DATASET_REVISION'] = 'b' * 40
            self.assertEqual(iwac_utils.dataset_revision(iwac_utils.DATASET_ID), 'a' * 40)

    def test_malformed_container_types_fail(self):
        payload = {'metadata': {'generatedAt': '2026-09-10T12:00:00Z'},
                   'summary': None, 'timeline': 'bad', 'countries': 12, 'treemap': False}
        self.assertEqual(len(validation.check_payload('collection-overview.json', payload)), 4)

    def test_all_fanout_files_are_parsed(self):
        with tempfile.TemporaryDirectory() as root:
            target = Path(root) / 'article-dashboards'
            target.mkdir()
            (target / '123.json').write_text('{broken', encoding='utf-8')
            self.assertTrue(any('123.json' in error and 'invalid JSON' in error
                                for error in validation.validate(Path(root))))

    def test_private_ocr_and_broken_links_are_rejected(self):
        sources = {'articles': {'ids': ['1', '2'], 'publicOcrIds': ['1']}}
        self.assertTrue(validation.check_references('on-this-day/01-01.json',
                        {'items': [[2000, '2', 'Title', 'Source', 'a', '', 'private']]}, sources))
        self.assertFalse(validation.check_references('on-this-day/01-01.json',
                         {'items': [[2000, '1', 'Title', 'Source', 'a', '', 'public']]}, sources))
        self.assertTrue(validation.check_references('article-dashboards/1.json',
                        {'neighbors': [{'o_id': '999'}]}, sources))

    def test_manifest_requires_every_recorded_output(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            proof = directory / 'proof.json'
            proof.write_text(json.dumps({'outputs': {name: ['article-dashboards/1.json'] for name in GENERATORS},
                                         'sources': {}, 'revisions': {}, 'configuration': {}}))
            with self.assertRaisesRegex(ValueError, 'missing='):
                validation.write_manifest(directory, proof)
