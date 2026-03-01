import { describe, it, expect } from 'vitest';
import { namespaceFilter } from '../../src/core/namespace-filter.js';

describe('namespaceFilter', () => {
  it('returns SQL that matches exact namespace and dot-children', () => {
    const filter = namespaceFilter('clients');
    expect(filter.sql).toBe('(namespace = ? OR namespace LIKE ?)');
    expect(filter.params).toEqual(['clients', 'clients.%']);
  });

  it('handles dotted namespace', () => {
    const filter = namespaceFilter('clients.acme');
    expect(filter.params).toEqual(['clients.acme', 'clients.acme.%']);
  });

  it('returns null filter when namespace is undefined', () => {
    const filter = namespaceFilter(undefined);
    expect(filter).toBeNull();
  });
});
