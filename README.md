# AI-Native MySQL Management Tool

An AI-native database management tool powered by natural language. Connect to your MySQL instances and query them using plain English.

## Features

- **Natural Language to SQL**: Describe what you want, and let AI generate and execute the query
- **Context-Aware Connection Selection**: No need to memorize connection names - AI automatically selects the right database
- **MCP Server**: Works with any MCP-compatible AI client (WorkBuddy, Cursor, Claude Desktop, etc.)
- **High Precision Matching**: Multi-layer signal scoring ensures accurate connection selection
- **Security First**: Read-only connections, DDL confirmation, transaction safety

## Quick Start

### Install

```bash
npm install -g mysql-agent
```

### Configure Connections

```bash
mysql-agent config add --alias prod-orders \
  --host prod-db.company.com \
  --port 3306 \
  --user analyst \
  --database orders \
  --description "Production order database" \
  --tags production,orders \
  --read-only
```

Or edit `~/.mysql-agent/config.json` directly:

```json
{
  "version": "1",
  "connections": {
    "prod-orders": {
      "host": "prod-db.company.com",
      "port": 3306,
      "user": "analyst",
      "password": "env:PROD_PASSWORD",
      "database": "orders",
      "description": "Production order database",
      "tags": ["production", "orders"],
      "readOnly": true
    }
  }
}
```

### Interactive Mode

```bash
mysql-agent
```

### MCP Server Mode

```bash
mysql-agent mcp
```

## Architecture

```
mysql-agent/
├── packages/
│   ├── mcp-server/      # MCP Server (stdio interface)
│   └── cli/             # CLI + Agent SDK
```

## Development

```bash
pnpm install
pnpm build
pnpm dev
```

## License

MIT
