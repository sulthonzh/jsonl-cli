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

program.name('jsonl').description('CLI toolkit for JSON Lines files').version('1.0.0');

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
    console.log(JSON.stringify({
      field: opts.field, count: values.length,
      min: values[0], max: values[values.length - 1],
      mean: +(sum / values.length).toFixed(4),
      median: values[Math.floor(values.length / 2)],
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

program.parse();
