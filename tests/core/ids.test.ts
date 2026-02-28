import { describe, it, expect } from 'vitest';
import { generateId } from '../../src/core/ids.js';

describe('generateId', () => {
  it('returns a string starting with kt-', () => {
    const id = generateId('test content');
    expect(id).toMatch(/^kt-[a-f0-9]{8}$/);
  });

  it('generates different IDs for same content (timestamp-based)', () => {
    const id1 = generateId('same content');
    const id2 = generateId('same content');
    expect(id1).not.toBe(id2);
  });
});
