import { execSync } from 'child_process';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const cli = 'node dist/cli.js';
const fixture = join(__dirname, 'fixtures.jsonl');

function run(args) {
  try {
    // Use array-style to avoid shell escaping issues
    return execSync(`node dist/cli.js ${args}`, {
      encoding: 'utf-8',
      cwd: join(__dirname, '..'),
      shell: '/bin/bash',
    });
  } catch (e) {
    return { error: true, code: e.status, stderr: e.stderr?.toString(), stdout: e.stdout?.toString() };
  }
}

function lines(s) {
  if (typeof s !== 'string') return [];
  return s.trim().split('\n').filter(l => l);
}
function parseLines(s) { return lines(s).map(l => JSON.parse(l)); }

let passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ❌ ${name}: ${e.message}`);
    failed++;
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }

// ── Tests ──
console.log('jsonl-cli tests\n');

test('count', () => {
  const out = run(`count ${fixture}`);
  assert(out.trim() === '8', `expected 8 got ${out.trim()}`);
});

test('head 3', () => {
  const out = run(`head 3 ${fixture}`);
  assert(lines(out).length === 3, `expected 3 lines got ${lines(out).length}`);
});

test('tail 2', () => {
  const out = run(`tail 2 ${fixture}`);
  const parsed = parseLines(out);
  assert(parsed.length === 2, 'expected 2 lines');
  assert(parsed[0].msg === 'ok', `expected "ok" got "${parsed[0].msg}"`);
});

test('filter =', () => {
  const out = run(`filter 'level=error' ${fixture}`);
  const parsed = parseLines(out);
  assert(parsed.length === 3, `expected 3 got ${parsed.length}`);
  assert(parsed.every(r => r.level === 'error'), 'not all errors');
});

test('filter !=', () => {
  const out = run(`filter 'level!=error' ${fixture}`);
  assert(lines(out).length === 5, `expected 5 got ${lines(out).length}`);
});

test('filter >', () => {
  const out = run(`filter 'status>200' ${fixture}`);
  const parsed = parseLines(out);
  assert(parsed.length === 4, `expected 4 got ${parsed.length}`);
  assert(parsed.every(r => r.status > 200), 'not all >200');
});

test('filter >=', () => {
  const out = run(`filter 'status>=500' ${fixture}`);
  const parsed = parseLines(out);
  assert(parsed.every(r => r.status >= 500), 'not all >=500');
});

test('filter =~ regex', () => {
  const out = run(`filter 'msg=~timeout' ${fixture}`);
  assert(lines(out).length === 2, `expected 2 got ${lines(out).length}`);
});

test('select fields', () => {
  const out = run(`select 'level,msg' ${fixture}`);
  const parsed = parseLines(out);
  assert(parsed.every(r => Object.keys(r).length === 2 && 'level' in r && 'msg' in r), 'wrong keys');
});

test('select nested field', () => {
  const out = run(`select 'msg,meta.latency' ${fixture}`);
  const parsed = parseLines(out);
  const withLatency = parsed.filter(r => 'meta.latency' in r);
  assert(withLatency.length === 3, `expected 3 with latency got ${withLatency.length}`);
});

test('flat', () => {
  const out = run(`flat ${fixture}`);
  const parsed = parseLines(out);
  const withFlat = parsed.filter(r => 'meta.latency' in r);
  assert(withFlat.length === 3, 'expected 3 with flattened meta.latency');
});

test('uniq', () => {
  const out = run(`uniq level ${fixture}`);
  const vals = lines(out).sort();
  assert(vals.join(',') === 'debug,error,info,warn', `got ${vals.join(',')}`);
});

test('pluck single', () => {
  const out = run(`pluck .msg ${fixture}`);
  assert(lines(out).length === 8, `expected 8 got ${lines(out).length}`);
  assert(lines(out)[0] === 'server started', `got ${lines(out)[0]}`);
});

test('pluck multi', () => {
  const out = run(`pluck '.level,.msg' ${fixture}`);
  const parsed = parseLines(out);
  assert(parsed.every(r => 'level' in r && 'msg' in r && Object.keys(r).length === 2), 'wrong shape');
});

test('rename', () => {
  const out = run(`rename 'level:severity' ${fixture}`);
  const parsed = parseLines(out);
  assert(parsed.every(r => 'severity' in r && !('level' in r)), 'rename failed');
});

test('group', () => {
  const out = run(`group level ${fixture}`);
  const parsed = parseLines(out);
  const infoG = parsed.find(r => r.level === 'info');
  assert(infoG && infoG.count === 3, `info count wrong: ${JSON.stringify(infoG)}`);
});

test('sort numeric', () => {
  const out = run(`sort status -n ${fixture}`);
  const statuses = parseLines(out).map(r => r.status);
  const sorted = [...statuses].sort((a,b) => a - b);
  assert(statuses.join(',') === sorted.join(','), 'not sorted');
});

test('sort numeric reverse', () => {
  const out = run(`sort status -n -r ${fixture}`);
  const statuses = parseLines(out).map(r => r.status);
  const sorted = [...statuses].sort((a,b) => b - a);
  assert(statuses.join(',') === sorted.join(','), 'not reverse sorted');
});

test('stats', () => {
  const out = run(`stats -f status ${fixture}`);
  const s = JSON.parse(out);
  assert(s.count === 8, `count ${s.count}`);
  assert(s.min === 200, `min ${s.min}`);
  assert(s.max === 504, `max ${s.max}`);
});

test('sample runs without error', () => {
  const out = run(`sample 0.5 ${fixture}`);
  assert(typeof out === 'string', 'should return string');
  const n = lines(out).length;
  assert(n <= 8, `sample returned ${n} > 8`);
});

test('stdin pipe', () => {
  const out = run(`count < ${fixture}`);
  assert(out.trim() === '8', `stdin count wrong: ${out.trim()}`);
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed} tests`);
if (failed > 0) process.exit(1);

// ── New tests: validate, agg ──
import { writeFileSync, unlinkSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';

const tmp = mkdtempSync(join(tmpdir(), 'jsonl-test-'));
const validFix = join(tmp, 'valid.jsonl');
const mixedFix = join(tmp, 'mixed.jsonl');

writeFileSync(validFix, `{"a":1}\n{"a":2}\n{"a":3}\n`);
writeFileSync(mixedFix, `{"a":1}\nbad line\n{"a":2}\nalso broken\n{"a":3}\n`);

test('validate - all valid', () => {
  const out = run(`validate ${validFix}`);
  assert(out.includes('All 3 lines are valid JSONL'), `got: ${out}`);
});

test('validate - mixed file shows errors', () => {
  const result = run(`validate ${mixedFix}`);
  assert(result.error === true, 'should exit with error');
  assert(result.stderr.includes('2 invalid line'), `got: ${result.stderr}`);
});

test('validate - quiet mode on valid', () => {
  const out = run(`validate --quiet ${validFix}`);
  assert(out.trim() === '', `quiet should produce no output on valid, got: ${out}`);
});

test('agg - basic aggregation', () => {
  const out = run(`agg -f status ${fixture}`);
  const parsed = JSON.parse(out.trim());
  assert(parsed.count === 8, `expected count 8, got ${parsed.count}`);
  assert(parsed.min === 200, `min should be 200`);
  assert(parsed.max === 504, `max should be 504`);
  assert(parsed.sum > 0, 'sum should be positive');
});

test('agg - empty field', () => {
  const out = run(`agg -f nonexistent ${fixture}`);
  const parsed = JSON.parse(out.trim());
  assert(parsed.count === 0, 'should have 0 count for missing field');
});

// cleanup
try { unlinkSync(validFix); } catch {}
try { unlinkSync(mixedFix); } catch {}
try { unlinkSync(join(tmp, ''));
} catch {}

