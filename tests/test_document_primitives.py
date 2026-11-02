"""Public primitive surfaces and capability negotiation (not Editor acceptance)."""
import unittest
from unittest.mock import patch
from fairygui_agent import mcp_server
from fairygui_agent.cli import main
from fairygui_agent.bridge_client import BridgeClient, BridgeError, DOCUMENT_PRIMITIVE_CAPABILITIES, PRIMITIVE_CREATION_CAPABILITIES, LIST_ITEMS_CAPABILITIES
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

    def test_creation_mcp_preserves_items_layout_and_verification(self):
        with patch.object(mcp_server._client, 'call', return_value={}) as call:
            mcp_server.fgui_insert_loader(url='ui://pkgimage', name='icon', width=180.5, fill='scale',
                                          v_align='middle', shrink_only=True, save=True, external_reload=True)
            action, params = call.call_args.args
            self.assertEqual(action, 'insert_loader')
            self.assertEqual((params['width'], params['fill'], params['vAlign'], params['shrinkOnly']),
                             (180.5, 'scale', 'middle', True))
            self.assertTrue(params['externalReload'])
            entries = [{'title': 'One'}, {'url': 'ui://pkgother', 'icon': 'ui://pkgimage'}]
            mcp_server.fgui_insert_list(default_item='ui://pkgbutton', items=entries, layout='flow_horizontal',
                                       line_gap=8, column_gap=4, auto_item_size=False, save=True, external_reload=True)
            action, params = call.call_args.args
            self.assertEqual(action, 'insert_list')
            self.assertEqual(params['items'], entries)
            self.assertEqual((params['defaultItem'], params['layout'], params['lineGap'], params['columnGap'], params['autoItemSize']),
                             ('ui://pkgbutton', 'flow_horizontal', 8, 4, False))
            self.assertTrue(params['verify'] and params['externalReload'])

    def test_creation_cli_dispatches_exact_options(self):
        for argv, action, fields in [
            (['insert-loader', '--url', 'ui://pkgimage', '--fill', 'scale', '--shrink-only', '--width', '180.5'],
             'insert_loader', {'url': 'ui://pkgimage', 'fill': 'scale', 'shrinkOnly': True, 'width': 180.5}),
            (['insert-list', '--default-item', 'ui://pkgbutton', '--items', '[{"title":"One"}]',
              '--layout', 'flow_vertical', '--no-auto-item-size', '--line-gap', '8'],
             'insert_list', {'defaultItem': 'ui://pkgbutton', 'items': [{'title': 'One'}], 'layout': 'flow_vertical',
                             'autoItemSize': False, 'lineGap': 8}),
        ]:
            with self.subTest(action=action), patch.object(BridgeClient, 'call_raw', return_value={'ok': True, 'result': {}}) as call, patch('builtins.print'), patch('sys.argv', ['fgui-agent', *argv, '--save', '--external-reload']):
                self.assertEqual(main(), 0)
                self.assertEqual(call.call_args.args[0], action)
                params = call.call_args.args[1]
                for key, expected in fields.items():
                    self.assertEqual(params[key], expected)
                self.assertTrue(params['save'] and params['verify'] and params['externalReload'])

    def test_creation_capabilities_reject_an_old_plugin_before_enqueue(self):
        client = BridgeClient(ProjectLocator('sample'))
        with patch.object(client, 'ensure_ready', return_value={'bridgeVersion': '0.8.24', 'capabilities': []}):
            for action in PRIMITIVE_CREATION_CAPABILITIES:
                with self.subTest(action=action), self.assertRaisesRegex(BridgeError, '0.8.25'):
                    client.call_raw(action, {})

    def test_list_items_mcp_preserves_replacement_and_optional_default(self):
        entries = [{'title': 'Two'}, {'url': 'ui://pkgbutton', 'title': '', 'selectedIcon': ''}]
        with patch.object(mcp_server._client, 'call', return_value={}) as call:
            mcp_server.fgui_get_list_items(object_name='menu')
            self.assertEqual(call.call_args.args, ('get_list_items', {'target': {'name': 'menu'}}))
            mcp_server.fgui_set_list_items(entries, object_path='root/menu', save=True, external_reload=True)
            self.assertEqual(call.call_args.args, ('set_list_items', {'target': {'path': 'root/menu'}, 'items': entries,
                             'save': True, 'verify': True, 'externalReload': True}))
            mcp_server.fgui_set_list_items([], object_id='one', default_item='')
            self.assertEqual(call.call_args.args[1]['defaultItem'], '')
            self.assertEqual(call.call_args.args[1]['items'], [])

    def test_list_items_mcp_requires_one_locator(self):
        for invoke in [lambda: mcp_server.fgui_get_list_items(),
                       lambda: mcp_server.fgui_set_list_items([], object_id='one', object_name='menu')]:
            with self.assertRaises(ValueError):
                invoke()

    def test_list_items_cli_distinguishes_missing_default_from_clear(self):
        cases = [
            (['get-list-items', '--name', 'menu'], 'get_list_items', {'target': {'name': 'menu'}}),
            (['set-list-items', '--id', 'one', '[{"title":"Two"}]', '--save', '--external-reload'],
             'set_list_items', {'target': {'id': 'one'}, 'items': [{'title': 'Two'}], 'save': True, 'verify': True, 'externalReload': True}),
            (['set-list-items', '--path', 'root/menu', '[]', '--default-item', '', '--no-verify'],
             'set_list_items', {'target': {'path': 'root/menu'}, 'items': [], 'defaultItem': '', 'save': False, 'verify': False, 'externalReload': False}),
        ]
        for argv, action, expected in cases:
            with self.subTest(action=action, argv=argv), patch.object(BridgeClient, 'call_raw', return_value={'ok': True, 'result': {}}) as call, patch('builtins.print'), patch('sys.argv', ['fgui-agent', *argv]):
                self.assertEqual(main(), 0)
                self.assertEqual(call.call_args.args, (action, expected))

    def test_list_items_capabilities_reject_an_old_plugin_before_enqueue(self):
        client = BridgeClient(ProjectLocator('sample'))
        with patch.object(client, 'ensure_ready', return_value={'bridgeVersion': '0.8.25', 'capabilities': []}):
            for action in LIST_ITEMS_CAPABILITIES:
                with self.subTest(action=action), self.assertRaisesRegex(BridgeError, '0.8.26'):
                    client.call_raw(action, {})
