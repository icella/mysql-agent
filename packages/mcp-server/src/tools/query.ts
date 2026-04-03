/**
 * Query Tools for MCP Server
 */

import { mysqlClient } from '../mysql-client.js';
import { z } from 'zod';
import type { ExplainResult } from '../types.js';

export const ExecuteQuerySchema = z.object({
  sql: z.string().describe('SELECT query to execute'),
  limit: z.number().optional().default(1000).describe('Maximum rows to return'),
});

export const executeQuery = async (input: z.infer<typeof ExecuteQuerySchema>) => {
  const trimmedSql = input.sql.trim().toUpperCase();

  // Security: Only allow SELECT queries
  if (!trimmedSql.startsWith('SELECT')) {
    throw new Error('Only SELECT queries are allowed via executeQuery. Use executeWrite for INSERT/UPDATE/DELETE.');
  }

  const result = await mysqlClient.executeQuery(input.sql, input.limit);

  return {
    columns: result.columns,
    rows: result.rows,
    rowCount: result.rowCount,
    executionTime: `${result.executionTime}ms`,
    truncated: result.rowCount >= input.limit,
  };
};

export const ExecuteWriteSchema = z.object({
  sql: z.string().describe('INSERT, UPDATE, or DELETE query to execute'),
});

export const executeWrite = async (input: z.infer<typeof ExecuteWriteSchema>) => {
  const result = await mysqlClient.executeWrite(input.sql);

  return {
    success: true,
    affectedRows: result.affectedRows,
    insertId: result.rows[0]?.insertId || null,
    executionTime: `${result.executionTime}ms`,
  };
};

export const ExecuteDDLSchema = z.object({
  sql: z.string().describe('DDL statement (CREATE, ALTER, DROP) to execute'),
});

export const executeDDL = async (input: z.infer<typeof ExecuteDDLSchema>) => {
  const result = await mysqlClient.executeDDL(input.sql);

  return {
    success: true,
    affectedRows: result.affectedRows,
    executionTime: `${result.executionTime}ms`,
    message: 'DDL executed successfully',
  };
};

export const ExplainQuerySchema = z.object({
  sql: z.string().describe('Query to explain'),
});

export const explainQuery = async (input: z.infer<typeof ExplainQuerySchema>) => {
  const result = await mysqlClient.explainQuery(input.sql);

  return {
    analysis: result.map(row => ({
      table: row.table,
      type: row.type,
      possibleKeys: row.possibleKeys,
      key: row.key,
      rowsExamined: row.rows,
      extra: row.extra,
    })),
    recommendations: generateRecommendations(result),
  };
};

function generateRecommendations(explain: ExplainResult[]): string[] {
  const recommendations: string[] = [];

  for (const row of explain) {
    if (!row.key) {
      recommendations.push(`Table ${row.table}: Query does not use an index - consider adding an index on the WHERE/JOIN columns`);
    }

    if (row.type === 'ALL') {
      recommendations.push(`Table ${row.table}: Full table scan detected - this may be slow for large tables`);
    }

    if (row.rows && row.rows > 10000) {
      recommendations.push(`Table ${row.table}: Scanning ${row.rows} rows - consider adding a more selective index`);
    }

    if (row.extra?.includes('Using filesort')) {
      recommendations.push(`Table ${row.table}: Using filesort - consider optimizing the ORDER BY clause or adding an index`);
    }

    if (row.extra?.includes('Using temporary')) {
      recommendations.push(`Table ${row.table}: Using temporary table - query may benefit from optimization`);
    }
  }

  return recommendations.length > 0 ? recommendations : ['Query looks optimal based on EXPLAIN analysis'];
}

export const EstimateAffectedRowsSchema = z.object({
  sql: z.string().describe('UPDATE or DELETE query to estimate'),
});

export const estimateAffectedRows = async (input: z.infer<typeof EstimateAffectedRowsSchema>) => {
  const count = await mysqlClient.estimateAffectedRows(input.sql);

  if (count === -1) {
    return {
      estimated: null,
      message: 'Unable to estimate affected rows - query may be complex',
    };
  }

  return {
    estimated: count,
    message: count > 0 ? `This operation will affect approximately ${count} rows` : 'No rows will be affected',
  };
};
