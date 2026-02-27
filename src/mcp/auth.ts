import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface TokenInfo {
  user: string;
  created: string;
}

export interface AuthConfig {
  tokens: Record<string, TokenInfo>;
}

export function getDefaultAuthPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '~';
  return path.join(home, '.kt', 'auth.json');
}

export function loadAuthConfig(authPath: string): AuthConfig {
  try {
    const data = fs.readFileSync(authPath, 'utf-8');
    return JSON.parse(data) as AuthConfig;
  } catch {
    return { tokens: {} };
  }
}

function saveAuthConfig(config: AuthConfig, authPath: string): void {
  const dir = path.dirname(authPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(authPath, JSON.stringify(config, null, 2));
}

export function validateToken(token: string, authPath: string): TokenInfo | null {
  const config = loadAuthConfig(authPath);
  return config.tokens[token] ?? null;
}

export function createToken(user: string, authPath: string): string {
  const config = loadAuthConfig(authPath);
  const token = 'tok_' + crypto.randomBytes(24).toString('hex');
  config.tokens[token] = {
    user,
    created: new Date().toISOString().split('T')[0],
  };
  saveAuthConfig(config, authPath);
  return token;
}

export function revokeToken(token: string, authPath: string): boolean {
  const config = loadAuthConfig(authPath);
  if (!config.tokens[token]) return false;
  delete config.tokens[token];
  saveAuthConfig(config, authPath);
  return true;
}
