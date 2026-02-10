import { describe, it, expect, vi } from 'vitest';
import { generateEmbedding, isOllamaAvailable } from '../../src/core/embeddings.js';

describe('embeddings', () => {
  describe('isOllamaAvailable', () => {
    it('returns false when Ollama is not running', async () => {
      // Use a port that's almost certainly not running Ollama
      const result = await isOllamaAvailable('http://127.0.0.1:99999');
      expect(result).toBe(false);
    });
  });

  describe('generateEmbedding', () => {
    it('returns null when Ollama is unavailable', async () => {
      const result = await generateEmbedding('test text', 'http://127.0.0.1:99999');
      expect(result).toBeNull();
    });

    // This test only runs if Ollama is actually running locally
    // Skip in CI, run manually to verify integration
    it.skipIf(!process.env.TEST_OLLAMA)('generates a 768-dim embedding when Ollama is running', async () => {
      const result = await generateEmbedding('test text');
      expect(result).not.toBeNull();
      expect(result!.length).toBe(768);
      expect(result).toBeInstanceOf(Float32Array);
    });
  });
});
