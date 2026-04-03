/**
 * Diagnostic Tools for MCP Server
 */

import { mysqlClient } from '../mysql-client.js';
import { z } from 'zod';
import type { ExplainResult } from '../types.js';

export const ShowProcessListSchema = z.object({
  limit: z.number().optional().default(20).describe('Maximum number of processes to show'),
});

export const showProcessList = async (input: z.infer<typeof ShowProcessListSchema>) => {
  const processes = await mysqlClient.showProcessList();
  const limited = processes.slice(0, input.limit);

  return {
    processes: limited.map(p => ({
      id: p.Id,
      user: p.User,
      host: p.Host,
      database: p.db,
      command: p.Command,
      time: p.Time,
      state: p.State,
      info: p.Info,
    })),
    totalCount: processes.length,
    shownCount: limited.length,
  };
};

export const AnalyzeQuerySchema = z.object({
  sql: z.string().describe('Query to analyze'),
});

export const analyzeQuery = async (input: z.infer<typeof AnalyzeQuerySchema>) => {
  const trimmedSql = input.sql.trim().toUpperCase();

  if (!trimmedSql.startsWith('SELECT')) {
    return {
      error: 'Analysis is only available for SELECT queries',
    };
  }

  // Run EXPLAIN
  const explain = await mysqlClient.explainQuery(input.sql);

  // Get table stats
  const tables: { name: string; stats: Awaited<ReturnType<typeof mysqlClient.getTableStats>> }[] = [];
  const tableNames = new Set<string>();

  for (const row of explain) {
    if (row.table) {
      tableNames.add(row.table);
    }
  }

  for (const tableName of tableNames) {
    try {
      const stats = await mysqlClient.getTableStats(tableName);
      tables.push({ name: tableName, stats });
    } catch {
      // Table might not be accessible
    }
  }

  return {
    query: input.sql,
    plan: explain.map(row => ({
      step: explain.indexOf(row) + 1,
      table: row.table,
      operation: row.type || 'unknown',
      accessType: row.type,
      possibleKeys: row.possibleKeys,
      usedKey: row.key,
      rowsScanned: row.rows,
      extra: row.extra,
    })),
    tableStats: tables.map(t => ({
      name: t.name,
      rows: t.stats.tableRows,
      dataSize: formatBytes(t.stats.dataLength || 0),
      indexSize: formatBytes(t.stats.indexLength || 0),
    })),
    summary: generateSummary(explain, tables),
    recommendations: generateRecommendations(explain),
  };
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function generateSummary(explain: ExplainResult[], tables: { name: string; stats: { tableRows: number | null } }[]): string {
  const hasFullScan = explain.some(e => e.type === 'ALL');
  const hasNoIndex = explain.some(e => !e.key);
  const totalRows = tables.reduce((sum, t) => sum + (t.stats.tableRows || 0), 0);

  if (hasFullScan) {
    return `Warning: Full table scan detected. This query may be slow on large tables.`;
  }

  if (hasNoIndex) {
    return `Note: Some operations don't use indexes. Consider adding indexes on join/where columns.`;
  }

  return `Query plan looks reasonable. Total estimated rows: ${totalRows.toLocaleString()}`;
}

function generateRecommendations(explain: ExplainResult[]): string[] {
  const recommendations: string[] = [];

  for (const row of explain) {
    if (!row.key) {
      recommendations.push(`Add an index on ${row.table} for columns used in WHERE/JOIN`);
    }

    if (row.type === 'ALL') {
      recommendations.push(`Consider adding an index to avoid full table scan on ${row.table}`);
    }

    if (row.rows && row.rows > 10000) {
      recommendations.push(`High row count (${row.rows}) in ${row.table} - verify index selectivity`);
    }

    if (row.extra?.includes('Using filesort')) {
      recommendations.push(`Add an index covering the ORDER BY columns to avoid filesort`);
    }

    if (row.extra?.includes('Using temporary')) {
      recommendations.push(`Query creates temporary table - consider optimizing JOINs or subqueries`);
    }
  }

  return recommendations.length > 0 ? recommendations : ['No specific recommendations - query appears well-optimized'];
}
