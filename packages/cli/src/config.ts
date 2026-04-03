/**
 * Connection Manager - Handles config loading, saving, and environment variable resolution
 */

import Conf from 'conf';
import type { ConnectionConfig } from './types.js';
import path from 'path';
import os from 'os';
import dotenv from 'dotenv';

// Load .env files
dotenv.config();

interface ConfigSchema {
  version: string;
  connections: Record<string, ConnectionConfig>;
  defaultConnection?: string;
  preferences: {
    recentConnections: string[];
    favorites: string[];
    userOverrides: { queryPattern: string; connection: string; confidenceBoost: number }[];
  };
}

class ConnectionManager {
  private config: Conf<ConfigSchema>;
  private configPath: string;

  constructor() {
    this.configPath = path.join(os.homedir(), '.mysql-agent', 'config.json');
    this.config = new Conf<ConfigSchema>({
      projectName: 'mysql-agent',
      schema: {
        version: { type: 'string', default: '1' },
        connections: { type: 'object', default: {} },
        defaultConnection: { type: 'string' },
        preferences: {
          type: 'object',
          default: {
            recentConnections: [],
            favorites: [],
            userOverrides: [],
          },
        },
      },
      cwd: path.join(os.homedir(), '.mysql-agent'),
    });
  }

  /**
   * Get all configured connections
   */
  getConnections(): Record<string, ConnectionConfig> {
    return this.config.get('connections', {});
  }

  /**
   * Get a specific connection by alias
   */
  getConnection(alias: string): ConnectionConfig | null {
    const connections = this.getConnections();
    return connections[alias] || null;
  }

  /**
   * Add or update a connection
   */
  setConnection(alias: string, config: Omit<ConnectionConfig, 'alias'>): void {
    const connections = this.getConnections();
    connections[alias] = {
      ...config,
      alias,
    };
    this.config.set('connections', connections);
  }

  /**
   * Remove a connection
   */
  removeConnection(alias: string): boolean {
    const connections = this.getConnections();
    if (connections[alias]) {
      delete connections[alias];
      this.config.set('connections', connections);
      return true;
    }
    return false;
  }

  /**
   * Resolve environment variable references in config
   */
  resolveEnvVars(value: string): string {
    // Match ${VAR_NAME} or $VAR_NAME patterns
    const envPattern = /\$\{?([A-Z_][A-Z0-9_]*)\}?/g;

    return value.replace(envPattern, (match, varName) => {
      const envValue = process.env[varName];
      if (envValue === undefined) {
        console.warn(`Warning: Environment variable ${varName} is not set`);
        return '';
      }
      return envValue;
    });
  }

  /**
   * Get connection with resolved environment variables
   */
  getResolvedConnection(alias: string): (ConnectionConfig & { resolvedPassword: string }) | null {
    const conn = this.getConnection(alias);
    if (!conn) return null;

    return {
      ...conn,
      resolvedPassword: this.resolveEnvVars(conn.password),
    };
  }

  /**
   * Alias for getResolvedConnection for compatibility
   */
  resolveConnection(alias: string): (ConnectionConfig & { resolvedPassword: string }) | null {
    return this.getResolvedConnection(alias);
  }

  /**
   * Add to recent connections list
   */
  addToRecent(alias: string): void {
    const recent: string[] = this.config.get('preferences.recentConnections', []);
    const filtered = recent.filter((a) => a !== alias);
    filtered.unshift(alias);
    // Keep only last 10
    const limited = filtered.slice(0, 10);
    this.config.set('preferences.recentConnections', limited);
  }

  /**
   * Get recent connections
   */
  getRecent(): string[] {
    return this.config.get('preferences.recentConnections', []);
  }

  /**
   * Add to favorites
   */
  addToFavorites(alias: string): void {
    const favorites: string[] = this.config.get('preferences.favorites', []);
    if (!favorites.includes(alias)) {
      favorites.push(alias);
      this.config.set('preferences.favorites', favorites);
    }
  }

  /**
   * Remove from favorites
   */
  removeFromFavorites(alias: string): void {
    const favorites = this.config.get('preferences.favorites', []);
    this.config.set('preferences.favorites', favorites.filter((f: string) => f !== alias));
  }

  /**
   * Get favorites
   */
  getFavorites(): string[] {
    return this.config.get('preferences.favorites', []);
  }

  /**
   * Get user overrides for query patterns
   */
  getUserOverrides(): { queryPattern: string; connection: string; confidenceBoost: number }[] {
    return this.config.get('preferences.userOverrides', []);
  }

  /**
   * Add a user override
   */
  addUserOverride(pattern: string, connection: string, boost: number = 20): void {
    const overrides = this.getUserOverrides();
    // Remove existing override for same pattern
    const filtered = overrides.filter(o => o.queryPattern !== pattern);
    filtered.push({ queryPattern: pattern, connection, confidenceBoost: boost });
    this.config.set('preferences.userOverrides', filtered);
  }

  /**
   * Get default connection
   */
  getDefaultConnection(): string | null {
    return this.config.get('defaultConnection') || null;
  }

  /**
   * Set default connection
   */
  setDefaultConnection(alias: string): void {
    this.config.set('defaultConnection', alias);
  }

  /**
   * Export full agent config
   */
  getAgentConfig() {
    return {
      connections: this.getConnections(),
      defaultConnection: this.getDefaultConnection() || undefined,
      preferences: {
        recentConnections: this.getRecent(),
        favorites: this.getFavorites(),
        userOverrides: this.getUserOverrides(),
      },
    };
  }

  /**
   * Get config file path
   */
  getConfigPath(): string {
    return this.configPath;
  }
}

export const connectionManager = new ConnectionManager();
