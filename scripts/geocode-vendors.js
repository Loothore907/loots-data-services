#!/usr/bin/env node
// scripts/geocode-vendors.js
const fs = require('fs');
const path = require('path');
const { program } = require('commander');
const { batchGeocodeVendors } = require('../services/geocoding');
const { normalizeVendor, validateVendor } = require('../models/vendor');
const logger = require('../utils/logger');
require('dotenv').config();

// Configure CLI options
program
  .description('Geocode vendor addresses to obtain coordinates')
  .requiredOption('-i, --input <path>', 'Input JSON file with vendor data')
  .requiredOption('-o, --output <path>', 'Output path for geocoded vendors')
  .option('-c, --concurrency <number>', 'Number of concurrent geocoding requests', '2')
  .option('-d, --delay <number>', 'Delay between batches in milliseconds', '200')
  .option('--skip-existing', 'Skip vendors that already have coordinates', false)
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
    const normalizedVendors = vendors.map(vendor => {
      const normalized = normalizeVendor(vendor);
      const { error } = validateVendor(normalized);
      
      if (error) {
        logger.warn(`Validation warning for vendor ${vendor.id || 'unknown'}: ${error.message}`);
      }
      
      return normalized;
    });
    
    // Filter vendors if skip-existing is enabled
    const vendorsToGeocode = options.skipExisting
      ? normalizedVendors.filter(v => !v.location.latitude || !v.location.longitude)
      : normalizedVendors;
    
    logger.info(`Geocoding ${vendorsToGeocode.length} vendors (${options.skipExisting ? 'skipping existing coordinates' : 'processing all'})`);
    
    // Geocode vendors
    const geocodeOptions = {
      concurrency: parseInt(options.concurrency, 10),
      delayMs: parseInt(options.delay, 10)
    };
    
    const result = await batchGeocodeVendors(vendorsToGeocode, geocodeOptions);
    
    // Log results
    logger.info(`Geocoding completed: ${result.stats.successful} successful, ${result.stats.failed} failed`);
    
    if (result.errors.length > 0) {
      logger.warn('Geocoding errors:', { errors: result.errors });
    }
    
    // Merge geocoded vendors with original list if skip-existing is enabled
    const finalVendors = options.skipExisting
      ? vendors.map(original => {
          const geocoded = result.vendors.find(v => v.id === original.id);
          return geocoded || original;
        })
      : result.vendors;
    
    // Write output file
    const outputPath = path.resolve(options.output);
    const outputDir = path.dirname(outputPath);
    
    // Create output directory if it doesn't exist
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    fs.writeFileSync(outputPath, JSON.stringify(finalVendors, null, 2));
    logger.info(`Saved ${finalVendors.length} vendors to ${outputPath}`);
    
  } catch (error) {
    logger.error('Error during geocoding process:', error);
    process.exit(1);
  }
}

main(); 