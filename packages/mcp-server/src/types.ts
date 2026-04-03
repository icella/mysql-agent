/**
 * MySQL Agent - Type Definitions
 */

export interface ConnectionConfig {
  alias: string;
  host: string;
  port: number;
  user: string;
  password: string;
  database?: string;
  description?: string;
  tags?: string[];
  readOnly?: boolean;
  sshTunnel?: {
    host: string;
    port?: number;
    user: string;
    privateKeyPath?: string;
  };
}

export interface ConnectionInstance {
  config: ConnectionConfig;
  connection: import('mysql2/promise').Pool | null;
  lastUsed?: Date;
}

export interface AgentConfig {
  connections: Record<string, ConnectionConfig>;
  defaultConnection?: string;
  preferences: {
    recentConnections: string[];
    favorites: string[];
    userOverrides: UserOverride[];
  };
}

export interface UserOverride {
  queryPattern: string;
  connection: string;
  confidenceBoost: number;
}

export interface TableInfo {
  tableName: string;
  engine: string | null;
  tableRows: number | null;
  dataLength: number;
  indexLength: number;
  createTime: Date;
  updateTime: Date;
}

export interface ColumnInfo {
  field: string;
  type: string;
  collation: string | null;
  isNull: string;
  key: string | null;
  default: string | null;
  extra: string;
  privileges: string;
  comment: string;
}

export interface IndexInfo {
  nonUnique: number;
  keyName: string;
  seqInIndex: number;
  columnName: string;
  collation: string | null;
  cardinality: number | null;
  subPart: number | null;
  packed: string | null;
  nullable: string;
  indexType: string;
  comment: string;
  indexComment: string;
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  executionTime: number;
  affectedRows?: number;
}

export interface ExplainResult {
  id: string;
  selectType: string;
  table: string | null;
  type: string | null;
  possibleKeys: string | null;
  key: string | null;
  keyLen: string | null;
  ref: string | null;
  rows: number;
  extra: string | null;
}

export interface ConnectionMatchResult {
  connection: ConnectionConfig;
  score: number;
  signals: {
    exactAlias: boolean;
    exactDatabaseName: boolean;
    exactHost: boolean;
    tagMatch: boolean;
    tableNameMatch: boolean;
    recentUse: boolean;
  };
}
