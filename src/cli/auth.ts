/**
 * CLI Auth Command
 *
 * 實作類似 Claude Code / GitHub CLI 的認證流程：
 * 1. 使用者執行 `slima-mcp auth`
 * 2. 開啟瀏覽器到 Slima 認證頁面
 * 3. 使用者登入並授權
 * 4. 本地伺服器接收 callback 並儲存 token
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { saveToken, loadToken, deleteToken, getCredentialsFilePath } from './token-storage.js';

// 認證使用 API 伺服器（處理 OAuth 和 session）
const DEFAULT_API_URL = 'https://api.slima.ai';
const CALLBACK_PORT_START = 8765;
const CALLBACK_PORT_END = 8775;

/**
 * 開啟瀏覽器
 */
async function openBrowser(url: string): Promise<void> {
  const { exec } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execAsync = promisify(exec);

  const platform = process.platform;

  try {
    if (platform === 'darwin') {
      await execAsync(`open "${url}"`);
    } else if (platform === 'win32') {
      await execAsync(`start "" "${url}"`);
    } else {
      // Linux / WSL
      // 嘗試多個可能的命令
      const commands = ['xdg-open', 'sensible-browser', 'wslview'];
      for (const cmd of commands) {
        try {
          await execAsync(`${cmd} "${url}"`);
          return;
        } catch {
          // 繼續嘗試下一個
        }
      }
      // 如果都失敗，顯示 URL 讓使用者手動開啟
      console.log(`\nPlease open this URL in your browser:\n${url}\n`);
    }
  } catch {
    console.log(`\nPlease open this URL in your browser:\n${url}\n`);
  }
}

/**
 * 尋找可用的 port
 */
async function findAvailablePort(): Promise<number> {
  for (let port = CALLBACK_PORT_START; port <= CALLBACK_PORT_END; port++) {
    const available = await isPortAvailable(port);
    if (available) {
      return port;
    }
  }
  throw new Error(`No available ports between ${CALLBACK_PORT_START} and ${CALLBACK_PORT_END}`);
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

/**
 * 產生隨機 state（防止 CSRF）
 */
function generateState(): string {
  return randomBytes(16).toString('hex');
}

/**
 * 成功頁面 HTML
 * Design follows UIUX_SPEC.md: minimalist, grayscale, Inter font
 */
function getSuccessHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Welcome to Slima</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      background: #FBFBFA;
      color: #1D1D1F;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    .container {
      text-align: center;
      padding: 48px;
      max-width: 420px;
    }
    .logo {
      width: 48px;
      height: 48px;
      margin-bottom: 32px;
      opacity: 0.9;
    }
    .success-icon {
      width: 64px;
      height: 64px;
      margin-bottom: 24px;
      border-radius: 50%;
      background: #1D1D1F;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-left: auto;
      margin-right: auto;
    }
    .success-icon svg {
      width: 32px;
      height: 32px;
      stroke: #FBFBFA;
    }
    h1 {
      font-size: 24px;
      font-weight: 600;
      letter-spacing: -0.02em;
      margin-bottom: 12px;
      color: #1D1D1F;
    }
    .subtitle {
      font-size: 15px;
      color: #6E6E73;
      line-height: 1.5;
      margin-bottom: 8px;
    }
    .hint {
      font-size: 13px;
      color: #86868B;
      margin-top: 24px;
    }
    .divider {
      width: 40px;
      height: 1px;
      background: #E5E5E5;
      margin: 32px auto;
    }
    .footer {
      font-size: 12px;
      color: #86868B;
    }
  </style>
</head>
<body>
  <div class="container">
    <img src="https://app.slima.ai/icons/slima-black.svg" alt="Slima" class="logo">
    <div class="success-icon">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
      </svg>
    </div>
    <h1>Welcome to Slima</h1>
    <p class="subtitle">Authentication successful. Your CLI is now connected.</p>
    <p class="hint">You can close this window and return to your terminal.</p>
    <div class="divider"></div>
    <p class="footer">Slima MCP is ready to use</p>
  </div>
</body>
</html>`;
}

/**
 * 錯誤頁面 HTML
 */
/**
 * HTML escape to prevent XSS
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (char) => map[char]);
}

/**
 * 錯誤頁面 HTML
 * Design follows UIUX_SPEC.md: minimalist, grayscale, Inter font
 */
function getErrorHtml(message: string): string {
  const safeMessage = escapeHtml(message);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Slima - Authentication Error</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      background: #FBFBFA;
      color: #1D1D1F;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    .container {
      text-align: center;
      padding: 48px;
      max-width: 420px;
    }
    .logo {
      width: 48px;
      height: 48px;
      margin-bottom: 32px;
      opacity: 0.9;
    }
    .error-icon {
      width: 64px;
      height: 64px;
      margin-bottom: 24px;
      border-radius: 50%;
      background: #1D1D1F;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-left: auto;
      margin-right: auto;
    }
    .error-icon svg {
      width: 32px;
      height: 32px;
      stroke: #FBFBFA;
    }
    h1 {
      font-size: 24px;
      font-weight: 600;
      letter-spacing: -0.02em;
      margin-bottom: 12px;
      color: #1D1D1F;
    }
    .message {
      font-size: 15px;
      color: #6E6E73;
      line-height: 1.5;
      margin-bottom: 8px;
    }
    .hint {
      font-size: 13px;
      color: #86868B;
      margin-top: 24px;
    }
    .divider {
      width: 40px;
      height: 1px;
      background: #E5E5E5;
      margin: 32px auto;
    }
    .retry-link {
      display: inline-block;
      font-size: 14px;
      font-weight: 500;
      color: #1D1D1F;
      text-decoration: none;
      padding: 10px 20px;
      border: 1px solid #E5E5E5;
      border-radius: 8px;
      transition: all 0.2s ease;
    }
    .retry-link:hover {
      background: #F5F5F5;
      border-color: #D5D5D5;
    }
  </style>
</head>
<body>
  <div class="container">
    <img src="https://app.slima.ai/icons/slima-black.svg" alt="Slima" class="logo">
    <div class="error-icon">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </div>
    <h1>Something went wrong</h1>
    <p class="message">${safeMessage}</p>
    <p class="hint">Please close this window and try again from your terminal.</p>
    <div class="divider"></div>
    <a href="javascript:window.close()" class="retry-link">Close Window</a>
  </div>
</body>
</html>`;
}

/**
 * 執行認證流程
 */
export async function runAuth(options: { baseUrl?: string } = {}): Promise<void> {
  const baseUrl = options.baseUrl || process.env.SLIMA_API_URL || DEFAULT_API_URL;

  console.log('\n🔐 Slima MCP Authentication\n');

  // 檢查是否已經認證
  const existingCredentials = await loadToken();
  if (existingCredentials) {
    console.log('You are already authenticated.');
    console.log(`Token stored at: ${getCredentialsFilePath()}`);
    console.log('\nTo re-authenticate, first run: slima-mcp logout\n');
    return;
  }

  const state = generateState();
  const port = await findAvailablePort();

  console.log('Starting local server for authentication callback...');

  // 建立本地伺服器接收 callback
  const tokenPromise = new Promise<string>((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url || '/', `http://localhost:${port}`);

      if (url.pathname === '/callback') {
        const token = url.searchParams.get('token');
        const returnedState = url.searchParams.get('state');
        const error = url.searchParams.get('error');

        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(getErrorHtml(error));
          server.close();
          reject(new Error(error));
          return;
        }

        if (returnedState !== state) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(getErrorHtml('Invalid state parameter. Please try again.'));
          server.close();
          reject(new Error('State mismatch'));
          return;
        }

        if (!token) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(getErrorHtml('No token received. Please try again.'));
          server.close();
          reject(new Error('No token received'));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(getSuccessHtml());
        server.close();
        resolve(token);
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    server.listen(port, '127.0.0.1', () => {
      console.log(`Listening on http://127.0.0.1:${port}`);
    });

    // 30 秒超時
    setTimeout(() => {
      server.close();
      reject(new Error('Authentication timed out. Please try again.'));
    }, 30000);
  });

  // 建立認證 URL（使用 API endpoint）
  const authUrl = `${baseUrl}/api/v1/auth/cli?state=${state}&callback_port=${port}`;

  console.log('\nOpening browser for authentication...');
  await openBrowser(authUrl);

  console.log('\nWaiting for authentication...');
  console.log('(Press Ctrl+C to cancel)\n');

  try {
    const token = await tokenPromise;
    await saveToken(token, baseUrl !== DEFAULT_API_URL ? baseUrl : undefined);

    console.log('\n✅ Authentication successful!');
    console.log(`Token saved to: ${getCredentialsFilePath()}`);
    console.log('\nYou can now use Slima MCP with any MCP-compatible AI tool.\n');
  } catch (error) {
    console.error('\n❌ Authentication failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

/**
 * 登出（刪除 token）
 */
export async function runLogout(): Promise<void> {
  console.log('\n🔓 Slima MCP Logout\n');

  const credentials = await loadToken();
  if (!credentials) {
    console.log('You are not authenticated.\n');
    return;
  }

  await deleteToken();
  console.log('✅ Successfully logged out.');
  console.log(`Removed credentials from: ${getCredentialsFilePath()}\n`);
}

/**
 * 顯示目前狀態
 */
export async function runStatus(): Promise<void> {
  console.log('\n📊 Slima MCP Status\n');

  const credentials = await loadToken();
  if (!credentials) {
    console.log('Status: Not authenticated');
    console.log('\nRun `slima-mcp auth` to authenticate.\n');
    return;
  }

  console.log('Status: Authenticated');
  console.log(`Token: ${credentials.apiToken.substring(0, 15)}...`);
  console.log(`Authenticated at: ${credentials.createdAt}`);
  if (credentials.baseUrl) {
    console.log(`API URL: ${credentials.baseUrl}`);
  }
  console.log(`Credentials file: ${getCredentialsFilePath()}\n`);
}
