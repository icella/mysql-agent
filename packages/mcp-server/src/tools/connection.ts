/**
 * Connection Tools for MCP Server
 */

import { mysqlClient } from '../mysql-client.js';
import type { ConnectionConfig } from '../types.js';
import { z } from 'zod';

export const ConnectSchema = z.object({
  host: z.string().describe('MySQL host address'),
  port: z.number().optional().default(3306).describe('MySQL port'),
  user: z.string().describe('MySQL username'),
  password: z.string().describe('MySQL password'),
  database: z.string().optional().describe('Default database to use'),
});

export const connect = async (input: z.infer<typeof ConnectSchema>) => {
  const config: ConnectionConfig = {
    alias: `${input.host}:${input.port}`,
    host: input.host,
    port: input.port,
    user: input.user,
    password: input.password,
    database: input.database,
  };

  await mysqlClient.connect(config);

  const currentConfig = mysqlClient.getConfig();
  return {
    success: true,
    message: `Connected to ${currentConfig?.host}:${currentConfig?.port}/${currentConfig?.database || 'no database'}`,
    connection: {
      host: currentConfig?.host,
      port: currentConfig?.port,
      database: currentConfig?.database,
      readOnly: currentConfig?.readOnly,
    },
  };
};

export const disconnect = async () => {
  await mysqlClient.disconnect();
  return {
    success: true,
    message: 'Disconnected from database',
  };
};

export const getConnectionStatus = () => {
  const config = mysqlClient.getConfig();
  return {
    connected: mysqlClient.isConnected(),
    connection: config ? {
      host: config.host,
      port: config.port,
      database: config.database,
      readOnly: config.readOnly,
    } : null,
  };
};
