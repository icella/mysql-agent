/**
 * MySQL Agent MCP Server
 *
 * A Model Context Protocol server for MySQL database operations.
 * Use with any MCP-compatible AI client.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// Import tools
import * as connection from './tools/connection.js';
import * as schema from './tools/schema.js';
import * as query from './tools/query.js';
import * as diagnostics from './tools/diagnostics.js';

// Define all available tools using JSON schema format (MCP SDK requirement)
const tools = [
  // Connection tools
  {
    name: 'mysql_connect',
    description: 'Connect to a MySQL database server',
    inputSchema: {
      type: 'object',
      properties: {
        host: { type: 'string', description: 'MySQL host address' },
        port: { type: 'number', description: 'MySQL port', default: 3306 },
        user: { type: 'string', description: 'MySQL username' },
        password: { type: 'string', description: 'MySQL password' },
        database: { type: 'string', description: 'Default database to use' },
      },
      required: ['host', 'user', 'password'],
    },
  },
  {
    name: 'mysql_disconnect',
    description: 'Disconnect from the current MySQL database',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'mysql_status',
    description: 'Get the current connection status',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  // Schema tools
  {
    name: 'mysql_list_databases',
    description: 'List all databases on the MySQL server (excluding system databases)',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'mysql_list_tables',
    description: 'List all tables in a database',
    inputSchema: {
      type: 'object',
      properties: {
        database: { type: 'string', description: 'Database name (uses current if not specified)' },
      },
    },
  },
  {
    name: 'mysql_describe_table',
    description: 'Get detailed information about a table structure, indexes, and foreign keys',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'Table name to describe' },
      },
      required: ['table'],
    },
  },
  {
    name: 'mysql_get_table_stats',
    description: 'Get table statistics including row count, size, and engine',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'Table name' },
      },
      required: ['table'],
    },
  },
  {
    name: 'mysql_table_exists',
    description: 'Check if a table exists in a specific database',
    inputSchema: {
      type: 'object',
      properties: {
        database: { type: 'string', description: 'Database name' },
        table: { type: 'string', description: 'Table name to check' },
      },
      required: ['database', 'table'],
    },
  },

  // Query tools
  {
    name: 'mysql_execute_query',
    description: 'Execute a SELECT query. Only SELECT queries are allowed - use execute_write for INSERT/UPDATE/DELETE',
    inputSchema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'SELECT query to execute' },
        limit: { type: 'number', description: 'Maximum rows to return', default: 1000 },
      },
      required: ['sql'],
    },
  },
  {
    name: 'mysql_execute_write',
    description: 'Execute an INSERT, UPDATE, or DELETE statement',
    inputSchema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'INSERT, UPDATE, or DELETE query to execute' },
      },
      required: ['sql'],
    },
  },
  {
    name: 'mysql_execute_ddl',
    description: 'Execute a DDL statement (CREATE, ALTER, DROP)',
    inputSchema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'DDL statement (CREATE, ALTER, DROP) to execute' },
      },
      required: ['sql'],
    },
  },
  {
    name: 'mysql_explain_query',
    description: 'Get the query execution plan (EXPLAIN) for a SELECT query',
    inputSchema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'Query to explain' },
      },
      required: ['sql'],
    },
  },
  {
    name: 'mysql_estimate_affected_rows',
    description: 'Estimate how many rows will be affected by an UPDATE or DELETE query',
    inputSchema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'UPDATE or DELETE query to estimate' },
      },
      required: ['sql'],
    },
  },

  // Diagnostic tools
  {
    name: 'mysql_show_processlist',
    description: 'Show all current MySQL connections and queries',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum number of processes to show', default: 20 },
      },
    },
  },
  {
    name: 'mysql_analyze_query',
    description: 'Analyze a SELECT query and provide performance recommendations',
    inputSchema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'Query to analyze' },
      },
      required: ['sql'],
    },
  },
];

// Create MCP server
const server = new Server(
  {
    name: 'mysql-agent-mcp-server',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handler: List tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Handler: Call tool
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: unknown;

    switch (name) {
      // Connection
      case 'mysql_connect':
        result = await connection.connect(connection.ConnectSchema.parse(args || {}));
        break;
      case 'mysql_disconnect':
        result = await connection.disconnect();
        break;
      case 'mysql_status':
        result = connection.getConnectionStatus();
        break;

      // Schema
      case 'mysql_list_databases':
        result = await schema.listDatabases();
        break;
      case 'mysql_list_tables':
        result = await schema.listTables(schema.ListTablesSchema.parse(args || {}));
        break;
      case 'mysql_describe_table':
        result = await schema.describeTable(schema.DescribeTableSchema.parse(args || {}));
        break;
      case 'mysql_get_table_stats':
        result = await schema.getTableStats(schema.GetTableStatsSchema.parse(args || {}));
        break;
      case 'mysql_table_exists':
        result = await schema.tableExists(schema.TableExistsSchema.parse(args || {}));
        break;

      // Query
      case 'mysql_execute_query':
        result = await query.executeQuery(query.ExecuteQuerySchema.parse(args || {}));
        break;
      case 'mysql_execute_write':
        result = await query.executeWrite(query.ExecuteWriteSchema.parse(args || {}));
        break;
      case 'mysql_execute_ddl':
        result = await query.executeDDL(query.ExecuteDDLSchema.parse(args || {}));
        break;
      case 'mysql_explain_query':
        result = await query.explainQuery(query.ExplainQuerySchema.parse(args || {}));
        break;
      case 'mysql_estimate_affected_rows':
        result = await query.estimateAffectedRows(query.EstimateAffectedRowsSchema.parse(args || {}));
        break;

      // Diagnostics
      case 'mysql_show_processlist':
        result = await diagnostics.showProcessList(diagnostics.ShowProcessListSchema.parse(args || {}));
        break;
      case 'mysql_analyze_query':
        result = await diagnostics.analyzeQuery(diagnostics.AnalyzeQuerySchema.parse(args || {}));
        break;

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }),
        },
      ],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});
