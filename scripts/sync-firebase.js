#!/usr/bin/env node
// scripts/sync-firebase.js
const fs = require('fs');
const path = require('path');
const { program } = require('commander');
const { syncVendorsToFirestore } = require('../services/firebase');
const { normalizeVendor, validateVendor } = require('../models/vendor');
const logger = require('../utils/logger');
require('dotenv').config();

// Configure CLI options
program
  .description('Sync vendor data to Firebase Firestore')
  .requiredOption('-i, --input <path>', 'Input JSON file with vendor data')
  .option('-c, --collection <name>', 'Firestore collection name', 'vendors')
  .option('-b, --batch-size <number>', 'Batch size for Firestore operations', '500')
  .option('--no-merge', 'Replace documents instead of merging', false)
  .option('--dry-run', 'Validate data without writing to Firestore', false)
  .option('--cleanup', 'Remove input file after successful sync', false)
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
    
    // Read and parse input file
    logger.info(`Reading vendors from ${inputPath}`);
    const rawData = fs.readFileSync(inputPath, 'utf8');
    const vendors = JSON.parse(rawData);
    
    if (!Array.isArray(vendors)) {
      logger.error('Input file must contain an array of vendors');
      process.exit(1);
    }
    
    logger.info(`Found ${vendors.length} vendors to process`);
    
    // Normalize and validate vendors
    const validVendors = [];
    const invalidVendors = [];
    
    vendors.forEach(vendor => {
      const normalized = normalizeVendor(vendor);
      const { error } = validateVendor(normalized);
      
      if (error) {
        logger.warn(`Validation error for vendor ${vendor.id || 'unknown'}: ${error.message}`);
        invalidVendors.push({ vendor, errors: error.details });
      } else {
        validVendors.push(normalized);
      }
    });
    
    logger.info(`Validation complete: ${validVendors.length} valid, ${invalidVendors.length} invalid`);
    
    if (invalidVendors.length > 0) {
      logger.warn('Some vendors failed validation and will be skipped');
      
      // Write invalid vendors to file for review
      const invalidPath = path.join(path.dirname(inputPath), 'invalid-vendors.json');
      fs.writeFileSync(invalidPath, JSON.stringify(invalidVendors, null, 2));
      logger.info(`Invalid vendors written to ${invalidPath} for review`);
    }
    
    if (options.dryRun) {
      logger.info('Dry run completed. No data was written to Firestore.');
      return;
    }
    
    // Sync to Firestore
    logger.info(`Syncing ${validVendors.length} vendors to Firestore collection '${options.collection}'`);
    
    const syncOptions = {
      collection: options.collection,
      batchSize: parseInt(options.batchSize, 10),
      merge: options.merge
    };
    
    const result = await syncVendorsToFirestore(validVendors, syncOptions);
    
    if (result.success) {
      logger.info(`Sync completed successfully: ${result.stats.successful} vendors synced`);
      
      // Optionally remove the input file after successful sync
      if (options.cleanup) {
        try {
          fs.unlinkSync(options.input);
          logger.info(`Removed original input file at ${options.input} after successful sync`);
        } catch (error) {
          logger.warn(`Could not remove input file: ${error.message}`);
        }
      }
    } else {
      logger.error(`Sync failed: ${result.error}`);
      process.exit(1);
    }
    
    // Add this after loading vendors
    if (vendors.length > 0) {
      console.log('Sample vendor structure:');
      const sampleVendor = vendors[0];
      console.log(JSON.stringify({
        id: sampleVendor.id,
        name: sampleVendor.name,
        location: sampleVendor.location
      }, null, 2));
    }
    
  } catch (error) {
    logger.error('Error during sync process:', error);
    process.exit(1);
  }
}

main(); 