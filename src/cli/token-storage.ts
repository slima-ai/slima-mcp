/**
 * Token Storage Utility (CLI)
 *
 * Stores API Token in user's home directory
 * ~/.slima/credentials.json
 */

import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SLIMA_DIR = '.slima';
const CREDENTIALS_FILE = 'credentials.json';

interface Credentials {
  apiToken: string;
  createdAt: string;
  baseUrl?: string;
}

function getCredentialsPath(): string {
  return join(homedir(), SLIMA_DIR, CREDENTIALS_FILE);
}

function getSlimaDir(): string {
  return join(homedir(), SLIMA_DIR);
}

/**
 * Save API Token
 */
export async function saveToken(apiToken: string, baseUrl?: string): Promise<void> {
  const slimaDir = getSlimaDir();

  // Ensure directory exists
  await fs.mkdir(slimaDir, { recursive: true });

  const credentials: Credentials = {
    apiToken,
    createdAt: new Date().toISOString(),
    ...(baseUrl && { baseUrl }),
  };

  const credentialsPath = getCredentialsPath();
  await fs.writeFile(credentialsPath, JSON.stringify(credentials, null, 2), 'utf-8');

  // Set file permission to 600 (owner only)
  await fs.chmod(credentialsPath, 0o600);
}

/**
 * Load API Token
 */
export async function loadToken(): Promise<Credentials | null> {
  try {
    const credentialsPath = getCredentialsPath();
    const content = await fs.readFile(credentialsPath, 'utf-8');
    return JSON.parse(content) as Credentials;
  } catch {
    return null;
  }
}

/**
 * Delete API Token
 */
export async function deleteToken(): Promise<void> {
  try {
    const credentialsPath = getCredentialsPath();
    await fs.unlink(credentialsPath);
  } catch {
    // File doesn't exist, ignore
  }
}

/**
 * Check if authenticated
 */
export async function isAuthenticated(): Promise<boolean> {
  const credentials = await loadToken();
  return credentials !== null && !!credentials.apiToken;
}

/**
 * Get credentials file path (for display)
 */
export function getCredentialsFilePath(): string {
  return getCredentialsPath();
}
