"""通过真实 MCP 内存传输验证结果契约，不连接编辑器或磁盘队列。"""

from __future__ import annotations

import json
import unittest
from unittest.mock import MagicMock, patch

from mcp.shared.memory import create_connected_server_and_client_session

from fairygui_agent import mcp_server
from fairygui_agent.bridge_client import BridgeCommandError


class McpResultContractTests(unittest.IsolatedAsyncioTestCase):
    async def test_list_items_returns_the_package_and_items_object(self) -> None:
        expected = {
            "package": {"id": "fixture0", "name": "Fixture"},
            "items": [{"id": "text1", "name": "Label", "type": "component"}],
            "branch": "",
        }
        client = MagicMock()
        client.call.return_value = expected
        with patch.object(mcp_server, "_client", client):
            async with create_connected_server_and_client_session(mcp_server.mcp) as session:
                tools = await session.list_tools()
                definition = next(tool for tool in tools.tools if tool.name == "fgui_list_items")
                self.assertEqual(definition.outputSchema["type"], "object")
                result = await session.call_tool("fgui_list_items", {"package_name": "Fixture"})
        self.assertFalse(result.isError)
        self.assertEqual(result.structuredContent, expected)
        self.assertEqual(json.loads(result.content[0].text), expected)
        client.call.assert_called_once_with("list_items", {"packageName": "Fixture"})

    async def test_bridge_errors_preserve_mutation_and_rollback_details(self) -> None:
        for rolled_back in (True, False):
            with self.subTest(rolled_back=rolled_back):
                details = {
                    "stage": "editor",
                    "differences": [{"property": "vAlign", "expected": "middle", "actual": "top"}],
                    "mutationMayHaveOccurred": not rolled_back,
                    "rolledBack": rolled_back,
                }
                client = MagicMock()
                client.call.side_effect = BridgeCommandError(
                    "insert_text", "验证失败：editor", "editor_rejected", details
                )
                with patch.object(mcp_server, "_client", client):
                    async with create_connected_server_and_client_session(mcp_server.mcp) as session:
                        result = await session.call_tool(
                            "fgui_insert_text", {"text": "示例", "style": {"vAlign": "middle"}}
                        )
                expected = {
                    "ok": False,
                    "action": "insert_text",
                    "error": {"code": "editor_rejected", "message": "验证失败：editor", "details": details},
                }
                self.assertTrue(result.isError)
                self.assertEqual(result.structuredContent, expected)
                self.assertEqual(json.loads(result.content[0].text), expected)

    async def test_legacy_bridge_error_does_not_invent_details(self) -> None:
        client = MagicMock()
        client.call.side_effect = BridgeCommandError("get_tree", "legacy error")
        with patch.object(mcp_server, "_client", client):
            async with create_connected_server_and_client_session(mcp_server.mcp) as session:
                result = await session.call_tool("fgui_get_tree", {})
        self.assertTrue(result.isError)
        self.assertEqual(result.structuredContent["error"], {
            "code": None, "message": "legacy error", "details": None
        })

    async def test_successful_tool_results_keep_their_existing_shape(self) -> None:
        client = MagicMock()
        client.call.return_value = {"persisted": True, "strength": "reload", "inserted": {"id": "text1"}}
        with patch.object(mcp_server, "_client", client):
            async with create_connected_server_and_client_session(mcp_server.mcp) as session:
                result = await session.call_tool("fgui_insert_text", {"text": "示例"})
        self.assertFalse(result.isError)
        self.assertEqual(result.structuredContent, client.call.return_value)
        self.assertEqual(json.loads(result.content[0].text), client.call.return_value)

    async def test_python_argument_errors_remain_normal_mcp_tool_errors(self) -> None:
        client = MagicMock()
        with patch.object(mcp_server, "_client", client):
            async with create_connected_server_and_client_session(mcp_server.mcp) as session:
                result = await session.call_tool("fgui_set_property", {
                    "property_name": "x", "value": 1
                })
        self.assertTrue(result.isError)
        self.assertIsNone(result.structuredContent)
        self.assertIn("必须且只能提供一个", result.content[0].text)
        client.call.assert_not_called()
