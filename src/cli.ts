#!/usr/bin/env node

import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { program } from 'commander';

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function pickFields(obj: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = getNestedValue(obj, f);
    if (v !== undefined) out[f] = v;
  }
  return out;
}

interface Matcher { op: string; val: string; }

function parseFilter(s: string): { field: string; matcher: Matcher } | null {
  for (const op of ['!=', '=~', '>=', '<=', '=', '>', '<']) {
    const idx = s.indexOf(op);
    if (idx > 0) return { field: s.slice(0, idx), matcher: { op, val: s.slice(idx + op.length) } };
  }
  return null;
}

function matchesFilter(obj: Record<string, unknown>, field: string, m: Matcher): boolean {
  const v = getNestedValue(obj, field);
  switch (m.op) {
    case '=':  return String(v) === m.val;
    case '!=': return String(v) !== m.val;
    case '>':  return Number(v) > Number(m.val);
    case '<':  return Number(v) < Number(m.val);
    case '>=': return Number(v) >= Number(m.val);
    case '<=': return Number(v) <= Number(m.val);
    case '=~': return new RegExp(m.val).test(String(v));
    default:   return false;
  }
}

async function* readJSONL(files: string[]): AsyncGenerator<Record<string, unknown>> {
  const sources = files.length > 0 ? files : ['-'];
  for (const src of sources) {
    const stream = src === '-' ? process.stdin : createReadStream(src, 'utf-8');
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      const t = line.trim();
      if (!t) continue;
      try { yield JSON.parse(t); } catch { /* skip */ }
    }
  }
}

function flatten(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v))
      Object.assign(out, flatten(v as Record<string, unknown>, key));
    else out[key] = v;
  }
  return out;
}

/**
 * Evaluate a simple jq-like expression against an object.
 * Supports:
 *   .field         → get field
 *   .field.sub     → nested access
 *   .field,.other  → pick multiple fields (outputs object)
 *   .field[].sub   → array iteration (not supported yet, shows warning)
 */
function evalExpr(obj: Record<string, unknown>, expr: string): unknown {
  const trimmed = expr.trim();
  if (!trimmed.startsWith('.')) return trimmed; // literal

  const path = trimmed.slice(1); // strip leading dot
  if (!path) return obj; // "." = identity

  // comma-separated = pick multiple fields
  if (path.includes(',')) {
    const fields = path.split(',').map(f => f.trim()).filter(Boolean);
    return pickFields(obj, fields);
  }

  return getNestedValue(obj, path);
}

program.name('jsonl').description('CLI toolkit for JSON Lines files').version('1.2.0');

program.command('pretty')
  .description('Pretty-print JSONL as formatted JSON')
  .argument('[files...]', 'Input files')
  .option('-c, --color', 'Colorize output')
  .action(async (files: string[], opts: { color?: boolean }) => {
    for await (const obj of readJSONL(files)) {
      const json = JSON.stringify(obj, null, 2);
      if (opts.color)
        console.log(json.replace(/"([^"]+)":/g, '\x1b[34m"$1"\x1b[0m:').replace(/: "([^"]+)"/g, ': \x1b[32m"$1"\x1b[0m'));
      else console.log(json);
    }
  });

program.command('filter <expr>')
  .description('Filter by field value (level=error, msg=~timeout, status>=400)')
  .argument('[files...]', 'Input files')
  .action(async (expr: string, files: string[]) => {
    const p = parseFilter(expr);
    if (!p) { console.error('Bad filter: ' + expr); process.exit(1); }
    for await (const obj of readJSONL(files))
      if (matchesFilter(obj, p.field, p.matcher)) console.log(JSON.stringify(obj));
  });

program.command('select <fields>')
  .description('Pick fields (comma-separated, dot-notation for nested)')
  .argument('[files...]', 'Input files')
  .action(async (fields: string, files: string[]) => {
    const f = fields.split(',').map(s => s.trim()).filter(Boolean);
    for await (const obj of readJSONL(files))
      console.log(JSON.stringify(pickFields(obj, f)));
  });

program.command('count')
  .description('Count records')
  .argument('[files...]', 'Input files')
  .action(async (files: string[]) => {
    let n = 0;
    for await (const _ of readJSONL(files)) n++;
    console.log(n);
  });

program.command('sample <rate>')
  .description('Sample a fraction of records (0-1)')
  .argument('[files...]', 'Input files')
  .action(async (rate: string, files: string[]) => {
    const r = parseFloat(rate);
    if (isNaN(r) || r < 0 || r > 1) { console.error('Rate must be 0-1'); process.exit(1); }
    for await (const obj of readJSONL(files))
      if (Math.random() < r) console.log(JSON.stringify(obj));
  });

program.command('uniq <field>')
  .description('Show unique values for a field')
  .argument('[files...]', 'Input files')
  .action(async (field: string, files: string[]) => {
    const seen = new Set<string>();
    for await (const obj of readJSONL(files)) {
      const v = String(getNestedValue(obj, field));
      if (!seen.has(v)) { seen.add(v); console.log(v); }
    }
  });

program.command('stats')
  .description('Compute stats for a numeric field')
  .requiredOption('-f, --field <name>', 'Numeric field to analyze')
  .argument('[files...]', 'Input files')
  .action(async (files: string[], opts: { field: string }) => {
    const values: number[] = [];
    for await (const obj of readJSONL(files)) {
      const v = Number(getNestedValue(obj, opts.field));
      if (!isNaN(v)) values.push(v);
    }
    if (!values.length) { console.log('No numeric values found'); return; }
    values.sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);
    const p95idx = Math.floor(values.length * 0.95);
    console.log(JSON.stringify({
      field: opts.field, count: values.length,
      min: values[0], max: values[values.length - 1],
      mean: +(sum / values.length).toFixed(4),
      median: values[Math.floor(values.length / 2)],
      p95: values[Math.min(p95idx, values.length - 1)],
      sum: +sum.toFixed(4),
    }));
  });

program.command('flat')
  .description('Flatten nested JSON to dot-notation keys')
  .argument('[files...]', 'Input files')
  .action(async (files: string[]) => {
    for await (const obj of readJSONL(files))
      console.log(JSON.stringify(flatten(obj)));
  });

// ── New commands: sort, head, tail, pluck ──

program.command('sort <field>')
  .description('Sort records by a field (use -r for descending)')
  .argument('[files...]', 'Input files')
  .option('-r, --reverse', 'Sort descending')
  .option('-n, --numeric', 'Sort numerically (default: string)')
  .action(async (field: string, files: string[], opts: { reverse?: boolean; numeric?: boolean }) => {
    const records: Record<string, unknown>[] = [];
    for await (const obj of readJSONL(records.length < 100000 ? files : [])) records.push(obj);
    // read all if we didn't skip
    if (records.length === 0) {
      for await (const obj of readJSONL(files)) records.push(obj);
    }
    records.sort((a, b) => {
      const va = getNestedValue(a, field);
      const vb = getNestedValue(b, field);
      let cmp: number;
      if (opts.numeric) {
        cmp = (Number(va) || 0) - (Number(vb) || 0);
      } else {
        cmp = String(va ?? '').localeCompare(String(vb ?? ''));
      }
      return opts.reverse ? -cmp : cmp;
    });
    for (const obj of records) console.log(JSON.stringify(obj));
  });

program.command('head <n>')
  .description('Take the first N records')
  .argument('[files...]', 'Input files')
  .action(async (n: string, files: string[]) => {
    const limit = parseInt(n, 10);
    if (isNaN(limit) || limit < 0) { console.error('n must be a non-negative integer'); process.exit(1); }
    let count = 0;
    for await (const obj of readJSONL(files)) {
      if (count >= limit) break;
      console.log(JSON.stringify(obj));
      count++;
    }
  });

program.command('tail <n>')
  .description('Take the last N records')
  .argument('[files...]', 'Input files')
  .action(async (n: string, files: string[]) => {
    const limit = parseInt(n, 10);
    if (isNaN(limit) || limit < 0) { console.error('n must be a non-negative integer'); process.exit(1); }
    // circular buffer approach for memory efficiency
    const buf: string[] = [];
    let i = 0;
    for await (const obj of readJSONL(files)) {
      buf[i % limit] = JSON.stringify(obj);
      i++;
    }
    const start = Math.max(0, i - limit);
    for (let j = start; j < i; j++) console.log(buf[j % limit]);
  });

program.command('pluck <expr>')
  .description('Extract values using dot expressions (.field, .a.b, .a,.b for objects)')
  .argument('[files...]', 'Input files')
  .action(async (expr: string, files: string[]) => {
    for await (const obj of readJSONL(files)) {
      const result = evalExpr(obj, expr);
      if (result !== undefined) {
        console.log(typeof result === 'object' ? JSON.stringify(result) : String(result));
      }
    }
  });

program.command('rename <mapping>')
  .description('Rename fields (old:new,comma,separated)')
  .argument('[files...]', 'Input files')
  .action(async (mapping: string, files: string[]) => {
    const pairs = mapping.split(',').map(s => {
      const [from, to] = s.trim().split(':').map(p => p.trim());
      return { from, to };
    });
    for await (const obj of readJSONL(files)) {
      const out: Record<string, unknown> = { ...obj };
      for (const { from, to } of pairs) {
        const v = getNestedValue(obj, from);
        if (v !== undefined) {
          out[to] = v;
          // remove old key if top-level
          if (!from.includes('.') && from in out) delete out[from];
        }
      }
      console.log(JSON.stringify(out));
    }
  });

program.command('group <field>')
  .description('Group records by a field and count')
  .argument('[files...]', 'Input files')
  .action(async (field: string, files: string[]) => {
    const counts = new Map<string, number>();
    let total = 0;
    for await (const obj of readJSONL(files)) {
      const v = String(getNestedValue(obj, field) ?? '(undefined)');
      counts.set(v, (counts.get(v) || 0) + 1);
      total++;
    }
    const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    for (const [val, count] of entries) {
      const pct = +((count / total) * 100).toFixed(1);
      console.log(JSON.stringify({ [field]: val, count, percent: pct }));
    }
  });


program.command('schema')
  .description('Infer JSON schema from JSONL records')
  .argument('[files...]', 'Input files')
  .option('-s, --sample <n>', 'Sample N records for inference (default: all)', '0')
  .action(async (files: string[], opts: { sample: string }) => {
    const fieldTypes = new Map<string, Set<string>>();
    const fieldNull = new Map<string, number>();
    let total = 0;
    const limit = parseInt(opts.sample, 10) || Infinity;

    for await (const obj of readJSONL(files)) {
      if (total >= limit) break;
      total++;
      const flat = flatten(obj);
      for (const [k, v] of Object.entries(flat)) {
        if (!fieldTypes.has(k)) fieldTypes.set(k, new Set());
        if (v === null || v === undefined) {
          fieldNull.set(k, (fieldNull.get(k) || 0) + 1);
        } else {
          const t = Array.isArray(v) ? 'array' : typeof v;
          fieldTypes.get(k)!.add(t);
        }
      }
    }

    const schema: Record<string, unknown> = { type: 'object', properties: {} as Record<string, unknown> };
    const props = schema.properties as Record<string, unknown>;
    const allFields = [...fieldTypes.keys()].sort();

    for (const field of allFields) {
      const types = fieldTypes.get(field)!;
      const nullCount = fieldNull.get(field) || 0;
      const inferred = types.size === 0 ? ['null'] : [...types];
      const prop: Record<string, unknown> = {
        types: inferred,
        required: nullCount === 0,
        presence: +(((total - nullCount) / total) * 100).toFixed(1) + '%',
      };
      if (types.size === 1 && types.has('number')) {
        prop.note = 'integer candidates: check if values are always whole numbers';
      }
      props[field] = prop;
    }

    console.log(JSON.stringify({ recordCount: total, fields: allFields.length, schema }, null, 2));
  });

program.command('freq <field>')
  .description('Show top-N frequency distribution for a field')
  .argument('[files...]', 'Input files')
  .option('-n, --top <n>', 'Show top N values', '10')
  .action(async (field: string, files: string[], opts: { top: string }) => {
    const counts = new Map<string, number>();
    let total = 0;
    const topN = parseInt(opts.top, 10) || 10;

    for await (const obj of readJSONL(files)) {
      total++;
      const v = getNestedValue(obj, field);
      const key = v === undefined ? '(missing)' : String(v);
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    if (total === 0) { console.error('No records found'); process.exit(1); }

    const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN);
    const unique = counts.size;

    console.log(JSON.stringify({
      field, totalRecords: total, uniqueValues: unique,
      distribution: entries.map(([value, count]) => ({
        value,
        count,
        percent: +((count / total) * 100).toFixed(2),
      })),
    }, null, 2));
  });

program.parse();
