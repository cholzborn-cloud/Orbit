const CONNECTOR_TOOL = /^connector_(.+)__(.+)$/

// Konnektor-Tools heißen intern connector_<id>__<tool>.
export const parseConnectorTool = (tool: string) => {
  const match = CONNECTOR_TOOL.exec(tool)
  return match ? { id: match[1], tool: match[2] } : null
}

export const toolLabel = (tool: string) => {
  const connector = parseConnectorTool(tool)
  return connector ? `${connector.tool} (Konnektor)` : tool
}
