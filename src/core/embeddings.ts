import { Ollama } from 'ollama';

const DEFAULT_HOST = 'http://127.0.0.1:11434';
const MODEL = 'nomic-embed-text';

export async function isOllamaAvailable(host?: string): Promise<boolean> {
  try {
    const response = await fetch(`${host || DEFAULT_HOST}/api/tags`);
    return response.ok;
  } catch {
    return false;
  }
}

export async function generateEmbedding(
  text: string,
  host?: string,
): Promise<Float32Array | null> {
  const ollamaHost = host || DEFAULT_HOST;

  if (!(await isOllamaAvailable(ollamaHost))) {
    return null;
  }

  try {
    const ollama = new Ollama({ host: ollamaHost });
    const response = await ollama.embed({
      model: MODEL,
      input: text,
    });

    const raw = response.embeddings[0];
    return new Float32Array(raw);
  } catch {
    return null;
  }
}

export function serializeEmbedding(embedding: Float32Array): Buffer {
  return Buffer.from(embedding.buffer);
}

export function deserializeEmbedding(buffer: Buffer): Float32Array {
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  );
  return new Float32Array(arrayBuffer);
}
