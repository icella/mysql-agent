/**
 * MySQL Client - Connection Pool Manager
 * Based on vscode-database-client's mysqlConnection.ts
 */

import mysql, { Pool, PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import type { ConnectionConfig, TableInfo, ColumnInfo, IndexInfo, QueryResult, ExplainResult } from './types.js';

export class MySQLClient {
  private pool: Pool | null = null;
  private config: ConnectionConfig | null = null;

  async connect(config: ConnectionConfig): Promise<void> {
    // Close existing connection if any
    await this.disconnect();

    const connectionConfig: mysql.PoolOptions = {
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
      // Support for auth plugins
      authPlugins: undefined,
      // Timezone handling
      timezone: '+08:00',
    };

    this.pool = mysql.createPool(connectionConfig);
    this.config = config;

    // Test connection
    const conn = await this.pool.getConnection();
    conn.release();
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.config = null;
    }
  }

  isConnected(): boolean {
    return this.pool !== null;
  }

  getConfig(): ConnectionConfig | null {
    return this.config;
  }

  private async getConnection(): Promise<PoolConnection> {
    if (!this.pool) {
      throw new Error('Not connected to database');
    }
    return this.pool.getConnection();
  }

  /**
   * Execute a SELECT query
   */
  async executeQuery(sql: string, limit = 1000): Promise<QueryResult> {
    const conn = await this.getConnection();
    const startTime = Date.now();

    try {
      // Ensure SELECT queries have a LIMIT
      const safeSql = this.addLimit(sql, limit);

      const [rows, fields] = await conn.query<RowDataPacket[]>(safeSql);

      return {
        columns: fields.map(f => f.name),
        rows: rows as Record<string, unknown>[],
        rowCount: rows.length,
        executionTime: Date.now() - startTime,
      };
    } finally {
      conn.release();
    }
  }

  /**
   * Execute a write operation (INSERT, UPDATE, DELETE)
   */
  async executeWrite(sql: string): Promise<QueryResult> {
    if (this.config?.readOnly) {
      throw new Error('This connection is read-only');
    }

    const conn = await this.getConnection();
    const startTime = Date.now();

    try {
      await conn.beginTransaction();

      const [result] = await conn.query<ResultSetHeader>(sql);

      await conn.commit();

      return {
        columns: ['affectedRows', 'insertId', 'warningStatus'],
        rows: [{
          affectedRows: result.affectedRows,
          insertId: result.insertId,
          warningStatus: result.warningStatus,
        }],
        rowCount: 1,
        executionTime: Date.now() - startTime,
        affectedRows: result.affectedRows,
      };
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  /**
   * Execute DDL (ALTER, CREATE, DROP)
   */
  async executeDDL(sql: string): Promise<QueryResult> {
    if (this.config?.readOnly) {
      throw new Error('This connection is read-only');
    }

    const conn = await this.getConnection();
    const startTime = Date.now();

    try {
      const [result] = await conn.query<ResultSetHeader>(sql);

      return {
        columns: ['affectedRows', 'warningStatus'],
        rows: [{
          affectedRows: result.affectedRows,
          warningStatus: result.warningStatus,
        }],
        rowCount: 1,
        executionTime: Date.now() - startTime,
        affectedRows: result.affectedRows,
      };
    } finally {
      conn.release();
    }
  }

  /**
   * Get EXPLAIN results for a query
   */
  async explainQuery(sql: string): Promise<ExplainResult[]> {
    const conn = await this.getConnection();
    try {
      const [rows] = await conn.query<RowDataPacket[]>(`EXPLAIN ${sql}`);
      return rows as unknown as ExplainResult[];
    } finally {
      conn.release();
    }
  }

  /**
   * List all databases
   */
  async listDatabases(): Promise<string[]> {
    const conn = await this.getConnection();
    try {
      const [rows] = await conn.query<RowDataPacket[]>(
        'SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN (\'information_schema\', \'mysql\', \'performance_schema\', \'sys\') ORDER BY schema_name'
      );
      return rows.map(r => r.schema_name);
    } finally {
      conn.release();
    }
  }

  /**
   * List all tables in the current database
   */
  async listTables(database?: string): Promise<string[]> {
    const conn = await this.getConnection();
    try {
      const db = database || this.config?.database;
      if (!db) {
        throw new Error('No database specified');
      }

      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE' ORDER BY table_name`,
        [db]
      );
      return rows.map(r => r.table_name);
    } finally {
      conn.release();
    }
  }

  /**
   * Get table structure
   */
  async describeTable(tableName: string): Promise<{
    columns: ColumnInfo[];
    indexes: IndexInfo[];
    foreignKeys: RowDataPacket[];
    tableInfo: TableInfo;
  }> {
    const conn = await this.getConnection();
    const db = this.config?.database;

    if (!db) {
      throw new Error('No database specified');
    }

    try {
      // Get columns
      const [columns] = await conn.query<RowDataPacket[]>(
        `SELECT * FROM information_schema.columns WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position`,
        [db, tableName]
      );

      // Get indexes
      const [indexes] = await conn.query<RowDataPacket[]>(
        `SELECT * FROM information_schema.statistics WHERE table_schema = ? AND table_name = ? ORDER BY index_name, seq_in_index`,
        [db, tableName]
      );

      // Get foreign keys
      const [foreignKeys] = await conn.query<RowDataPacket[]>(
        `SELECT * FROM information_schema.key_column_usage WHERE table_schema = ? AND table_name = ? AND referenced_table_name IS NOT NULL`,
        [db, tableName]
      );

      // Get table info
      const [tableInfo] = await conn.query<RowDataPacket[]>(
        `SELECT engine, table_rows, data_length, index_length, create_time, update_time
         FROM information_schema.tables WHERE table_schema = ? AND table_name = ?`,
        [db, tableName]
      );

      return {
        columns: columns as ColumnInfo[],
        indexes: indexes as IndexInfo[],
        foreignKeys,
        tableInfo: tableInfo[0] as TableInfo,
      };
    } finally {
      conn.release();
    }
  }

  /**
   * Check if a table exists in a specific database
   */
  async tableExists(database: string, tableName: string): Promise<boolean> {
    const conn = await this.getConnection();
    try {
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = ? AND table_name = ?`,
        [database, tableName]
      );
      return rows[0].count > 0;
    } finally {
      conn.release();
    }
  }

  /**
   * Get table stats
   */
  async getTableStats(tableName: string): Promise<TableInfo> {
    const conn = await this.getConnection();
    const db = this.config?.database;

    if (!db) {
      throw new Error('No database specified');
    }

    try {
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT engine, table_rows, data_length, index_length, create_time, update_time
         FROM information_schema.tables WHERE table_schema = ? AND table_name = ?`,
        [db, tableName]
      );

      if (rows.length === 0) {
        throw new Error(`Table ${tableName} not found`);
      }

      return rows[0] as TableInfo;
    } finally {
      conn.release();
    }
  }

  /**
   * Show current processes
   */
  async showProcessList(): Promise<RowDataPacket[]> {
    const conn = await this.getConnection();
    try {
      const [rows] = await conn.query<RowDataPacket[]>('SHOW FULL PROCESSLIST');
      return rows;
    } finally {
      conn.release();
    }
  }

  /**
   * Ensure SELECT queries have a LIMIT to prevent runaway queries
   */
  private addLimit(sql: string, limit: number): string {
    const trimmed = sql.trim().toUpperCase();

    // If it's a SELECT without LIMIT
    if (trimmed.startsWith('SELECT') && !trimmed.includes('LIMIT')) {
      return `${sql.trim()} LIMIT ${limit}`;
    }

    return sql;
  }

  /**
   * Estimate affected rows for a query (for safety confirmation)
   */
  async estimateAffectedRows(sql: string): Promise<number> {
    const trimmed = sql.trim().toUpperCase();

    if (trimmed.startsWith('UPDATE')) {
      // Extract WHERE clause and count
      const match = sql.match(/UPDATE\s+\S+\s+SET/i);
      if (match) {
        const whereClause = sql.slice(sql.indexOf(match[0]) + match[0].length);
        const countSql = `SELECT COUNT(*) as cnt FROM (${sql.replace(/LIMIT\s+\d+/i, '')}) as t`.slice(0, 200);
        try {
          const result = await this.executeQuery(countSql);
          return result.rows[0]?.cnt as number || 0;
        } catch {
          return -1; // Unknown
        }
      }
    }

    return -1; // Unknown
  }
}

export const mysqlClient = new MySQLClient();
