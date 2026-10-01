/**
 * Tests for OpenAI endpoint normalization in lib/aiService.js.
 *
 * AIZEN lets admins point OpenAI traffic at a custom base URL (OpenRouter,
 * vLLM, Ollama, a reverse proxy). Every caller derives its final URL from that
 * one string, so normalization is the single place where a typo turns into a
 * wrong outbound request. These tests pin that behavior.
 *
 * normalizeEndpoint is pure, so no HTTP or database is touched.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

// aiService requires ./db at module load, which opens SQLite. Point it at a
// throwaway file so the real data/aizen.db is never opened.
const fs = require('fs');
const os = require('os');
const path = require('path');
const TMP_DB = path.join(os.tmpdir(), `aizen-endpoint-test-${process.pid}.db`);
process.env.DB_FILE = TMP_DB;
for (const suffix of ['', '-wal', '-shm']) fs.rmSync(TMP_DB + suffix, { force: true });

const aiService = require('../lib/aiService');
const db = require('../lib/db');

test.after(() => {
  // Windows refuses to delete an open file, so release the handle first.
  db.close();
  for (const s of ['', '-wal', '-shm']) fs.rmSync(TMP_DB + s, { force: true });
});

test('normalizeEndpoint falls back to the official OpenAI base URL', () => {
  assert.equal(aiService.normalizeEndpoint(undefined), 'https://api.openai.com/v1');
  assert.equal(aiService.normalizeEndpoint(''), 'https://api.openai.com/v1');
  assert.equal(aiService.normalizeEndpoint('   '), 'https://api.openai.com/v1');
});

test('normalizeEndpoint assumes https when the scheme is missing', () => {
  // A bare host is the most common paste; silently defaulting to http would
  // downgrade the key to plaintext on the wire.
  assert.equal(aiService.normalizeEndpoint('openrouter.ai/api/v1'), 'https://openrouter.ai/api/v1');
});

test('normalizeEndpoint keeps an explicit http scheme for local servers', () => {
  // Ollama and vLLM commonly run on plain http on localhost.
  assert.equal(aiService.normalizeEndpoint('http://localhost:11434/v1'), 'http://localhost:11434/v1');
});

test('normalizeEndpoint strips trailing slashes', () => {
  assert.equal(aiService.normalizeEndpoint('https://api.openai.com/v1/'), 'https://api.openai.com/v1');
  assert.equal(aiService.normalizeEndpoint('https://api.openai.com/v1///'), 'https://api.openai.com/v1');
});

test('normalizeEndpoint leaves an already-qualified path untouched', () => {
  const full = 'https://api.openai.com/v1/chat/completions';
  assert.equal(aiService.normalizeEndpoint(full), full);
});

test('a base URL and a full chat/completions URL resolve to the same chat endpoint', () => {
  // The admin may paste either form; both must reach the same place, or the
  // saved config silently breaks depending on which was typed.
  const fromBase = aiService.normalizeEndpoint('https://gw.example.com/v1') + '/chat/completions';
  const fromFull = aiService.normalizeEndpoint('https://gw.example.com/v1/chat/completions');
  assert.equal(fromBase, fromFull);
});

test('normalizeEndpoint is idempotent', () => {
  const once = aiService.normalizeEndpoint('https://gw.example.com/v1/');
  assert.equal(aiService.normalizeEndpoint(once), once);
});