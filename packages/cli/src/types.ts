/**
 * Types for MySQL Agent CLI
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

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  executionTime: number;
  affectedRows?: number;
}

export interface SessionContext {
  currentConnection: string | null;
  conversationHistory: ConversationMessage[];
  recentQueries: string[];
}

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

export interface ConnectionMatchSignal {
  exactAlias: boolean;
  exactDatabaseName: boolean;
  exactHost: boolean;
  tagMatch: boolean;
  tableNameMatch: boolean;
  descriptionSemantic: number;
  recentUse: boolean;
  favorite: boolean;
}

export interface ConnectionMatchResult {
  connection: ConnectionConfig;
  score: number;
  signals: ConnectionMatchSignal;
}

export type MatchConfidence = 'high' | 'medium' | 'low';
