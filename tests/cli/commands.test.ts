import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Integration tests run the actual CLI binary
describe('CLI integration', () => {
  const testDir = path.join(os.tmpdir(), 'kt-cli-test-' + Date.now());
  const env = { ...process.env, KT_DB_PATH: path.join(testDir, 'kt.db') };

  function kt(args: string): string {
    return execSync(`npx tsx src/index.ts ${args}`, { env, encoding: 'utf-8' }).trim();
  }

  beforeEach(() => fs.mkdirSync(testDir, { recursive: true }));
  afterEach(() => fs.rmSync(testDir, { recursive: true, force: true }));

  it('capture creates a node and prints its ID', () => {
    const output = kt('capture "Test knowledge" --namespace test');
    expect(output).toMatch(/kt-[a-f0-9]{6}/);
  });

  it('show retrieves a captured node', () => {
    const id = kt('capture "Show me this" --namespace test').match(/kt-[a-f0-9]{6}/)![0];
    const output = kt(`show ${id} --format json`);
    const node = JSON.parse(output);
    expect(node.content).toBe('Show me this');
  });

  it('search finds nodes by keyword', () => {
    kt('capture "Quarterly planning preference" --namespace test');
    kt('capture "Sprint format rejected" --namespace test');
    const output = kt('search quarterly --format json');
    const results = JSON.parse(output);
    expect(results).toHaveLength(1);
  });

  it('ns create and list', () => {
    kt('ns create clients --name "Client Knowledge"');
    const output = kt('ns list --format json');
    const namespaces = JSON.parse(output);
    expect(namespaces.some((ns: any) => ns.slug === 'clients')).toBe(true);
  });

  it('link creates a relationship', () => {
    const id1 = kt('capture "Old insight" --namespace test').match(/kt-[a-f0-9]{6}/)![0];
    const id2 = kt('capture "New insight" --namespace test').match(/kt-[a-f0-9]{6}/)![0];
    kt(`link ${id2} supersedes ${id1}`);

    const output = kt(`show ${id1} --format json`);
    const node = JSON.parse(output);
    expect(node.status).toBe('stale');
  });

  it('stale lists stale nodes', () => {
    const id = kt('capture "Will go stale" --namespace test').match(/kt-[a-f0-9]{6}/)![0];
    kt(`status ${id} stale`);
    const output = kt('stale --format json');
    const nodes = JSON.parse(output);
    expect(nodes).toHaveLength(1);
  });

  it('stats shows counts', () => {
    kt('capture "Node 1" --namespace a');
    kt('capture "Node 2" --namespace a');
    kt('capture "Node 3" --namespace b');
    const output = kt('stats --format json');
    const stats = JSON.parse(output);
    expect(stats.total).toBe(3);
  });

  it('context returns structured brief', () => {
    kt('ns create test --name "Test"');
    kt('capture "Important knowledge" --namespace test');
    const output = kt('context --namespace test --format json');
    const ctx = JSON.parse(output);
    expect(ctx.namespace).toBe('test');
    expect(ctx.active_nodes.length).toBeGreaterThan(0);
  });

  it('bare kt with no mapped namespace shows helpful message', () => {
    const output = kt('');
    expect(output).toContain('No namespace mapped');
  });

  it('context includes node_count and link_count per node', () => {
    kt('ns create ctx --name "Context Test"');
    const id1 = kt('capture "First knowledge" --namespace ctx --title "First"').match(/kt-[a-f0-9]{6}/)![0];
    const id2 = kt('capture "Second knowledge" --namespace ctx --title "Second"').match(/kt-[a-f0-9]{6}/)![0];
    kt(`link ${id1} related ${id2}`);

    const output = kt('context --namespace ctx --format json');
    const ctx = JSON.parse(output);

    expect(ctx.total_nodes).toBe(2);
    expect(ctx.active_nodes[0]).toHaveProperty('links_out');
  });
});
