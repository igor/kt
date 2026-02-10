import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, closeDatabase, getDatabase } from '../../src/db/connection.js';
import { insertEmbedding, searchSimilar } from '../../src/db/vec.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('sqlite-vec integration', () => {
  const testDir = path.join(os.tmpdir(), 'kt-test-vec-' + Date.now());
  const testDb = path.join(testDir, 'kt.db');

  beforeEach(() => {
    createDatabase(testDb);
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('inserts and retrieves a vector', () => {
    // Create a fake 768-dim embedding
    const embedding = new Float32Array(768);
    embedding[0] = 1.0;
    embedding[1] = 0.5;

    insertEmbedding('kt-test1', embedding);

    // Verify it was stored
    const db = getDatabase();
    const row = db.prepare('SELECT COUNT(*) as c FROM node_embeddings').get() as { c: number };
    expect(row.c).toBe(1);
  });

  it('finds similar vectors by cosine distance', () => {
    // Insert three embeddings with known similarity patterns
    const embA = new Float32Array(768).fill(0);
    embA[0] = 1.0; embA[1] = 0.0;

    const embB = new Float32Array(768).fill(0);
    embB[0] = 0.9; embB[1] = 0.1;

    const embC = new Float32Array(768).fill(0);
    embC[0] = 0.0; embC[1] = 1.0;

    insertEmbedding('kt-close', embA);
    insertEmbedding('kt-similar', embB);
    insertEmbedding('kt-different', embC);

    // Search for vectors similar to embA
    const query = new Float32Array(768).fill(0);
    query[0] = 1.0; query[1] = 0.0;

    const results = searchSimilar(query, 3);
    expect(results.length).toBeGreaterThanOrEqual(2);
    // The closest should be kt-close (exact match)
    expect(results[0].node_id).toBe('kt-close');
  });

  it('respects limit parameter', () => {
    for (let i = 0; i < 10; i++) {
      const emb = new Float32Array(768).fill(0);
      emb[0] = Math.random();
      insertEmbedding(`kt-n${i}`, emb);
    }

    const query = new Float32Array(768).fill(0);
    query[0] = 0.5;

    const results = searchSimilar(query, 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });
});
