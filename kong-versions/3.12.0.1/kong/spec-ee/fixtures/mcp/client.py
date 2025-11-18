#!/usr/bin/env python3
import asyncio
import os
import traceback
from datetime import timedelta
from typing import Any

import jsonschema

from mcp.client.session import ClientSession
from mcp.client.sse import sse_client
from mcp.client.streamable_http import streamablehttp_client
from mcp.shared._httpx_utils import create_mcp_http_client
from mcp import Tool


class Client:
    def __init__(self, server_url: str, transport_type: str = "streamable_http"):
        self.server_url = server_url
        self.transport_type = transport_type
        self.session: ClientSession | None = None

    async def connect(self):
        authorization_token = os.getenv("MCP_AUTH_TOKEN")
        if authorization_token:
            headers = {"Authorization": f"Bearer {authorization_token}"}
        else:
            headers = None
        try:
            # Create transport with auth handler based on transport type
            if self.transport_type == "sse":
                async with sse_client(
                    url=self.server_url,
                    headers=headers,
                    timeout=60,
                ) as (read_stream, write_stream):
                    await self._run_session(read_stream, write_stream, None)
            else:
                async with streamablehttp_client(
                    url=self.server_url,
                    headers=headers,
                    timeout=timedelta(seconds=60),
                ) as (read_stream, write_stream, get_session_id):
                    await self._run_session(read_stream, write_stream, get_session_id)

        except Exception as e:
            print(f"Failed to connect: {e}")
            traceback.print_exc()

    async def _run_session(self, read_stream, write_stream, get_session_id):
        async with ClientSession(read_stream, write_stream) as session:
            self.session = session
            await session.initialize()
            if get_session_id:
                session_id = get_session_id()
                if session_id:
                    print(f"Session ID: {session_id}")
                else:
                    raise ValueError("Failed to get session ID")

            await self.interact()

    async def interact(self):
        tool = await self.list_tools()
        if not tool:
            return
        # hardcoded for testing purposes
        print(f"Calling tool: {tool.name}")
        await self.call_tool(tool.name, {
            "query_city": "New York",
            "header_x-api-key": "your_api_key_here",
            "path_userId": "123",
            "path_orderId": "45",
            "body": {
                "country": "USA",
            },
        })

    def ask_llm_for_right_tool(self, tools: list[Tool]) -> Tool | None:
        # 'LLM' tells us to use the first tool
        return tools[0] if len(tools) > 0 else None

    async def list_tools(self) -> Tool | None:
        """List available tools from the server."""
        if not self.session:
            print("Not connected to server")
            return

        try:
            result = await self.session.list_tools()
            if hasattr(result, "tools") and result.tools:
                print("Total tools available:", len(result.tools))
                for i, tool in enumerate(result.tools, 1):
                    print(f"{i}. {tool.name}")
                    if tool.description:
                        print(f"   Description: {tool.description}")
                    else:
                        raise ValueError("Tool description is missing")
                    if tool.inputSchema:
                        print(f"   InputSchema: {tool.inputSchema}")
                        # validate if inputSchema is a valid JSON schema
                        schema = tool.inputSchema
                        jsonschema.Draft7Validator.check_schema(schema)
                    else:
                        raise ValueError("Tool inputSchema is missing")
                    if tool.annotations:
                        print(f"   Annotations: {tool.annotations}")
                    print()
                return self.ask_llm_for_right_tool(result.tools)
            else:
                print("No tools available")
                return None
        except Exception as e:
            print(f"Failed to list tools: {e}")

    async def call_tool(self, tool_name: str, arguments: dict[str, Any] | None = None):
        """Call a specific tool."""
        if not self.session:
            print("Not connected to server")
            return

        try:
            result = await self.session.call_tool(tool_name, arguments or {})
            if hasattr(result, "content"):
                for content in result.content:
                    prefix = "Tool call result:" if not result.isError else "Tool call failure:"
                    if content.type == "text":
                        print(prefix, content.text)
                    else:
                        print(prefix, content)
            else:
                print(result)
        except Exception as e:
            print(f"Failed to call tool '{tool_name}': {e}")


async def main():
    server_url = os.getenv("MCP_SERVER_PORT", 8000)
    # MCP_TRANSPORT_TYPE can be set to "sse" or "streamable_http"
    transport_type = os.getenv("MCP_TRANSPORT_TYPE", "streamable_http")
    path = os.getenv("MCP_SERVER_PATH", "mcp")
    server_url = (
        f"http://localhost:{server_url}/{path}"
    )

    print(f"Connecting to MCP server at {server_url} using {transport_type} transport...")
    client = Client(server_url, transport_type)
    await client.connect()


def cli():
    asyncio.run(main())


if __name__ == "__main__":
    cli()
