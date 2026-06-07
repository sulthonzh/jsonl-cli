# jsonl — CLI toolkit for JSON Lines

Work with JSONL (JSON Lines / newline-delimited JSON) files directly from your terminal.

Most log systems, event streams, and data pipelines emit JSONL. `jsonl` gives you a fast, pipe-friendly CLI to slice through them — no `jq` cheatsheet needed.

## Install

```bash
npm install -g jsonl-cli
```

## Usage

All commands read from **stdin** if no files are given. Pipe freely.

### Pretty-print

```bash
cat logs.jsonl | jsonl pretty --color
```

### Filter

```bash
# exact match
cat logs.jsonl | jsonl filter 'level=error'

# regex
cat logs.jsonl | jsonl filter 'message=~timeout'

# numeric comparison
cat logs.jsonl | jsonl filter 'status>=400'
```

Supported operators: `=`, `!=`, `>`, `<`, `>=`, `<=`, `=~` (regex)

### Select fields

```bash
cat logs.jsonl | jsonl select 'timestamp,message'
```

Dot-notation for nested fields:

```bash
cat logs.jsonl | jsonl select 'user.id,user.email'
```

### Pluck (jq-like expressions)

```bash
# single field → outputs raw value
cat logs.jsonl | jsonl pluck '.message'

# nested
cat logs.jsonl | jsonl pluck '.user.email'

# multiple fields → outputs JSON object
cat logs.jsonl | jsonl pluck '.timestamp,.level'
```

### Sort

```bash
# ascending (string sort)
cat logs.jsonl | jsonl sort timestamp

# numeric descending
cat logs.jsonl | jsonl sort response_time --numeric --reverse
```

### Head / Tail

```bash
# first 10 records
cat logs.jsonl | jsonl head 10

# last 5 records
cat logs.jsonl | jsonl tail 5
```

### Count records

```bash
cat logs.jsonl | jsonl count
```

### Group by field

```bash
# count records per level
cat logs.jsonl | jsonl group level
# {"level":"error","count":23,"percent":4.6}
# {"level":"info","count":450,"percent":90.0}
```

### Rename fields

```bash
cat logs.jsonl | jsonl rename 'msg:message,ts:timestamp'
```

### Sample

```bash
# keep ~10% of records
cat logs.jsonl | jsonl sample 0.1
```

### Unique values

```bash
cat logs.jsonl | jsonl uniq level
```

### Stats

```bash
# numeric stats for a field (includes p95)
cat logs.jsonl | jsonl stats --field response_time
# → {"field":"response_time","count":1500,"min":12,"max":4500,"mean":234.5,"median":180,"p95":890,"sum":351750}
```

### Flatten

```bash
cat nested.jsonl | jsonl flat
# {"user.name":"Sulthon","user.email":"test@example.com"}
```

## Why this exists

I work with JSONL files constantly — server logs, analytics exports, event streams. The usual workflow was `jq` one-liners I could never remember, or opening files in an editor and scrolling. `jsonl` gives me the 80% case in memorable commands.

## Real examples

```bash
# How many errors today?
cat production.log | jsonl filter 'level=error' | jsonl count

# What unique status codes appeared?
cat api.jsonl | jsonl uniq status

# Top 5 slowest requests
cat api.jsonl | jsonl sort response_time --numeric --reverse | jsonl head 5

# Breakdown by status code
cat api.jsonl | jsonl group status

# Sample 5% of traffic for analysis
cat traffic.jsonl | jsonl sample 0.05 > sample.jsonl

# Pull just the error messages
cat logs.jsonl | jsonl filter 'level=error' | jsonl pluck '.message'
```

## Commands

| Command | What it does |
|---------|-------------|
| `pretty` | Pretty-print with optional colors |
| `filter` | Filter by field value |
| `select` | Pick specific fields |
| `pluck` | Extract values with dot expressions |
| `sort` | Sort by field (asc/desc, string/numeric) |
| `head` | Take first N records |
| `tail` | Take last N records |
| `count` | Count records |
| `group` | Group by field with counts and percentages |
| `rename` | Rename fields |
| `sample` | Random sample |
| `uniq` | Unique values for a field |
| `stats` | Numeric stats (min, max, mean, median, p95) |
| `flat` | Flatten nested objects |

## License

MIT
