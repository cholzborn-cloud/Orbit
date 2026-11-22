"""Kleiner echter MCP-Server über stdio für test_marketplace.py (gebaut mit dem Paket mcp)."""
import os

from mcp.server.mcpserver import MCPServer
from mcp_types import ToolAnnotations

server = MCPServer("testserver")


@server.tool(annotations=ToolAnnotations(read_only_hint=True))
def echo(text: str) -> str:
    """Gibt den Text zurück."""
    return f"echo:{text}"


@server.tool()
def schreibe(text: str) -> str:
    """Ändert etwas (ohne readOnlyHint)."""
    return f"geschrieben:{text}:{'token' if os.environ.get('MCP_TOKEN') else 'ohne'}"


if __name__ == "__main__":
    server.run("stdio")
