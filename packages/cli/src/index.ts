#!/usr/bin/env node

/**
 * MySQL Agent CLI - Main Entry Point
 */

import { cac } from 'cac';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { processInput } from './agent.js';
import { connectionManager } from './config.js';
import mysql from 'mysql2/promise';

const cli = cac('mysql-agent');

// Global connection pool
let currentPool: mysql.Pool | null = null;

// Main command
cli.command('', 'Start interactive MySQL Agent session').action(async () => {
  console.log(chalk.blue(`
╔══════════════════════════════════════════════════════════════╗
║                  MySQL Agent - AI Native CLI                ║
║         Natural language database operations powered by AI  ║
╚══════════════════════════════════════════════════════════════╝
  `));

  // Check for connections
  const connections = connectionManager.getConnections();
  if (Object.keys(connections).length === 0) {
    console.log(chalk.yellow('No connections configured.'));
    console.log(chalk.gray('Run "mysql-agent config add" to add your first connection.'));
    process.exit(0);
  }

  // Interactive REPL
  const repl = async () => {
    const { default: Readline } = await import('readline');
    const rl = Readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const askQuestion = () => {
      return new Promise<string>((resolve) => {
        rl.question(chalk.green('\nmysql-agent> '), (answer) => {
          resolve(answer);
        });
      });
    };

    console.log(chalk.gray('\nType your questions in natural language. Press Ctrl+C to exit.\n'));

    // Show recent connections
    const recent = connectionManager.getRecent();
    if (recent.length > 0) {
      console.log(chalk.gray(`Recent: ${recent.slice(0, 3).join(', ')}`));
    }

    // Show favorites
    const favorites = connectionManager.getFavorites();
    if (favorites.length > 0) {
      console.log(chalk.gray(`Favorites: ${favorites.join(', ')}`));
    }

    while (true) {
      try {
        const input = await askQuestion();
        if (!input.trim()) continue;

        if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
          console.log(chalk.blue('Goodbye!'));
          break;
        }

        if (input.toLowerCase() === 'connections' || input.toLowerCase() === 'conn') {
          listConnections();
          continue;
        }

        if (input.toLowerCase().startsWith('use ')) {
          const alias = input.slice(4).trim();
          await switchConnection(alias);
          continue;
        }

        // Process query
        const spinner = ora({
          text: 'Processing...',
          spinner: 'dots',
        }).start();

        const response = await processInput(input);
        spinner.stop();

        if (response.connection) {
          console.log(chalk.gray(`[Using: ${response.connection}]`));
        }

        console.log(chalk.white(response.message));

      } catch (error) {
        console.log(chalk.red(`\nError: ${error instanceof Error ? error.message : String(error)}`));
      }
    }

    rl.close();
  };

  await repl();
});

// Config commands
cli.command('config', 'Manage connections');
cli.command('config list', 'List all configured connections').action(() => {
  listConnections();
});

cli.command('config add', 'Add a new connection').action(async () => {
  const questions = [
    {
      type: 'input',
      name: 'alias',
      message: 'Connection alias (e.g., prod-orders):',
      validate: (v: string) => v.trim().length > 0 || 'Alias is required',
    },
    {
      type: 'input',
      name: 'host',
      message: 'MySQL host:',
      default: 'localhost',
    },
    {
      type: 'number',
      name: 'port',
      message: 'MySQL port:',
      default: 3306,
    },
    {
      type: 'input',
      name: 'user',
      message: 'Username:',
      default: 'root',
    },
    {
      type: 'password',
      name: 'password',
      message: 'Password (or env:VAR_NAME for environment variable):',
    },
    {
      type: 'input',
      name: 'database',
      message: 'Default database (optional):',
    },
    {
      type: 'input',
      name: 'description',
      message: 'Description (for AI context):',
    },
    {
      type: 'input',
      name: 'tags',
      message: 'Tags (comma-separated, e.g., production,orders):',
    },
    {
      type: 'confirm',
      name: 'readOnly',
      message: 'Read-only connection?',
      default: false,
    },
  ];

  const answers = await inquirer.prompt(questions);

  const config = {
    host: answers.host,
    port: answers.port,
    user: answers.user,
    password: answers.password,
    database: answers.database || undefined,
    description: answers.description || undefined,
    tags: answers.tags ? answers.tags.split(',').map((t: string) => t.trim()) : undefined,
    readOnly: answers.readOnly,
  };

  connectionManager.setConnection(answers.alias, config);

  console.log(chalk.green(`\nConnection "${answers.alias}" added successfully!`));
  console.log(chalk.gray(`Config saved to: ${connectionManager.getConfigPath()}`));
});

cli.command('config remove <alias>', 'Remove a connection').action(async (alias: string) => {
  const removed = connectionManager.removeConnection(alias);
  if (removed) {
    console.log(chalk.green(`Connection "${alias}" removed.`));
  } else {
    console.log(chalk.red(`Connection "${alias}" not found.`));
  }
});

// MCP server command
cli.command('mcp', 'Start MCP server mode').action(() => {
  console.log(chalk.blue('Starting MCP server...'));
  console.log(chalk.gray('Use "npx mysql-agent-mcp" to start the MCP server.'));
});

// Help
cli.command('help', 'Show help').action(() => {
  cli.outputHelp();
});

// Parse arguments
cli.parse();

// Helper functions
function listConnections() {
  const connections = connectionManager.getConnections();
  const recent = connectionManager.getRecent();
  const favorites = connectionManager.getFavorites();

  if (Object.keys(connections).length === 0) {
    console.log(chalk.yellow('No connections configured.'));
    return;
  }

  console.log(chalk.blue('\nConfigured connections:\n'));

  for (const [alias, config] of Object.entries(connections)) {
    const isRecent = recent.includes(alias);
    const isFavorite = favorites.includes(alias);
    const badges = [
      isRecent ? chalk.green('[recent]') : '',
      isFavorite ? chalk.yellow('[favorite]') : '',
      config.readOnly ? chalk.cyan('[readonly]') : '',
    ].filter(Boolean);

    console.log(`  ${chalk.bold(alias)} ${badges.join(' ')}`);
    console.log(`    ${chalk.gray(`${config.host}:${config.port}/${config.database || '*'}`)}`);
    if (config.description) {
      console.log(`    ${chalk.gray(config.description)}`);
    }
    if (config.tags?.length) {
      console.log(`    Tags: ${config.tags.map((t: string) => chalk.gray(t)).join(', ')}`);
    }
    console.log();
  }
}

async function switchConnection(alias: string) {
  const config = connectionManager.resolveConnection(alias);
  if (!config) {
    console.log(chalk.red(`Connection "${alias}" not found.`));
    return;
  }

  try {
    if (currentPool) {
      await currentPool.end();
    }

    currentPool = mysql.createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.resolvedPassword,
      database: config.database,
    });

    // Test connection
    const conn = await currentPool.getConnection();
    conn.release();

    connectionManager.addToRecent(alias);
    console.log(chalk.green(`Switched to "${alias}" (${config.host}:${config.port}/${config.database || '*'})`));
  } catch (error) {
    console.log(chalk.red(`Failed to connect: ${error instanceof Error ? error.message : String(error)}`));
  }
}
