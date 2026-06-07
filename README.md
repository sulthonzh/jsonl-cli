# jsonl — CLI toolkit for JSON Lines

Work with JSONL (JSON Lines / newline-delimited JSON) files directly from your terminal.

Most log systems, event streams, and data pipelines emit JSONL. `jsonl` gives you a fast, pipe-friendly CLI to slice through them.

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

### Count records

```bash
cat logs.jsonl | jsonl count
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
# overall count
cat logs.jsonl | jsonl stats

# numeric stats for a field
cat logs.jsonl | jsonl stats response_time
# → {"field":"response_time","count":1500,"min":12,"max":4500,"mean":234.5,"median":180,"sum":351750}
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

# Sample 5% of traffic for analysis
cat requests.jsonl | jsonl sample 0.05 > sampled.jsonl

# Quick stats on response times
cat access.jsonl | jsonl stats response_time
```

## License

MIT
