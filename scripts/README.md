# CLI Scripts

This directory contains command-line interface (CLI) scripts for data processing and management tasks.

## Files
- `import-vendors.js` - Import and normalize vendor data from JSON/CSV
- `geocode-vendors.js` - Geocode vendor addresses to obtain coordinates
- `sync-firebase.js` - Sync processed vendor data to Firebase
- `process-all.js` - Complete workflow combining import, geocode, and sync

## Usage
All scripts can be run via npm scripts defined in package.json:

```bash
# Import vendors
npm run import -- --input=./data/input/vendors.json --output=./data/processed/normalized-vendors.json

# Geocode addresses
npm run geocode -- --input=./data/processed/normalized-vendors.json --output=./data/output/geocoded-vendors.json

# Sync to Firebase
npm run sync -- --input=./data/output/geocoded-vendors.json

# Run complete workflow
npm run process -- --input=./data/input/vendors.json
```

## Common Options
- `--input <path>` - Input file path
- `--output <path>` - Output file path
- `--format <format>` - Input format (json, csv)
- `--skip-existing` - Skip processing of existing data
- `--dry-run` - Validate without writing changes
- `--encoding <encoding>` - File encoding (utf8, latin1, etc.) 