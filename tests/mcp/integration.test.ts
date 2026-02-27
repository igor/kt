import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';

const testDir = path.join(os.tmpdir(), 'kt-test-mcp-integration-' + Date.now());

beforeEach(() => {
  fs.mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe('kt auth CLI', () => {
  const authPath = () => path.join(testDir, 'auth.json');
  const kt = (args: string) =>
    execSync(`npx tsx src/index.ts ${args}`, {
      env: { ...process.env, KT_DB_PATH: path.join(testDir, 'kt.db') },
      encoding: 'utf-8',
    }).trim();

  it('create-token and list-tokens round trip', () => {
    const output = kt(`auth create-token testuser --auth-path ${authPath()}`);
    expect(output).toContain('tok_');

    const list = kt(`auth list-tokens --auth-path ${authPath()}`);
    expect(list).toContain('testuser');
  });

  it('revoke-token removes the token', () => {
    const output = kt(`auth create-token revokeuser --auth-path ${authPath()}`);
    const token = output.split('\n').pop()!.trim();

    kt(`auth revoke-token ${token} --auth-path ${authPath()}`);
    const list = kt(`auth list-tokens --auth-path ${authPath()}`);
    expect(list).not.toContain('revokeuser');
  });
});
