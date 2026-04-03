/**
 * Smart Connection Selector - High Precision Matching
 *
 * Multi-layer signal scoring system for automatic database connection selection.
 */

import Fuse from 'fuse.js';
import type { ConnectionConfig, ConnectionMatchResult, ConnectionMatchSignal } from './types.js';
import { connectionManager } from './config.js';

// Weights for scoring
const WEIGHTS = {
  exactAlias: 100,
  exactDatabaseName: 80,
  exactHost: 80,
  tagMatch: 50,
  userOverride: 30,
  recentUse: 20,
  favorite: 10,
};

// Confidence thresholds
const CONFIDENCE_THRESHOLD_HIGH = 80;
const CONFIDENCE_THRESHOLD_MEDIUM = 60;

interface ExtractedKeywords {
  tableNames: string[];
  databaseNames: string[];
  hostPatterns: string[];
  envPatterns: string[];
  generalKeywords: string[];
}

/**
 * Extract meaningful keywords from user input
 */
function extractKeywords(input: string): ExtractedKeywords {
  const lowerInput = input.toLowerCase();

  // Extract potential table names
  const tableNamePatterns = [
    /[a-z][a-z0-9_]*(?:s|es)?/g,
  ];

  const tableNames: string[] = [];
  const generalKeywords: string[] = [];

  for (const pattern of tableNamePatterns) {
    const matches = input.match(pattern) || [];
    for (const match of matches) {
      if (!isCommonWord(match)) {
        tableNames.push(match.toLowerCase());
        generalKeywords.push(match.toLowerCase());
      }
    }
  }

  // Extract database names
  const dbPatterns = [
    /(?:into|from|use|on)\s+`?([a-z][a-z0-9_]*_?[dbdatabase])`?/gi,
  ];

  const databaseNames: string[] = [];
  for (const pattern of dbPatterns) {
    const matches = input.match(pattern) || [];
    databaseNames.push(...matches.map(m => m.replace(/[`]/g, '').toLowerCase().trim()));
  }

  // Extract host/IP patterns
  const hostPatterns = input.match(/\b(?:prod|staging|dev|test|localhost|127\.0\.0\.1|\d+\.\d+\.\d+\.\d+|[a-z0-9-]+\.[a-z0-9.-]+)\b/gi) || [];

  // Extract environment patterns
  const envPatterns: string[] = [];
  const envKeywords: Record<string, string[]> = {
    production: ['prod', 'production', '生产', '线上'],
    staging: ['staging', '预发', 'stg'],
    development: ['dev', 'development', '开发', '本地', 'local'],
    test: ['test', '测试', 'qa'],
  };

  for (const [env, keywords] of Object.entries(envKeywords)) {
    if (keywords.some(k => lowerInput.includes(k))) {
      envPatterns.push(env);
    }
  }

  generalKeywords.push(...hostPatterns.map(h => h.toLowerCase()));
  generalKeywords.push(...envPatterns);

  return {
    tableNames: [...new Set(tableNames)],
    databaseNames: [...new Set(databaseNames)],
    hostPatterns: [...new Set(hostPatterns.map(h => h.toLowerCase()))],
    envPatterns: [...new Set(envPatterns)],
    generalKeywords: [...new Set(generalKeywords)],
  };
}

/**
 * Check if a word is a common word
 */
function isCommonWord(word: string): boolean {
  const commonWords = new Set([
    'select', 'from', 'where', 'and', 'or', 'not', 'in', 'is', 'null',
    'table', 'tables', 'database', 'databases', 'schema', 'index', 'indexes',
    'count', 'sum', 'avg', 'max', 'min', 'group', 'order', 'by', 'join',
    'left', 'right', 'inner', 'outer', 'cross', 'limit', 'offset',
    'insert', 'update', 'delete', 'create', 'drop', 'alter', 'add',
    'user', 'users', 'password', 'email', 'name', 'date', 'time',
    'id', 'ids', 'url', 'link', 'new', 'old', 'all', 'any', 'some',
    'get', 'set', 'put', 'post', 'delete', 'run', 'show', 'list',
    'what', 'which', 'who', 'how', 'many', 'much', 'some', 'all',
    'the', 'this', 'that', 'these', 'those', 'it', 'its',
    '昨天', '今天', '明天', '最近', '查询', '搜索', '找到', '获取',
    '用户', '订单', '产品', '数据', '表', '库', '数据库',
  ]);
  return commonWords.has(word.toLowerCase());
}

/**
 * Calculate semantic similarity using Fuse.js
 */
function calculateSemanticSimilarity(text: string, keywords: string[]): number {
  if (keywords.length === 0) return 0;

  const fuse = new Fuse([text], {
    includeScore: true,
    threshold: 0.4,
  });

  let totalScore = 0;
  for (const keyword of keywords) {
    const results = fuse.search(keyword.toLowerCase());
    if (results.length > 0) {
      totalScore += 1 - (results[0].score || 0);
    }
  }

  return totalScore / keywords.length;
}

/**
 * Calculate match score for a single connection
 */
function calculateMatchScore(
  alias: string,
  config: ConnectionConfig,
  keywords: ExtractedKeywords,
  recent: string[],
  favorites: string[],
  overrides: { queryPattern: string; connection: string; confidenceBoost: number }[]
): ConnectionMatchResult {
  const signals: ConnectionMatchSignal = {
    exactAlias: false,
    exactDatabaseName: false,
    exactHost: false,
    tagMatch: false,
    tableNameMatch: false,
    descriptionSemantic: 0,
    recentUse: false,
    favorite: false,
  };

  let score = 0;

  // 1. Exact alias match
  if (keywords.generalKeywords.some(k => k.toLowerCase() === alias.toLowerCase())) {
    signals.exactAlias = true;
    score += WEIGHTS.exactAlias;
  }

  // 2. Exact database name match
  const dbName = config.database?.toLowerCase() || '';
  if (keywords.databaseNames.some(k => k.includes(dbName) || dbName.includes(k))) {
    signals.exactDatabaseName = true;
    score += WEIGHTS.exactDatabaseName;
  }

  // 3. Exact host match
  const hostName = config.host.toLowerCase();
  if (keywords.hostPatterns.some(k => hostName.includes(k) || k.includes(hostName))) {
    signals.exactHost = true;
    score += WEIGHTS.exactHost;
  }

  // 4. Tag match
  const tags = config.tags?.map((t: string) => t.toLowerCase()) || [];
  if (keywords.envPatterns.some(k => tags.includes(k))) {
    signals.tagMatch = true;
    score += WEIGHTS.tagMatch;
  }

  // 5. User override pattern match
  const matchingOverride = overrides.find(o =>
    keywords.generalKeywords.some(k => o.queryPattern.toLowerCase().includes(k))
  );
  if (matchingOverride && matchingOverride.connection === alias) {
    score += WEIGHTS.userOverride + matchingOverride.confidenceBoost;
  }

  // 6. Recent use
  if (recent.includes(alias)) {
    signals.recentUse = true;
    score += WEIGHTS.recentUse;
  }

  // 7. Favorite
  if (favorites.includes(alias)) {
    signals.favorite = true;
    score += WEIGHTS.favorite;
  }

  // 8. Description semantic similarity
  const description = config.description || '';
  if (description) {
    signals.descriptionSemantic = calculateSemanticSimilarity(description, keywords.generalKeywords);
    score += signals.descriptionSemantic * WEIGHTS.tagMatch;
  }

  return {
    connection: config,
    score,
    signals,
  };
}

/**
 * Main function: Select the best matching connection
 */
export async function selectConnection(
  userInput: string,
  forceConfirm: boolean = false
): Promise<{
  selected: ConnectionConfig;
  confidence: 'high' | 'medium' | 'low';
  alternatives?: ConnectionConfig[];
}> {
  const connections = connectionManager.getConnections();
  const recent = connectionManager.getRecent();
  const favorites = connectionManager.getFavorites();
  const overrides = connectionManager.getUserOverrides();

  if (Object.keys(connections).length === 0) {
    throw new Error('No connections configured. Run "mysql-agent config add" to add a connection.');
  }

  // If only one connection, use it directly
  const aliases = Object.keys(connections);
  if (aliases.length === 1) {
    return {
      selected: connections[aliases[0]],
      confidence: 'high',
    };
  }

  // Extract keywords from user input
  const keywords = extractKeywords(userInput);

  // Calculate score for each connection
  const scores: ConnectionMatchResult[] = [];

  for (const [alias, config] of Object.entries(connections)) {
    const result = calculateMatchScore(alias, config, keywords, recent, favorites, overrides);
    scores.push(result);
  }

  // Sort by score descending
  scores.sort((a, b) => b.score - a.score);

  const top = scores[0];
  const second = scores[1];

  // Calculate confidence
  let confidence: 'high' | 'medium' | 'low' = 'low';

  if (top.score >= CONFIDENCE_THRESHOLD_HIGH) {
    confidence = 'high';
  } else if (top.score >= CONFIDENCE_THRESHOLD_MEDIUM) {
    // Check if there's a clear winner
    if (!second || top.score - second.score >= 30) {
      confidence = 'medium';
    } else {
      confidence = 'low';
    }
  }

  // If only one high-scoring result and it's significantly better than others
  const hasClearWinner = top.score > 0 && (!second || top.score - second.score >= 40);

  if (forceConfirm || confidence === 'low' || (confidence === 'medium' && !hasClearWinner)) {
    // Return with alternatives for user selection
    return {
      selected: top.connection,
      confidence,
      alternatives: scores.slice(1, 4).map(s => s.connection),
    };
  }

  return {
    selected: top.connection,
    confidence,
  };
}

/**
 * Format match explanation for display
 */
export function formatMatchExplanation(result: ConnectionMatchResult): string {
  const parts: string[] = [];

  if (result.signals.exactAlias) {
    parts.push('exact alias match');
  }
  if (result.signals.exactDatabaseName) {
    parts.push('database name match');
  }
  if (result.signals.exactHost) {
    parts.push('host match');
  }
  if (result.signals.tagMatch) {
    parts.push('environment tag match');
  }
  if (result.signals.tableNameMatch) {
    parts.push('table exists in schema');
  }
  if (result.signals.recentUse) {
    parts.push('recently used');
  }
  if (result.signals.favorite) {
    parts.push('favorite');
  }
  if (result.signals.descriptionSemantic > 0.5) {
    parts.push('description semantic match');
  }

  return parts.length > 0
    ? `Matched on: ${parts.join(', ')} (score: ${result.score})`
    : `No strong signals (score: ${result.score})`;
}
