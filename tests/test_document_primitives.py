"""Public primitive surfaces and capability negotiation (not Editor acceptance)."""
import unittest
from unittest.mock import patch
from fairygui_agent import mcp_server
from fairygui_agent.cli import main
from fairygui_agent.bridge_client import BridgeClient, BridgeError, DOCUMENT_PRIMITIVE_CAPABILITIES
from fairygui_agent.project_locator import ProjectLocator


class DocumentPrimitiveTests(unittest.TestCase):
    def test_mcp_preserves_locators_and_verification_options(self):
        with patch.object(mcp_server._client, 'call', return_value={}) as call:
            mcp_server.fgui_create_group([{'id': 'one'}, {'path': 'root/two'}], name='Pair', save=True, external_reload=True)
            self.assertEqual(call.call_args.args, ('create_group', {'targets': [{'id': 'one'}, {'path': 'root/two'}], 'name': 'Pair', 'save': True, 'verify': True, 'externalReload': True}))
            mcp_server.fgui_duplicate_object(object_id='one', name='Copy', dx=12.5, dy=-3, save=True)
            self.assertEqual(call.call_args.args, ('duplicate_object', {'target': {'id': 'one'}, 'name': 'Copy', 'dx': 12.5, 'dy': -3, 'save': True, 'verify': True, 'externalReload': False}))
            mcp_server.fgui_adjust_depth(0, object_name='Copy', save=True, external_reload=True)
            self.assertEqual(call.call_args.args, ('adjust_depth', {'target': {'name': 'Copy'}, 'index': 0, 'save': True, 'verify': True, 'externalReload': True}))

    def test_cli_dispatches_exact_payloads(self):
        cases = [
            (['create-group', '[{"id":"one"},{"id":"two"}]', '--name', 'Pair'], 'create_group', {'targets': [{'id': 'one'}, {'id': 'two'}], 'name': 'Pair'}),
            (['duplicate-object', '--id', 'one', '--new-name', 'Copy', '--dx', '10'], 'duplicate_object', {'target': {'id': 'one'}, 'name': 'Copy', 'dx': 10.0, 'dy': 0}),
            (['adjust-depth', '--path', 'root/title', '0'], 'adjust_depth', {'target': {'path': 'root/title'}, 'index': 0}),
        ]
        for argv, action, expected in cases:
            with self.subTest(action=action), patch.object(BridgeClient, 'call_raw', return_value={'ok': True, 'result': {}}) as call, patch('builtins.print'), patch('sys.argv', ['fgui-agent', *argv, '--save', '--external-reload']):
                self.assertEqual(main(), 0)
                self.assertEqual(call.call_args.args, (action, {**expected, 'save': True, 'verify': True, 'externalReload': True}))

    def test_old_plugin_fails_before_enqueue_with_correct_minimum_version(self):
        client = BridgeClient(ProjectLocator('sample'))
        with patch.object(client, 'ensure_ready', return_value={'bridgeVersion': '0.8.23', 'capabilities': []}):
            for action in DOCUMENT_PRIMITIVE_CAPABILITIES:
                with self.subTest(action=action), self.assertRaisesRegex(BridgeError, '0.8.24'):
                    client.call_raw(action, {})
