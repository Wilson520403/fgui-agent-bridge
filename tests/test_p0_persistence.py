"""Run the compiled plugin against a mocked host; never claim live Editor acceptance."""
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch
from fairygui_agent import mcp_server
from fairygui_agent.cli import build_parser
from fairygui_agent.bridge_client import BridgeClient, BridgeCommandError
from fairygui_agent.project_locator import ProjectLocator

ROOT = Path(__file__).resolve().parents[1]

class PersistenceTests(unittest.TestCase):
    def test_compiled_plugin_regressions(self):
        result = subprocess.run(['node', str(ROOT / 'tests/p0_host_harness.cjs')],
                                env={**os.environ, 'PYTHON': sys.executable}, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual(report['passed'], report['total'])
        self.assertFalse(report['liveEditorVerified'])

    def test_cli_expected_mapping(self):
        args = build_parser().parse_args(['verify-document', '--id', 'text1', '--expected', '{"fontSize":40}', '--editor-only'])
        self.assertEqual(json.loads(args.expected), {'fontSize': 40})
        self.assertTrue(args.editor_only)

    def test_mcp_expected_mapping(self):
        with patch.object(mcp_server._client, 'call', return_value={}) as call:
            mcp_server.fgui_verify_document(object_id='text1', expected={'fontSize': 40}, read_xml=False)
        self.assertEqual(call.call_args.args, ('verify_document', {'maxDepth': 12, 'target': {'id': 'text1'}, 'expected': {'fontSize': 40}, 'readXml': False}))
        with self.assertRaises(ValueError):
            mcp_server.fgui_verify_document(expected={'fontSize': 40})

    def test_error_details_survive_client(self):
        client = BridgeClient(ProjectLocator())
        details = {'stage': 'xml', 'differences': [{'property': 'fontSize', 'expected': 40, 'actual': 24}]}
        with patch.object(client, 'call_raw', return_value={'ok': False, 'error': {'code': 'persistence_failed', 'message': 'mismatch', 'details': details}}):
            with self.assertRaises(BridgeCommandError) as caught:
                client.call('set_text_style')
        self.assertEqual(caught.exception.details, details)
