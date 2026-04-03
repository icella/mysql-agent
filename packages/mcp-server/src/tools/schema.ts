/**
 * Schema Tools for MCP Server
 */

import { mysqlClient } from '../mysql-client.js';
import { z } from 'zod';

export const ListDatabasesSchema = z.object({});

export const listDatabases = async () => {
  const databases = await mysqlClient.listDatabases();
  return {
    databases,
    count: databases.length,
  };
};

export const ListTablesSchema = z.object({
  database: z.string().optional().describe('Database name (uses current if not specified)'),
});

export const listTables = async (input: z.infer<typeof ListTablesSchema>) => {
  const tables = await mysqlClient.listTables(input.database);
  return {
    tables,
    count: tables.length,
  };
};

export const DescribeTableSchema = z.object({
  table: z.string().describe('Table name to describe'),
});

export const describeTable = async (input: z.infer<typeof DescribeTableSchema>) => {
  const info = await mysqlClient.describeTable(input.table);

  return {
    table: input.table,
    columns: info.columns.map(col => ({
      name: col.field,
      type: col.type,
      nullable: col.isNull === 'YES',
      key: col.key,
      default: col.default,
      extra: col.extra,
      comment: col.comment,
    })),
    indexes: info.indexes.map(idx => ({
      name: idx.keyName,
      columns: info.indexes
        .filter(i => i.keyName === idx.keyName)
        .map(i => i.columnName)
        .join(', '),
      unique: idx.nonUnique === 0,
      type: idx.indexType,
    })),
    foreignKeys: info.foreignKeys.map(fk => ({
      column: fk.COLUMN_NAME,
      references: `${fk.REFERENCED_TABLE_NAME}.${fk.REFERENCED_COLUMN_NAME}`,
    })),
    stats: {
      engine: info.tableInfo.engine,
      rows: info.tableInfo.tableRows,
      dataSize: formatBytes(info.tableInfo.dataLength || 0),
      indexSize: formatBytes(info.tableInfo.indexLength || 0),
    },
  };
};

export const GetTableStatsSchema = z.object({
  table: z.string().describe('Table name'),
});

export const getTableStats = async (input: z.infer<typeof GetTableStatsSchema>) => {
  const stats = await mysqlClient.getTableStats(input.table);

  return {
    table: input.table,
    engine: stats.engine,
    rows: stats.tableRows,
    dataSize: formatBytes(stats.dataLength || 0),
    indexSize: formatBytes(stats.indexLength || 0),
    createTime: stats.createTime,
    updateTime: stats.updateTime,
  };
};

export const TableExistsSchema = z.object({
  database: z.string().describe('Database name'),
  table: z.string().describe('Table name to check'),
});

export const tableExists = async (input: z.infer<typeof TableExistsSchema>) => {
  const exists = await mysqlClient.tableExists(input.database, input.table);
  return { exists };
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}
