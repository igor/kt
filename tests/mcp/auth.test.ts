import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadAuthConfig, validateToken, createToken, revokeToken } from '../../src/mcp/auth.js';

const testDir = path.join(os.tmpdir(), 'kt-test-auth-' + Date.now());
const authPath = path.join(testDir, 'auth.json');

beforeEach(() => {
  fs.mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe('auth', () => {
  describe('loadAuthConfig', () => {
    it('returns empty tokens when file does not exist', () => {
      const config = loadAuthConfig(path.join(testDir, 'nonexistent.json'));
      expect(config.tokens).toEqual({});
    });

    it('loads existing config', () => {
      fs.writeFileSync(authPath, JSON.stringify({
        tokens: { 'tok_abc': { user: 'alice', created: '2026-01-01' } }
      }));
      const config = loadAuthConfig(authPath);
      expect(config.tokens['tok_abc'].user).toBe('alice');
    });
  });

  describe('validateToken', () => {
    it('returns user info for valid token', () => {
      fs.writeFileSync(authPath, JSON.stringify({
        tokens: { 'tok_abc': { user: 'alice', created: '2026-01-01' } }
      }));
      const result = validateToken('tok_abc', authPath);
      expect(result).toEqual({ user: 'alice', created: '2026-01-01' });
    });

    it('returns null for invalid token', () => {
      fs.writeFileSync(authPath, JSON.stringify({ tokens: {} }));
      const result = validateToken('tok_invalid', authPath);
      expect(result).toBeNull();
    });

    it('returns null when auth file missing', () => {
      const result = validateToken('tok_abc', path.join(testDir, 'missing.json'));
      expect(result).toBeNull();
    });
  });

  describe('createToken', () => {
    it('creates a new token and writes to file', () => {
      const token = createToken('bob', authPath);
      expect(token).toMatch(/^tok_/);
      const config = loadAuthConfig(authPath);
      expect(config.tokens[token].user).toBe('bob');
    });

    it('preserves existing tokens when adding new one', () => {
      fs.writeFileSync(authPath, JSON.stringify({
        tokens: { 'tok_existing': { user: 'alice', created: '2026-01-01' } }
      }));
      createToken('bob', authPath);
      const config = loadAuthConfig(authPath);
      expect(config.tokens['tok_existing']).toBeDefined();
      expect(Object.keys(config.tokens)).toHaveLength(2);
    });
  });

  describe('revokeToken', () => {
    it('removes a token', () => {
      fs.writeFileSync(authPath, JSON.stringify({
        tokens: { 'tok_abc': { user: 'alice', created: '2026-01-01' } }
      }));
      const result = revokeToken('tok_abc', authPath);
      expect(result).toBe(true);
      const config = loadAuthConfig(authPath);
      expect(config.tokens['tok_abc']).toBeUndefined();
    });

    it('returns false for nonexistent token', () => {
      fs.writeFileSync(authPath, JSON.stringify({ tokens: {} }));
      const result = revokeToken('tok_nope', authPath);
      expect(result).toBe(false);
    });
  });
});
