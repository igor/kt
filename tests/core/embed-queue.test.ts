import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, closeDatabase, getDatabase } from '../../src/db/connection.js';
import { createNode } from '../../src/core/nodes.js';
import { getPendingEmbeddings, markEmbeddingDone } from '../../src/core/nodes.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('embedding queue', () => {
  const testDir = path.join(os.tmpdir(), 'kt-test-embed-' + Date.now());
  const testDb = path.join(testDir, 'kt.db');

  beforeEach(() => createDatabase(testDb));
  afterEach(() => { closeDatabase(); fs.rmSync(testDir, { recursive: true, force: true }); });

  it('new nodes start with embedding_pending = true', () => {
    const node = createNode({ namespace: 'test', content: 'needs embedding' });
    expect(node.embedding_pending).toBe(true);
  });

  it('getPendingEmbeddings returns nodes awaiting embeddings', () => {
    createNode({ namespace: 'test', content: 'pending 1' });
    createNode({ namespace: 'test', content: 'pending 2' });

    const pending = getPendingEmbeddings();
    expect(pending).toHaveLength(2);
  });

  it('markEmbeddingDone clears the pending flag', () => {
    const node = createNode({ namespace: 'test', content: 'will be embedded' });
    markEmbeddingDone(node.id);

    const pending = getPendingEmbeddings();
    expect(pending).toHaveLength(0);
  });
});
