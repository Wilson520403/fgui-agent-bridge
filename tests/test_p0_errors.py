"""Structured command errors survive the Python client boundary."""
import unittest
from unittest.mock import patch
from fairygui_agent.bridge_client import BridgeClient, BridgeCommandError
from fairygui_agent.project_locator import ProjectLocator


class StructuredErrorTests(unittest.TestCase):
    def test_code_is_preserved(self):
        client = BridgeClient(ProjectLocator())
        with patch.object(client, 'call_raw', return_value={
            'ok': False, 'error': {'code': 'target_not_found', 'message': 'missing'}
        }):
            with self.assertRaises(BridgeCommandError) as caught:
                client.call('get_text_style')
        self.assertEqual(caught.exception.code, 'target_not_found')
        self.assertEqual(caught.exception.bridge_message, 'missing')

    def test_legacy_error_without_code(self):
        client = BridgeClient(ProjectLocator())
        with patch.object(client, 'call_raw', return_value={
            'ok': False, 'error': {'message': 'legacy'}
        }):
            with self.assertRaises(BridgeCommandError) as caught:
                client.call('get_tree')
        self.assertIsNone(caught.exception.code)
