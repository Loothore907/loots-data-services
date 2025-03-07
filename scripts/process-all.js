#!/usr/bin/env node
// scripts/process-all.js
const { program } = require('commander');
const path = require('path');
const fs = require('fs');
const { processVendors } = require('../workflows/process-vendors');
const logger = require('../utils/logger');
require('dotenv').config();

// Configure CLI options
program
  .description('Process vendor data through the complete workflow (import, geocode, transform, sync)')
  .requiredOption('-i, --input <path>', 'Input JSON file with vendor data')
  .option('-o, --output <path>', 'Output path for failed vendors', './data/output/failed-geocoding.json')
  .option('-m, --mode <mode>', 'Sync mode (overwrite, append, update)', 'overwrite')
  .option('-c, --collection <name>', 'Firestore collection name', 'vendors')
  .option('--concurrency <number>', 'Number of concurrent geocoding requests', '2')
  .option('--delay <number>', 'Delay between geocoding batches in milliseconds', '200')
  .option('--skip-existing', 'Skip vendors that already have coordinates', true)
  .option('--no-sync', 'Skip syncing to Firebase (process data only)', false)
  .option('--dry-run', 'Validate and process data without writing to Firebase', false)
  .option('-p, --provider <provider>', 'Geocoding provider (google, rapidapi, etc.)', '')
  .parse(process.argv);

const options = program.opts();

async function main() {
  try {
    // Validate input file exists
    const inputPath = path.resolve(options.input);
    if (!fs.existsSync(inputPath)) {
      logger.error(`Input file not found: ${inputPath}`);
      process.exit(1);
    }
    
    logger.info('Starting vendor processing workflow');
    
    // Prepare workflow options
    const workflowOptions = {
      input: inputPath,
      output: path.resolve(options.output),
      syncMode: options.mode,
      collection: options.collection,
      geocodingConcurrency: parseInt(options.concurrency, 10),
      geocodingDelay: parseInt(options.delay, 10),
      geocodingProvider: options.provider,
      skipExistingCoordinates: options.skipExisting,
      skipSync: !options.sync || options.dryRun
    };
    
    // Display options
    logger.info('Processing with options:', workflowOptions);
    
    // Run the workflow
    const result = await processVendors(workflowOptions);
    
    // Display results
    if (result.success) {
      logger.info('Processing completed successfully');
      logger.info('Stats:', result.stats);
      
      // Provide info on where to find the data
      if (result.stats.failed > 0) {
        logger.info(`Failed vendors saved to: ${workflowOptions.output}`);
      }
      
      if (options.dryRun) {
        logger.info('This was a dry run. No data was written to Firebase.');
      } else if (options.sync) {
        logger.info(`${result.stats.synced} vendors synced to Firebase collection: ${options.collection}`);
      }
    } else {
      logger.error(`Processing failed: ${result.error}`);
      process.exit(1);
    }
    
  } catch (error) {
    logger.error('Error during processing:', error);
    process.exit(1);
  }
}

main();