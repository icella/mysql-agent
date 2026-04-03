/**
 * MySQL Agent - Agent Definition
 *
 * Handles natural language to SQL conversion and query execution.
 */

import mysql, { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { connectionManager } from './config.js';
import { selectConnection } from './connection-selector.js';
import type { QueryResult, ConnectionConfig } from './types.js';

export interface AgentResponse {
  message: string;
  sql?: string;
  result?: QueryResult;
  connection?: string;
  confidence?: 'high' | 'medium' | 'low';
}

// Global connection pool
let currentPool: Pool | null = null;
let currentConfig: ConnectionConfig | null = null;

/**
 * Connect to a database
 */
async function connect(config: ConnectionConfig & { resolvedPassword?: string }): Promise<void> {
  if (currentPool) {
    await currentPool.end();
  }

  const poolConfig: mysql.PoolOptions = {
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.resolvedPassword || config.password,
    database: config.database,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
  };

  currentPool = mysql.createPool(poolConfig);
  currentConfig = config;
}

/**
 * Execute a query
 */
async function executeQuery(sql: string, limit = 1000): Promise<QueryResult> {
  if (!currentPool) {
    throw new Error('Not connected to database');
  }

  const conn = await currentPool.getConnection();
  const startTime = Date.now();

  try {
    // Add LIMIT if not present
    let safeSql = sql.trim();
    if (!safeSql.toUpperCase().includes('LIMIT')) {
      safeSql += ` LIMIT ${limit}`;
    }

    const [rows] = await conn.query<RowDataPacket[]>(safeSql);

    return {
      columns: rows.length > 0 ? Object.keys(rows[0]) : [],
      rows: rows as unknown as Record<string, unknown>[],
      rowCount: rows.length,
      executionTime: Date.now() - startTime,
    };
  } finally {
    conn.release();
  }
}

/**
 * Process user input
 */
export async function processInput(userInput: string): Promise<AgentResponse> {
  try {
    // Step 1: Smart connection selection
    const matchResult = await selectConnection(userInput);

    // Step 2: Connect to the selected database
    const resolvedConn = connectionManager.resolveConnection(matchResult.selected.alias);
    if (!resolvedConn) {
      throw new Error(`Failed to resolve connection: ${matchResult.selected.alias}`);
    }

    await connect(resolvedConn);
    connectionManager.addToRecent(matchResult.selected.alias);

    // Step 3: Generate SQL from natural language
    const { sql, needsConfirmation, confirmationMessage } = generateSQL(userInput, matchResult.selected);

    if (needsConfirmation) {
      return {
        message: `I will execute:\n\n${sql}\n\n${confirmationMessage}\n\nPlease confirm by typing 'yes' or 'y' to proceed.`,
        sql,
        connection: matchResult.selected.alias,
        confidence: matchResult.confidence,
      };
    }

    // Step 4: Execute the query
    const result = await executeQuery(sql);

    // Step 5: Format results
    const formattedResults = formatResults(result);

    return {
      message: formattedResults,
      sql,
      result,
      connection: matchResult.selected.alias,
      confidence: matchResult.confidence,
    };
  } catch (error) {
    return {
      message: `Error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Simple NL to SQL conversion (MVP version)
 */
function generateSQL(input: string, config: ConnectionConfig): {
  sql: string;
  needsConfirmation: boolean;
  confirmationMessage: string;
} {
  const lowerInput = input.toLowerCase();

  // Detect write operations
  const isWriteOperation = lowerInput.includes('update') ||
                            lowerInput.includes('delete') ||
                            lowerInput.includes('insert') ||
                            lowerInput.includes('drop') ||
                            lowerInput.includes('alter') ||
                            lowerInput.includes('create');

  // Extract table name (simplified - try user input first, then config)
  const tableMatch = input.match(/(?:from|in|on|update|table)\s+([a-z_][a-z0-9_]*)/i);
  let tableName = tableMatch ? tableMatch[1] : '';

  // If no table found in query, try to use the database name or prompt
  if (!tableName && config.database) {
    tableName = config.database;
  }

  if (!tableName) {
    return {
      sql: '-- No table specified',
      needsConfirmation: false,
      confirmationMessage: 'Could not determine which table to query.',
    };
  }

  // Generate SQL based on patterns
  let sql = '';

  if (lowerInput.includes('count') || lowerInput.includes('多少')) {
    sql = `SELECT COUNT(*) as count FROM ${tableName}`;
  } else if (lowerInput.includes('list') || lowerInput.includes('show')) {
    sql = `SELECT * FROM ${tableName}`;
  } else if (lowerInput.includes('describe') || lowerInput.includes('structure') || lowerInput.includes('结构')) {
    sql = `SELECT * FROM information_schema.columns WHERE table_name = '${tableName}'`;
  } else if (lowerInput.includes('index') || lowerInput.includes('索引')) {
    sql = `SELECT * FROM information_schema.statistics WHERE table_name = '${tableName}'`;
  } else {
    // Default to select all
    sql = `SELECT * FROM ${tableName}`;
  }

  // Add WHERE clause for date filters
  if (lowerInput.includes('yesterday') || lowerInput.includes('昨天')) {
    sql += ` WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 1 DAY)`;
  } else if (lowerInput.includes('today') || lowerInput.includes('今天')) {
    sql += ` WHERE created_at >= CURDATE()`;
  } else if (lowerInput.includes('last week') || lowerInput.includes('上周')) {
    sql += ` WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)`;
  } else if (lowerInput.includes('last month') || lowerInput.includes('上月')) {
    sql += ` WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`;
  }

  // Add ORDER BY for recent queries
  if (lowerInput.includes('recent') || lowerInput.includes('latest') || lowerInput.includes('最近')) {
    sql += ` ORDER BY created_at DESC`;
  }

  // Limit results
  if (!sql.includes('LIMIT')) {
    sql += ` LIMIT 100`;
  }

  return {
    sql,
    needsConfirmation: isWriteOperation,
    confirmationMessage: isWriteOperation
      ? 'This is a write operation and will modify data.'
      : '',
  };
}

/**
 * Format query results for display
 */
function formatResults(result: QueryResult): string {
  if (result.rows.length === 0) {
    return 'No results found.';
  }

  const lines: string[] = [];

  // Header
  lines.push(`Found ${result.rowCount} row(s) (${result.executionTime}ms)\n`);

  // Column headers
  const headers = result.columns.join(' | ');
  const separator = result.columns.map(c => '-'.repeat(Math.max(c.length, 8))).join('-+-');

  lines.push(headers);
  lines.push(separator);

  // Rows
  for (const row of result.rows.slice(0, 10)) {
    const values = result.columns.map(col => {
      const val = String(row[col] ?? 'NULL');
      return val.length > 20 ? val.slice(0, 17) + '...' : val.padEnd(Math.max(col.length, 8));
    });
    lines.push(values.join(' | '));
  }

  if (result.rowCount > 10) {
    lines.push(`... and ${result.rowCount - 10} more rows`);
  }

  return lines.join('\n');
}

/**
 * Execute a natural language query
 */
export async function executeNaturalLanguageQuery(userQuery: string): Promise<{
  sql?: string;
  needsConfirmation?: boolean;
  confirmationMessage?: string;
}> {
  const matchResult = await selectConnection(userQuery);
  const resolvedConn = connectionManager.resolveConnection(matchResult.selected.alias);

  if (!resolvedConn) {
    throw new Error('Connection not found');
  }

  const { sql, needsConfirmation, confirmationMessage } = generateSQL(userQuery, resolvedConn);

  return {
    sql,
    needsConfirmation,
    confirmationMessage,
  };
}
