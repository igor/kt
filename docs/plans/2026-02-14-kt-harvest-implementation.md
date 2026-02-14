# kt-harvest Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an automated pipeline that extracts knowledge from Claude Code sessions using ccvault, a local Ollama model, and kt capture.

**Architecture:** Standalone Node.js/TypeScript project at `~/GitHub/kt-harvest/`. Calls ccvault CLI for session indexing/export, Ollama JS client for LLM extraction, and kt CLI for node capture. State tracked in `~/.kt-harvest/state.json`. Capture protocol lives in `protocol.md` at project root.

**Tech Stack:** TypeScript, Node.js 20+, Ollama JS client (`ollama` npm package), vitest for tests. CLI via commander. No database — JSON state file.

**Prerequisites:**
- ccvault installed (`brew install 2389-research/tap/ccvault`)
- kt installed (`npm install -g` from ~/GitHub/kt)
- Ollama running on Mac Mini with extraction model pulled to `/Volumes/Storage/`
- Mac Mini environment (this runs on Mac Mini, not MacBook Air)

**Ollama model storage:** Models must be downloaded to external drive. Set `OLLAMA_MODELS=/Volumes/Storage/ollama/models` before pulling new models. Verify with `ollama list`.

---

### Task 1: Project Scaffolding

**Files:**
- Create: `~/GitHub/kt-harvest/package.json`
- Create: `~/GitHub/kt-harvest/tsconfig.json`
- Create: `~/GitHub/kt-harvest/.gitignore`
- Create: `~/GitHub/kt-harvest/src/index.ts`

**Step 1: Initialize git repo and project**

```bash
mkdir -p ~/GitHub/kt-harvest
cd ~/GitHub/kt-harvest
git init
```

**Step 2: Create package.json**

```json
{
  "name": "kt-harvest",
  "version": "0.1.0",
  "description": "Automated knowledge extraction from Claude Code sessions",
  "type": "module",
  "bin": {
    "kt-harvest": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "engines": {
    "node": ">=20"
  },
  "dependencies": {
    "commander": "^14.0.3",
    "ollama": "^0.6.3"
  },
  "devDependencies": {
    "@types/node": "^25.2.3",
    "tsx": "^4.21.0",
    "typescript": "^5.9.3",
    "vitest": "^4.0.18"
  }
}
```

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

**Step 4: Create .gitignore**

```
node_modules/
dist/
*.tsbuildinfo
```

**Step 5: Create minimal entry point**

```typescript
// src/index.ts
#!/usr/bin/env node
console.log('kt-harvest v0.1.0');
```

**Step 6: Install dependencies and verify build**

```bash
cd ~/GitHub/kt-harvest
npm install
npx tsc --noEmit
```

Expected: No errors.

**Step 7: Commit**

```bash
git add -A
git commit -m "feat: initial project scaffolding"
```

---

### Task 2: State Tracking Module

**Files:**
- Create: `src/state.ts`
- Create: `tests/state.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/state.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { State } from '../src/state.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('State', () => {
  let tempDir: string;
  let state: State;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'kt-harvest-test-'));
    state = new State(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true });
  });

  it('creates state file if it does not exist', () => {
    state.load();
    expect(state.getProcessedCount()).toBe(0);
  });

  it('marks a session as processed', () => {
    state.load();
    state.markProcessed('session-123', 3, 'qwen3:30b-q4');
    state.save();

    const fresh = new State(tempDir);
    fresh.load();
    expect(fresh.isProcessed('session-123')).toBe(true);
    expect(fresh.getProcessedCount()).toBe(1);
  });

  it('reports unprocessed sessions', () => {
    state.load();
    state.markProcessed('session-1', 2, 'qwen3:30b-q4');

    const allSessions = ['session-1', 'session-2', 'session-3'];
    const unprocessed = allSessions.filter(id => !state.isProcessed(id));
    expect(unprocessed).toEqual(['session-2', 'session-3']);
  });

  it('clears processed list for reprocessing', () => {
    state.load();
    state.markProcessed('session-1', 1, 'qwen3:30b-q4');
    state.clear();
    expect(state.isProcessed('session-1')).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd ~/GitHub/kt-harvest && npx vitest run tests/state.test.ts`
Expected: FAIL — module `../src/state.js` not found

**Step 3: Write implementation**

```typescript
// src/state.ts
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

interface ProcessedSession {
  processed_at: string;
  nodes_captured: number;
  model: string;
}

interface StateData {
  last_run: string | null;
  protocol_version: string;
  model: string;
  processed_sessions: Record<string, ProcessedSession>;
}

export class State {
  private filePath: string;
  private data: StateData;

  constructor(dir: string) {
    this.filePath = join(dir, 'state.json');
    this.data = {
      last_run: null,
      protocol_version: '1.0',
      model: '',
      processed_sessions: {},
    };
  }

  load(): void {
    if (existsSync(this.filePath)) {
      const raw = readFileSync(this.filePath, 'utf-8');
      this.data = JSON.parse(raw);
    }
  }

  save(): void {
    const dir = this.filePath.replace(/\/[^/]+$/, '');
    mkdirSync(dir, { recursive: true });
    this.data.last_run = new Date().toISOString();
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }

  isProcessed(sessionId: string): boolean {
    return sessionId in this.data.processed_sessions;
  }

  markProcessed(sessionId: string, nodesCaptured: number, model: string): void {
    this.data.processed_sessions[sessionId] = {
      processed_at: new Date().toISOString(),
      nodes_captured: nodesCaptured,
      model,
    };
    this.data.model = model;
  }

  getProcessedCount(): number {
    return Object.keys(this.data.processed_sessions).length;
  }

  clear(): void {
    this.data.processed_sessions = {};
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd ~/GitHub/kt-harvest && npx vitest run tests/state.test.ts`
Expected: All 4 tests PASS

**Step 5: Commit**

```bash
git add src/state.ts tests/state.test.ts
git commit -m "feat: add state tracking for processed sessions"
```

---

### Task 3: Transcript Pre-processing Module

**Files:**
- Create: `src/preprocess.ts`
- Create: `tests/preprocess.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/preprocess.test.ts
import { describe, it, expect } from 'vitest';
import { preprocessTranscript } from '../src/preprocess.js';

const sampleTranscript = `# Session: test-123

## User
Can you check the database schema?

## Assistant
Let me read the schema file.

## Tool Use: Read
\`\`\`
file_path: /path/to/schema.sql
\`\`\`

## Tool Result
\`\`\`
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE posts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  title TEXT NOT NULL,
  body TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
\`\`\`

## Assistant
The schema has two tables: users and posts. I'd recommend adding an index on posts.user_id for query performance.

## User
Good call. Let's also add a status column to posts.

## Assistant
That's a good decision. Adding a status enum gives us flexibility for draft/published/archived states without needing a separate table.

## Tool Use: Edit
\`\`\`
file_path: /path/to/schema.sql
old_string: "body TEXT,"
new_string: "body TEXT,\\n  status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'published', 'archived')),"
\`\`\`

## Tool Result
\`\`\`
File edited successfully.
\`\`\`

## Assistant
Done. Added status column with three valid states: draft, published, archived. Defaulting to draft.`;

describe('preprocessTranscript', () => {
  it('strips tool result blocks but keeps tool call names', () => {
    const result = preprocessTranscript(sampleTranscript);
    // Should NOT contain the full SQL schema dump
    expect(result).not.toContain('CREATE TABLE users');
    // Should still mention that a Read tool was used
    expect(result).toContain('Read');
    // Should keep the assistant reasoning
    expect(result).toContain('recommend adding an index');
  });

  it('preserves human/assistant dialogue', () => {
    const result = preprocessTranscript(sampleTranscript);
    expect(result).toContain('check the database schema');
    expect(result).toContain('Good call');
    expect(result).toContain('status enum gives us flexibility');
  });

  it('truncates very long transcripts keeping start and end', () => {
    // Build a transcript with 100 turn pairs
    let long = '# Session: long-session\n\n';
    for (let i = 0; i < 100; i++) {
      long += `## User\nQuestion ${i}\n\n## Assistant\nAnswer ${i} with some reasoning about the approach.\n\n`;
    }
    const result = preprocessTranscript(long, { maxTurns: 40 });
    // Should contain early turns
    expect(result).toContain('Question 0');
    // Should contain late turns
    expect(result).toContain('Question 99');
    // Should indicate truncation
    expect(result).toContain('[truncated');
  });

  it('returns empty string for empty input', () => {
    expect(preprocessTranscript('')).toBe('');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd ~/GitHub/kt-harvest && npx vitest run tests/preprocess.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

```typescript
// src/preprocess.ts

interface PreprocessOptions {
  maxTurns?: number; // max turn pairs to keep (default: no limit)
}

/**
 * Strip tool output blocks from a ccvault-exported markdown transcript.
 * Keeps human messages, assistant responses, and tool call names.
 * Removes tool result content (file contents, command output, etc.)
 */
export function preprocessTranscript(
  transcript: string,
  options: PreprocessOptions = {}
): string {
  if (!transcript.trim()) return '';

  // Split into sections by ## headers
  const sections = transcript.split(/^(## .+)$/m);

  const processed: string[] = [];
  let inToolResult = false;
  let currentToolName = '';

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i].trim();
    if (!section) continue;

    if (section.startsWith('## Tool Result')) {
      inToolResult = true;
      // Replace the full tool result with a brief marker
      processed.push(`## Tool Result\n[output omitted]`);
      continue;
    }

    if (section.startsWith('## Tool Use')) {
      inToolResult = false;
      // Extract tool name from the content that follows
      const nextSection = sections[i + 1]?.trim() || '';
      const toolMatch = section.match(/## Tool Use:\s*(\S+)/);
      if (toolMatch) {
        processed.push(`## Tool Use: ${toolMatch[1]}\n[call details omitted]`);
        i++; // skip the tool call content
      } else {
        processed.push(section);
      }
      continue;
    }

    if (section.startsWith('## ')) {
      inToolResult = false;
      processed.push(section);
      continue;
    }

    if (!inToolResult) {
      processed.push(section);
    }
  }

  let result = processed.join('\n\n');

  // Truncate if needed
  if (options.maxTurns) {
    const turnPattern = /## User/g;
    const matches = [...result.matchAll(turnPattern)];

    if (matches.length > options.maxTurns) {
      const keepStart = Math.ceil(options.maxTurns * 0.4);
      const keepEnd = Math.floor(options.maxTurns * 0.6);

      // Find the position after keepStart turns
      const startCutoff = matches[keepStart]?.index ?? result.length;
      // Find the position of the turn that starts the end section
      const endStart = matches[matches.length - keepEnd]?.index ?? result.length;

      const middleCount = matches.length - keepStart - keepEnd;

      result = result.slice(0, startCutoff) +
        `\n\n[truncated ${middleCount} turns]\n\n` +
        result.slice(endStart);
    }
  }

  return result;
}
```

**Step 4: Run test to verify it passes**

Run: `cd ~/GitHub/kt-harvest && npx vitest run tests/preprocess.test.ts`
Expected: All 4 tests PASS

**Step 5: Commit**

```bash
git add src/preprocess.ts tests/preprocess.test.ts
git commit -m "feat: add transcript pre-processing (strip tool output, truncation)"
```

---

### Task 4: Capture Protocol File

**Files:**
- Create: `~/GitHub/kt-harvest/protocol.md`

This is the system prompt sent to the LLM for every extraction. It encodes the golden principles and node type taxonomy from the design doc.

**Step 1: Analyze existing kt nodes for real examples**

Run on Mac Mini:
```bash
kt search "decision" -n default --format json | head -5
kt search "chose" -n default --format json | head -5
kt list -n writing --format json | head -5
```

Use the output to pull 2-3 real examples per node type.

**Step 2: Write protocol.md**

The protocol must include:
- Role description ("You are a knowledge extraction agent...")
- The 5 golden principles (from design doc)
- Node type taxonomy with 2-3 real examples each (from kt data)
- Expected JSON output format
- Explicit instruction: return `[]` for sessions with nothing worth capturing
- Explicit instruction: nodes must be self-contained (readable without session context)

Template structure:

```markdown
# Knowledge Extraction Protocol v1.0

You are a knowledge extraction agent. Your job is to read a Claude Code session
transcript and identify knowledge worth persisting.

## Golden Principles

1. **Capture decisions, not actions.**
   ...

[full content from design doc, plus examples pulled from real kt nodes]

## Output Format

Return ONLY valid JSON. No markdown, no explanation, no preamble.

[
  {
    "type": "decision|contradiction|insight|context|refinement",
    "title": "Short descriptive title (max 10 words)",
    "content": "Self-contained description. Must be readable without the session transcript.",
    "namespace": "detected-namespace-or-default",
    "tags": ["tag1", "tag2"]
  }
]

Return an empty array [] if the session contains nothing worth capturing.
```

**Step 3: Commit**

```bash
git add protocol.md
git commit -m "feat: add capture protocol (golden principles + taxonomy)"
```

---

### Task 5: ccvault Integration Module

**Files:**
- Create: `src/ccvault.ts`
- Create: `tests/ccvault.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/ccvault.test.ts
import { describe, it, expect } from 'vitest';
import { parseSessions, parseSessionList } from '../src/ccvault.js';

// Test with realistic ccvault JSON output
const sampleListOutput = JSON.stringify([
  {
    id: 'abc-123',
    project_id: 1,
    started_at: '2026-02-14T10:00:00Z',
    ended_at: '2026-02-14T10:30:00Z',
    model: 'claude-opus-4-6',
    turn_count: 20,
  },
  {
    id: 'def-456',
    project_id: 2,
    started_at: '2026-02-14T11:00:00Z',
    ended_at: '2026-02-14T11:45:00Z',
    model: 'claude-sonnet-4-5-20250929',
    turn_count: 50,
  },
]);

describe('parseSessionList', () => {
  it('parses ccvault list-sessions JSON output', () => {
    const sessions = parseSessionList(sampleListOutput);
    expect(sessions).toHaveLength(2);
    expect(sessions[0].id).toBe('abc-123');
    expect(sessions[1].model).toBe('claude-sonnet-4-5-20250929');
  });

  it('returns empty array for empty output', () => {
    expect(parseSessionList('[]')).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd ~/GitHub/kt-harvest && npx vitest run tests/ccvault.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/ccvault.ts
import { execSync } from 'child_process';

export interface CcvaultSession {
  id: string;
  project_id: number;
  started_at: string;
  ended_at: string;
  model: string;
  turn_count: number;
  git_branch?: string;
}

export function parseSessionList(jsonOutput: string): CcvaultSession[] {
  return JSON.parse(jsonOutput);
}

export function syncSessions(): void {
  execSync('ccvault sync', { stdio: 'pipe' });
}

export function listSessions(): CcvaultSession[] {
  const output = execSync('ccvault list-sessions --json --limit 500', {
    encoding: 'utf-8',
  });
  return parseSessionList(output);
}

export function exportSession(sessionId: string): string {
  return execSync(`ccvault export ${sessionId}`, {
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024, // 10MB for long sessions
  });
}

export function getProjectPath(session: CcvaultSession): string {
  // Get project path from ccvault for namespace detection
  const output = execSync(`ccvault show ${session.id} --json`, {
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
  });
  const data = JSON.parse(output);
  return data.project_path || '';
}
```

Note: `listSessions`, `syncSessions`, `exportSession`, and `getProjectPath` call the real ccvault binary. They're tested via integration tests (Task 8), not unit tests. Only the JSON parsing is unit-tested here.

**Step 4: Run test to verify it passes**

Run: `cd ~/GitHub/kt-harvest && npx vitest run tests/ccvault.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/ccvault.ts tests/ccvault.test.ts
git commit -m "feat: add ccvault CLI integration module"
```

---

### Task 6: Ollama Extraction Module

**Files:**
- Create: `src/extract.ts`
- Create: `tests/extract.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/extract.test.ts
import { describe, it, expect } from 'vitest';
import { parseExtractionResponse, ExtractedNode } from '../src/extract.js';

describe('parseExtractionResponse', () => {
  it('parses valid JSON array of nodes', () => {
    const response = JSON.stringify([
      {
        type: 'decision',
        title: 'Chose ccvault over forking',
        content: 'Decided to use ccvault as external dependency rather than forking because upstream is actively maintained.',
        namespace: 'kt',
        tags: ['architecture', 'dependency'],
      },
    ]);
    const nodes = parseExtractionResponse(response);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe('decision');
    expect(nodes[0].title).toBe('Chose ccvault over forking');
  });

  it('returns empty array for empty JSON array', () => {
    expect(parseExtractionResponse('[]')).toEqual([]);
  });

  it('handles LLM wrapping response in markdown code block', () => {
    const response = '```json\n[{"type":"insight","title":"Test","content":"Test content","namespace":"default","tags":[]}]\n```';
    const nodes = parseExtractionResponse(response);
    expect(nodes).toHaveLength(1);
  });

  it('handles LLM adding preamble text before JSON', () => {
    const response = 'Here are the extracted nodes:\n\n[{"type":"insight","title":"Test","content":"Test content","namespace":"default","tags":[]}]';
    const nodes = parseExtractionResponse(response);
    expect(nodes).toHaveLength(1);
  });

  it('returns empty array for unparseable garbage', () => {
    expect(parseExtractionResponse('I could not find anything')).toEqual([]);
  });

  it('filters out nodes with missing required fields', () => {
    const response = JSON.stringify([
      { type: 'decision', title: 'Good', content: 'Valid node', namespace: 'default', tags: [] },
      { type: 'decision', title: '', content: '', namespace: 'default', tags: [] },
    ]);
    const nodes = parseExtractionResponse(response);
    expect(nodes).toHaveLength(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd ~/GitHub/kt-harvest && npx vitest run tests/extract.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/extract.ts
import { Ollama } from 'ollama';
import { readFileSync } from 'fs';

export interface ExtractedNode {
  type: 'decision' | 'contradiction' | 'insight' | 'context' | 'refinement';
  title: string;
  content: string;
  namespace: string;
  tags: string[];
}

const VALID_TYPES = ['decision', 'contradiction', 'insight', 'context', 'refinement'];

/**
 * Parse LLM response into ExtractedNode array.
 * Handles: clean JSON, markdown-wrapped JSON, preamble text, garbage.
 */
export function parseExtractionResponse(response: string): ExtractedNode[] {
  let jsonStr = response.trim();

  // Strip markdown code fences
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  // Try to find JSON array in the response
  const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
  if (!arrayMatch) return [];

  try {
    const parsed = JSON.parse(arrayMatch[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((node: any) =>
      node &&
      typeof node.title === 'string' && node.title.trim() !== '' &&
      typeof node.content === 'string' && node.content.trim() !== '' &&
      typeof node.namespace === 'string' &&
      VALID_TYPES.includes(node.type) &&
      Array.isArray(node.tags)
    );
  } catch {
    return [];
  }
}

/**
 * Send a preprocessed transcript to Ollama with the capture protocol.
 * Returns extracted nodes.
 */
export async function extractFromTranscript(
  transcript: string,
  protocolPath: string,
  model: string,
  ollamaHost?: string,
): Promise<ExtractedNode[]> {
  const protocol = readFileSync(protocolPath, 'utf-8');

  const ollama = new Ollama({ host: ollamaHost });

  const response = await ollama.chat({
    model,
    messages: [
      { role: 'system', content: protocol },
      { role: 'user', content: `Here is a Claude Code session transcript. Extract knowledge nodes according to the protocol.\n\n${transcript}` },
    ],
    options: {
      temperature: 0.1, // low temperature for structured extraction
      num_ctx: 32768,   // large context for long transcripts
    },
  });

  return parseExtractionResponse(response.message.content);
}
```

**Step 4: Run test to verify it passes**

Run: `cd ~/GitHub/kt-harvest && npx vitest run tests/extract.test.ts`
Expected: All 6 tests PASS

**Step 5: Commit**

```bash
git add src/extract.ts tests/extract.test.ts
git commit -m "feat: add Ollama extraction module with robust JSON parsing"
```

---

### Task 7: kt Capture Integration Module

**Files:**
- Create: `src/kt.ts`
- Create: `tests/kt.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/kt.test.ts
import { describe, it, expect } from 'vitest';
import { buildCaptureCommand } from '../src/kt.js';
import type { ExtractedNode } from '../src/extract.js';

describe('buildCaptureCommand', () => {
  it('builds a valid kt capture command', () => {
    const node: ExtractedNode = {
      type: 'decision',
      title: 'Chose ccvault over forking',
      content: 'Decided to use ccvault as external dependency rather than forking.',
      namespace: 'kt',
      tags: ['architecture', 'dependency'],
    };
    const cmd = buildCaptureCommand(node);
    expect(cmd).toContain('kt capture');
    expect(cmd).toContain('--namespace kt');
    expect(cmd).toContain('--title "Chose ccvault over forking"');
    expect(cmd).toContain('--tags "architecture,dependency"');
  });

  it('escapes double quotes in content', () => {
    const node: ExtractedNode = {
      type: 'insight',
      title: 'Quote handling',
      content: 'The user said "hello world" which was interesting.',
      namespace: 'default',
      tags: [],
    };
    const cmd = buildCaptureCommand(node);
    expect(cmd).not.toContain('""'); // should be escaped
  });

  it('maps namespace "default" when no mapping found', () => {
    const node: ExtractedNode = {
      type: 'context',
      title: 'Test',
      content: 'Test content',
      namespace: '',
      tags: [],
    };
    const cmd = buildCaptureCommand(node);
    expect(cmd).toContain('--namespace default');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd ~/GitHub/kt-harvest && npx vitest run tests/kt.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/kt.ts
import { execSync } from 'child_process';
import type { ExtractedNode } from './extract.js';

function escapeForShell(str: string): string {
  return str.replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
}

export function buildCaptureCommand(node: ExtractedNode): string {
  const ns = node.namespace || 'default';
  const content = escapeForShell(node.content);
  const title = escapeForShell(node.title);
  const tags = node.tags.join(',');

  let cmd = `kt capture "${content}" --namespace ${ns} --title "${title}"`;
  if (tags) {
    cmd += ` --tags "${tags}"`;
  }
  return cmd;
}

export function captureNode(node: ExtractedNode): { success: boolean; output: string } {
  const cmd = buildCaptureCommand(node);
  try {
    const output = execSync(cmd, { encoding: 'utf-8', stdio: 'pipe' });
    return { success: true, output };
  } catch (err: any) {
    return { success: false, output: err.message };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd ~/GitHub/kt-harvest && npx vitest run tests/kt.test.ts`
Expected: All 3 tests PASS

**Step 5: Commit**

```bash
git add src/kt.ts tests/kt.test.ts
git commit -m "feat: add kt capture command builder"
```

---

### Task 8: Main Orchestrator (CLI + Pipeline)

**Files:**
- Modify: `src/index.ts`
- Create: `src/harvest.ts`

**Step 1: Write the harvest orchestrator**

```typescript
// src/harvest.ts
import { syncSessions, listSessions, exportSession } from './ccvault.js';
import { preprocessTranscript } from './preprocess.js';
import { extractFromTranscript, ExtractedNode } from './extract.js';
import { captureNode } from './kt.js';
import { State } from './state.js';
import { resolve } from 'path';
import { homedir } from 'os';

export interface HarvestOptions {
  model: string;
  protocolPath: string;
  stateDir: string;
  ollamaHost?: string;
  reprocess?: boolean;
  dryRun?: boolean;
  maxTurns?: number;
  limit?: number; // max sessions to process per run
}

export interface SessionResult {
  sessionId: string;
  nodesCaptured: number;
  nodes: ExtractedNode[];
  error?: string;
}

export async function harvest(options: HarvestOptions): Promise<SessionResult[]> {
  const state = new State(options.stateDir);
  state.load();

  // Step 1: Sync ccvault
  console.log('Syncing ccvault...');
  syncSessions();

  // Step 2: Get sessions
  const allSessions = listSessions();
  console.log(`Found ${allSessions.length} total sessions`);

  // Step 3: Filter to unprocessed
  let toProcess = options.reprocess
    ? allSessions
    : allSessions.filter(s => !state.isProcessed(s.id));

  if (options.limit && toProcess.length > options.limit) {
    toProcess = toProcess.slice(0, options.limit);
  }

  console.log(`Processing ${toProcess.length} sessions (${allSessions.length - toProcess.length} already processed)`);

  const results: SessionResult[] = [];

  // Step 4: Process each session
  for (const session of toProcess) {
    console.log(`\nProcessing session ${session.id.slice(0, 8)}... (${session.turn_count} turns)`);

    try {
      // Export and preprocess
      const transcript = exportSession(session.id);
      const processed = preprocessTranscript(transcript, { maxTurns: options.maxTurns });

      if (!processed.trim()) {
        console.log('  → Empty transcript, skipping');
        state.markProcessed(session.id, 0, options.model);
        results.push({ sessionId: session.id, nodesCaptured: 0, nodes: [] });
        continue;
      }

      // Extract
      const nodes = await extractFromTranscript(
        processed,
        options.protocolPath,
        options.model,
        options.ollamaHost,
      );

      console.log(`  → Extracted ${nodes.length} nodes`);

      if (!options.dryRun) {
        // Capture each node
        for (const node of nodes) {
          const result = captureNode(node);
          if (result.success) {
            console.log(`  ✓ Captured: ${node.title} (${node.type})`);
          } else {
            console.log(`  ✗ Failed: ${node.title} — ${result.output}`);
          }
        }
      } else {
        for (const node of nodes) {
          console.log(`  [dry-run] Would capture: ${node.title} (${node.type})`);
        }
      }

      state.markProcessed(session.id, nodes.length, options.model);
      results.push({ sessionId: session.id, nodesCaptured: nodes.length, nodes });
    } catch (err: any) {
      console.log(`  ✗ Error: ${err.message}`);
      results.push({ sessionId: session.id, nodesCaptured: 0, nodes: [], error: err.message });
    }
  }

  // Save state
  if (!options.dryRun) {
    state.save();
  }

  // Summary
  const totalCaptured = results.reduce((sum, r) => sum + r.nodesCaptured, 0);
  console.log(`\nDone. Processed ${results.length} sessions, captured ${totalCaptured} nodes.`);

  return results;
}
```

**Step 2: Write the CLI entry point**

```typescript
// src/index.ts
#!/usr/bin/env node
import { Command } from 'commander';
import { harvest } from './harvest.js';
import { resolve } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const program = new Command();

program
  .name('kt-harvest')
  .description('Automated knowledge extraction from Claude Code sessions')
  .version('0.1.0');

program
  .command('run')
  .description('Process new sessions and extract knowledge')
  .option('-m, --model <model>', 'Ollama model to use', 'qwen3:30b-a3b-q4_K_M')
  .option('--protocol <path>', 'Path to capture protocol', join(__dirname, '..', 'protocol.md'))
  .option('--state-dir <path>', 'State directory', join(homedir(), '.kt-harvest'))
  .option('--ollama-host <url>', 'Ollama host URL')
  .option('--reprocess', 'Reprocess already-processed sessions', false)
  .option('--dry-run', 'Extract but do not capture into kt', false)
  .option('--max-turns <n>', 'Max turns to keep per transcript', '80')
  .option('--limit <n>', 'Max sessions to process per run', '')
  .action(async (opts) => {
    await harvest({
      model: opts.model,
      protocolPath: resolve(opts.protocol),
      stateDir: resolve(opts.stateDir),
      ollamaHost: opts.ollamaHost,
      reprocess: opts.reprocess,
      dryRun: opts.dryRun,
      maxTurns: parseInt(opts.maxTurns, 10),
      limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
    });
  });

program
  .command('status')
  .description('Show harvest status')
  .option('--state-dir <path>', 'State directory', join(homedir(), '.kt-harvest'))
  .action((opts) => {
    const { State } = require('./state.js');
    const state = new State(resolve(opts.stateDir));
    state.load();
    console.log(`Processed sessions: ${state.getProcessedCount()}`);
  });

program.parse();
```

**Step 3: Build and verify**

```bash
cd ~/GitHub/kt-harvest
npx tsc --noEmit
```

Expected: No type errors.

**Step 4: Commit**

```bash
git add src/index.ts src/harvest.ts
git commit -m "feat: add main orchestrator and CLI"
```

---

### Task 9: Model Evaluation Harness

**Files:**
- Create: `src/evaluate.ts`

This adds an `evaluate` command that runs the extraction against a set of test sessions and outputs a comparison report for human (Claude) review.

**Step 1: Write the evaluation command**

```typescript
// src/evaluate.ts
import { exportSession, listSessions } from './ccvault.js';
import { preprocessTranscript } from './preprocess.js';
import { extractFromTranscript, ExtractedNode } from './extract.js';
import { resolve } from 'path';
import { writeFileSync, mkdirSync } from 'fs';

export interface EvalOptions {
  models: string[];
  sessionIds: string[];
  protocolPath: string;
  ollamaHost?: string;
  outputDir: string;
  maxTurns?: number;
}

export async function evaluate(options: EvalOptions): Promise<void> {
  mkdirSync(options.outputDir, { recursive: true });

  const results: Record<string, Record<string, ExtractedNode[]>> = {};

  for (const sessionId of options.sessionIds) {
    console.log(`\nExporting session ${sessionId.slice(0, 8)}...`);
    const transcript = exportSession(sessionId);
    const processed = preprocessTranscript(transcript, { maxTurns: options.maxTurns });

    results[sessionId] = {};

    for (const model of options.models) {
      console.log(`  Running ${model}...`);
      try {
        const nodes = await extractFromTranscript(
          processed,
          options.protocolPath,
          model,
          options.ollamaHost,
        );
        results[sessionId][model] = nodes;
        console.log(`  → ${nodes.length} nodes extracted`);
      } catch (err: any) {
        console.log(`  ✗ Error: ${err.message}`);
        results[sessionId][model] = [];
      }
    }
  }

  // Write report
  let report = '# kt-harvest Model Evaluation Report\n\n';
  report += `Date: ${new Date().toISOString()}\n`;
  report += `Models: ${options.models.join(', ')}\n`;
  report += `Sessions: ${options.sessionIds.length}\n\n`;

  for (const sessionId of options.sessionIds) {
    report += `## Session ${sessionId.slice(0, 8)}\n\n`;

    for (const model of options.models) {
      const nodes = results[sessionId][model];
      report += `### ${model} (${nodes.length} nodes)\n\n`;

      if (nodes.length === 0) {
        report += '_No nodes extracted._\n\n';
      } else {
        for (const node of nodes) {
          report += `- **[${node.type}]** ${node.title}\n`;
          report += `  ${node.content}\n`;
          report += `  _tags: ${node.tags.join(', ')}_\n\n`;
        }
      }
    }
    report += '---\n\n';
  }

  const reportPath = resolve(options.outputDir, 'evaluation-report.md');
  writeFileSync(reportPath, report);
  console.log(`\nReport saved to ${reportPath}`);

  // Also save raw JSON for programmatic analysis
  const jsonPath = resolve(options.outputDir, 'evaluation-results.json');
  writeFileSync(jsonPath, JSON.stringify(results, null, 2));
  console.log(`Raw results saved to ${jsonPath}`);
}
```

**Step 2: Wire into CLI**

Add to `src/index.ts` after the `status` command:

```typescript
program
  .command('evaluate')
  .description('Run model evaluation against test sessions')
  .requiredOption('--sessions <ids...>', 'Session IDs to evaluate')
  .option('--models <models...>', 'Models to compare', ['qwen3:30b-a3b-q4_K_M', 'gemma3:12b-q4_K_M', 'mistral-small3.1:24b-instruct-q4_K_M'])
  .option('--protocol <path>', 'Path to capture protocol', join(__dirname, '..', 'protocol.md'))
  .option('--ollama-host <url>', 'Ollama host URL')
  .option('--output-dir <path>', 'Output directory for reports', './eval-results')
  .option('--max-turns <n>', 'Max turns per transcript', '80')
  .action(async (opts) => {
    const { evaluate } = await import('./evaluate.js');
    await evaluate({
      models: opts.models,
      sessionIds: opts.sessions,
      protocolPath: resolve(opts.protocol),
      ollamaHost: opts.ollamaHost,
      outputDir: resolve(opts.outputDir),
      maxTurns: parseInt(opts.maxTurns, 10),
    });
  });
```

**Step 3: Commit**

```bash
git add src/evaluate.ts src/index.ts
git commit -m "feat: add model evaluation harness for comparing extraction quality"
```

---

### Task 10: Integration Test + First Dry Run

This task runs on the Mac Mini where Ollama and ccvault are available.

**Step 1: Pull evaluation models to external storage**

```bash
# Ensure Ollama stores models on external drive
export OLLAMA_MODELS=/Volumes/Storage/ollama/models

# Pull the three candidate models (one at a time, they're large)
ollama pull qwen3:30b-a3b-q4_K_M
ollama pull gemma3:12b
ollama pull mistral-small3.1:24b-instruct-q4_K_M
```

Note: Exact model tags may vary. Check `ollama list` for available quantizations and adjust model names in the CLI defaults if needed.

**Step 2: Select 10 test sessions**

```bash
# List recent sessions to pick test set
ccvault list-sessions --limit 20 --json
```

Pick sessions spanning the types described in the design doc. Note the session IDs.

**Step 3: Run evaluation**

```bash
cd ~/GitHub/kt-harvest
npx tsx src/index.ts evaluate \
  --sessions <id1> <id2> <id3> ... \
  --output-dir ./eval-results
```

**Step 4: Review the evaluation report**

Open `eval-results/evaluation-report.md` and assess:
- Precision: noise rate per model
- Recall: missed obvious knowledge
- Node quality: self-contained and well-formed?
- Silence on noise: zero nodes for mechanical sessions?

**Step 5: Pick winning model and do first real run**

```bash
npx tsx src/index.ts run --model <winner> --dry-run --limit 5
```

Review the dry-run output. If quality is acceptable:

```bash
npx tsx src/index.ts run --model <winner> --limit 10
```

Verify nodes appeared in kt: `kt list --format json | tail -20`

**Step 6: Commit evaluation results**

```bash
git add eval-results/
git commit -m "feat: first model evaluation results"
```

---

### Task 11: Cron Setup on Mac Mini

**Step 1: Create runner script**

```bash
# ~/GitHub/kt-harvest/run-harvest.sh
#!/bin/bash
export PATH="/opt/homebrew/bin:$PATH"
export OLLAMA_MODELS="/Volumes/Storage/ollama/models"

cd ~/GitHub/kt-harvest
npx tsx src/index.ts run --model <winning-model> >> ~/.kt-harvest/harvest.log 2>&1
```

```bash
chmod +x ~/GitHub/kt-harvest/run-harvest.sh
```

**Step 2: Add cron entry**

```bash
crontab -e
# Add:
0 */2 9-22 * * ~/GitHub/kt-harvest/run-harvest.sh
```

**Step 3: Verify cron fires**

Wait for next interval or test manually:
```bash
~/GitHub/kt-harvest/run-harvest.sh
cat ~/.kt-harvest/harvest.log
```

**Step 4: Commit runner script**

```bash
git add run-harvest.sh
git commit -m "feat: add cron runner script for Mac Mini"
```
