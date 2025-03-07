# Workflows

This directory contains composed workflow modules that combine multiple services into complete data processing pipelines.

## Files
- `process-vendors.js` - Complete vendor processing workflow (import → geocode → sync)

## Features
- End-to-end data processing
- Error handling and recovery
- Progress tracking and logging
- Configurable workflow steps
- Support for dry runs and partial processing

## Usage Example
```javascript
const { processVendors } = require('./process-vendors');

const result = await processVendors({
  input: './data/input/vendors.json',
  output: './data/output/failed-geocoding.json',
  syncMode: 'overwrite',
  collection: 'vendors',
  geocodingConcurrency: 2,
  geocodingDelay: 200,
  skipExistingCoordinates: true,
  skipSync: false
});

console.log('Processing results:', result.stats);
```

## Configuration Options
- `input` - Input file path
- `output` - Output path for failed records
- `syncMode` - Firebase sync mode ('overwrite', 'merge', 'update')
- `collection` - Firestore collection name
- `geocodingConcurrency` - Number of concurrent geocoding requests
- `geocodingDelay` - Delay between geocoding batches (ms)
- `skipExistingCoordinates` - Skip records that already have coordinates
- `skipSync` - Skip the Firebase sync step 