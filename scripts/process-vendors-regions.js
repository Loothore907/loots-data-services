#!/usr/bin/env node
// scripts/process-vendors-regions.js
const { program } = require('commander');
const path = require('path');
const fs = require('fs');
const { processVendors } = require('../workflows/process-vendors-updated');
const logger = require('../utils/logger');
require('dotenv').config();

// Configure CLI options
program
  .description('Process vendor data through complete workflow with priority region filtering')
  .requiredOption('-i, --input <path>', 'Input JSON file with vendor data')
  .option('-o, --output <path>', 'Output path for finalized vendors', './data/output/finalized-vendors.json')
  .option('-m, --mode <mode>', 'Sync mode (overwrite, append, update)', 'overwrite')
  .option('-c, --collection <name>', 'Firestore collection name', 'vendors')
  .option('--concurrency <number>', 'Number of concurrent geocoding requests', '2')
  .option('--delay <number>', 'Delay between geocoding batches in milliseconds', '200')
  .option('--skip-existing', 'Skip vendors that already have coordinates', true)
  .option('--sync', 'Sync to Firebase', false)
  .option('--priority-only', 'Process only vendors in priority regions', true)
  .option('--archive-non-priority', 'Archive non-priority vendors', true)
  .option('--clean-addresses', 'Clean addresses before geocoding', true)
  .option('--validate-coordinates', 'Validate coordinates after geocoding', true)  
  .option('-p, --provider <provider>', 'Geocoding provider (google, rapidapi, etc.)', '')
  .option('--dry-run', 'Validate and process data without writing to Firebase', false)
  .option('--save-categorized', 'Save vendors categorized by region to separate files', false)
  .option('--delete-after-archive', 'Delete files after archiving', true)
  .option('--delete-after-sync', 'Delete output file after successful sync', true)
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
    
    logger.info('Starting vendor processing workflow with region filtering');
    
    // Prepare workflow options
    const workflowOptions = {
      input: inputPath,
      output: path.resolve(options.output),
      priorityOnly: options.priorityOnly,
      archiveNonPriority: options.archiveNonPriority,
      cleanAddresses: options.cleanAddresses,
      validateCoordinates: options.validateCoordinates,
      syncMode: options.mode,
      collection: options.collection,
      geocodingConcurrency: parseInt(options.concurrency, 10),
      geocodingDelay: parseInt(options.delay, 10),
      provider: options.provider,
      skipExistingCoordinates: options.skipExisting,
      skipSync: !options.sync || options.dryRun,
      saveCategorized: options.saveCategorized,
      deleteAfterArchive: options.deleteAfterArchive,
      deleteAfterSync: options.deleteAfterSync
    };
    
    // Display options
    logger.info('Processing with options:', workflowOptions);
    
    // Run the workflow
    const result = await processVendors(workflowOptions);
    
    // Display results
    if (result.success) {
      logger.info('Processing completed successfully');
      logger.info('Stats:', result.stats);
      
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