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
        self.assertFalse(report['externalReloadVerified'])
        self.assertTrue(report['mockedExternalReloadCovered'])

    def test_cli_expected_mapping(self):
        args = build_parser().parse_args(['verify-document', '--id', 'text1', '--expected', '{"fontSize":40}', '--editor-only'])
        self.assertEqual(json.loads(args.expected), {'fontSize': 40})
        self.assertTrue(args.editor_only)

    def test_mcp_expected_mapping(self):
        with patch.object(mcp_server._client, 'call', return_value={}) as call:
            mcp_server.fgui_verify_document(object_id='text1', expected={'fontSize': 40}, read_xml=False)
        self.assertEqual(call.call_args.args, ('verify_document', {'maxDepth': 12, 'target': {'id': 'text1'}, 'expected': {'fontSize': 40}, 'readXml': False, 'externalReload': False}))
        with self.assertRaises(ValueError):
            mcp_server.fgui_verify_document(expected={'fontSize': 40})

    def test_mcp_tree_expected_without_target(self):
        tree_spec = {'children': [{'id': 'text1', 'fontSize': 40}]}
        with patch.object(mcp_server._client, 'call', return_value={}) as call:
            mcp_server.fgui_verify_document(expected=tree_spec)
        self.assertEqual(call.call_args.args, ('verify_document', {'maxDepth': 12, 'expected': tree_spec, 'readXml': True, 'externalReload': False}))

    def test_external_reload_reaches_plugin_from_mcp_and_cli(self):
        """CLI、MCP 和插件必须能请求同一个 externalReload 参数，否则最强验证只存在于插件里。"""
        cases = [
            (lambda: mcp_server.fgui_set_text_style(style={'fontSize': 40}, object_id='text1', save=True, external_reload=True), 'set_text_style', {'fontSize': 40}),
            (lambda: mcp_server.fgui_replace_object_resource(resource_url='ui://p1i1', object_id='image1', save=True, external_reload=True), 'replace_object_resource', 'ui://p1i1'),
            (lambda: mcp_server.fgui_verify_document(object_id='text1', expected={'fontSize': 40}, external_reload=True), 'verify_document', {'fontSize': 40}),
        ]
        for invoke, action, _payload in cases:
            with self.subTest(action=action), patch.object(mcp_server._client, 'call', return_value={}) as call:
                invoke()
                self.assertEqual(call.call_args.args[0], action)
                self.assertIs(call.call_args.args[1]['externalReload'], True)

        for argv, action in [
            (['set-text-style', '--id', 'text1', '{"fontSize":40}', '--save', '--external-reload'], 'set_text_style'),
            (['replace-object-resource', '--id', 'image1', 'ui://p1i1', '--save', '--external-reload'], 'replace_object_resource'),
            (['verify-document', '--id', 'text1', '--expected', '{"fontSize":40}', '--external-reload'], 'verify_document'),
        ]:
            with self.subTest(action=action):
                args = build_parser().parse_args(argv)
                self.assertTrue(args.external_reload, f'{action} CLI 未注册 --external-reload')
                self.assertTrue(getattr(args, 'save', False) or action == 'verify_document')

    def test_error_details_survive_client(self):
        client = BridgeClient(ProjectLocator())
        details = {'stage': 'xml', 'differences': [{'property': 'fontSize', 'expected': 40, 'actual': 24}]}
        with patch.object(client, 'call_raw', return_value={'ok': False, 'error': {'code': 'persistence_failed', 'message': 'mismatch', 'details': details}}):
            with self.assertRaises(BridgeCommandError) as caught:
                client.call('set_text_style')
        self.assertEqual(caught.exception.details, details)
