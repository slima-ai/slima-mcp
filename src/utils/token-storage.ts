/**
 * Token Storage Utility
 *
 * 將 API Token 儲存在使用者的 home 目錄下
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
 * 儲存 API Token
 */
export async function saveToken(apiToken: string, baseUrl?: string): Promise<void> {
  const slimaDir = getSlimaDir();

  // 確保目錄存在
  await fs.mkdir(slimaDir, { recursive: true });

  const credentials: Credentials = {
    apiToken,
    createdAt: new Date().toISOString(),
    ...(baseUrl && { baseUrl }),
  };

  const credentialsPath = getCredentialsPath();
  await fs.writeFile(credentialsPath, JSON.stringify(credentials, null, 2), 'utf-8');

  // 設定檔案權限為 600（僅擁有者可讀寫）
  await fs.chmod(credentialsPath, 0o600);
}

/**
 * 讀取 API Token
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
 * 刪除 API Token
 */
export async function deleteToken(): Promise<void> {
  try {
    const credentialsPath = getCredentialsPath();
    await fs.unlink(credentialsPath);
  } catch {
    // 檔案不存在，忽略
  }
}

/**
 * 檢查是否已認證
 */
export async function isAuthenticated(): Promise<boolean> {
  const credentials = await loadToken();
  return credentials !== null && !!credentials.apiToken;
}

/**
 * 取得 credentials 檔案路徑（供顯示用）
 */
export function getCredentialsFilePath(): string {
  return getCredentialsPath();
}
