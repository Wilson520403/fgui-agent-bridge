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

    def test_mcp_branch_mapping(self):
        with patch.object(mcp_server._client, 'call', return_value={}) as call:
            mcp_server.fgui_list_branches(refresh=True, include_packages=True, include_items=True)
            mcp_server.fgui_create_branch('de', switch_to=True, save_open_documents=True)
            mcp_server.fgui_switch_branch('')
            mcp_server.fgui_list_items('Package1', branch='de')
            mcp_server.fgui_open_document('Package1', 'BranchComp', branch='de')
            mcp_server.fgui_create_component('Package1', 'BranchComp', branch='de')
            mcp_server.fgui_get_tree(branch='de')
        calls = [(entry.args[0], entry.args[1]) for entry in call.call_args_list]
        self.assertEqual(calls[0], ('list_branches', {'refresh': True, 'includePackages': True, 'includeItems': True}))
        self.assertEqual(calls[1], ('create_branch', {'name': 'de', 'switch': True, 'saveOpenDocuments': True, 'verify': True}))
        self.assertEqual(calls[2], ('switch_branch', {'name': '', 'saveOpenDocuments': False}))
        self.assertEqual(calls[3], ('list_items', {'packageName': 'Package1', 'branch': 'de'}))
        self.assertEqual(calls[4], ('open_document', {'packageName': 'Package1', 'itemName': 'BranchComp', 'branch': 'de'}))
        self.assertEqual(calls[5][0], 'create_component')
        self.assertEqual(calls[5][1]['branch'], 'de')
        self.assertEqual(calls[6], ('get_tree', {'maxDepth': 12, 'branch': 'de'}))

    def test_cli_branch_flags(self):
        args = build_parser().parse_args(['branches', '--refresh', '--packages', '--items'])
        self.assertEqual((args.command, args.refresh, args.include_packages, args.include_items), ('branches', True, True, True))
        args = build_parser().parse_args(['create-branch', 'de', '--switch', '--save-open-documents'])
        self.assertEqual((args.command, args.name, args.switch, args.save_open_documents), ('create-branch', 'de', True, True))
        args = build_parser().parse_args(['switch-branch', ''])
        self.assertEqual((args.command, args.name), ('switch-branch', ''))
        for argv in (
            ['items', 'Package1', '--branch', 'de'],
            ['open', 'Package1', 'BranchComp', '--branch', 'de'],
            ['tree', '--branch', 'de'],
            ['create-component', 'Package1', 'BranchComp', '--branch', 'de'],
            ['import-image', 'Package1', '/tmp/a.png', '--branch', 'de'],
            ['create-movieclip', 'Package1', 'Anim', '--frame', '/tmp/a.png', '--branch', 'de'],
        ):
            with self.subTest(argv=argv):
                self.assertEqual(build_parser().parse_args(argv).branch, 'de')

    def test_mcp_audit_mapping(self):
        with patch.object(mcp_server._client, 'call', return_value={}) as call:
            mcp_server.fgui_find_unused(packages=['Package1'], types=['image'], include_branches=False, skip_exported=True, max_items=10)
            mcp_server.fgui_find_duplicate(types=['image'], max_groups=5, max_items_per_group=3)
        calls = [(entry.args[0], entry.args[1]) for entry in call.call_args_list]
        self.assertEqual(calls[0], ('find_unused', {
            'includeBranches': False, 'skipExported': True,
            'packages': ['Package1'], 'types': ['image'], 'maxItems': 10,
        }))
        self.assertEqual(calls[1], ('find_duplicate', {
            'includeBranches': True, 'types': ['image'],
            'maxGroups': 5, 'maxItemsPerGroup': 3,
        }))

    def test_cli_audit_flags(self):
        args = build_parser().parse_args([
            'find-unused', '--package', 'Package1', '--package', 'Package2',
            '--type', 'image', '--no-branches', '--skip-exported',
            '--max-items', '10', '--audit-timeout', '5',
        ])
        self.assertEqual(args.command, 'find-unused')
        self.assertEqual(args.packages, ['Package1', 'Package2'])
        self.assertEqual(args.types, ['image'])
        self.assertTrue(args.no_branches)
        self.assertTrue(args.skip_exported)
        self.assertEqual((args.max_items, args.audit_timeout), (10, 5.0))
        args = build_parser().parse_args([
            'find-duplicate', '--type', 'image', '--no-branches',
            '--max-groups', '5', '--max-items-per-group', '3',
        ])
        self.assertEqual(args.command, 'find-duplicate')
        self.assertTrue(args.no_branches)
        self.assertEqual((args.max_groups, args.max_items_per_group), (5, 3))

    def test_error_details_survive_client(self):
        client = BridgeClient(ProjectLocator())
        details = {'stage': 'xml', 'differences': [{'property': 'fontSize', 'expected': 40, 'actual': 24}]}
        with patch.object(client, 'call_raw', return_value={'ok': False, 'error': {'code': 'persistence_failed', 'message': 'mismatch', 'details': details}}):
            with self.assertRaises(BridgeCommandError) as caught:
                client.call('set_text_style')
        self.assertEqual(caught.exception.details, details)
