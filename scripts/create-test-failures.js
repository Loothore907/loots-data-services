#!/usr/bin/env node
// scripts/create-test-failures.js
const fs = require('fs');
const path = require('path');
const { program } = require('commander');
const logger = require('../utils/logger');

program
  .description('Create test failures by corrupting addresses in geocoded vendors')
  .requiredOption('-i, --input <path>', 'Successfully geocoded vendors file')
  .requiredOption('-o, --output <path>', 'Output path for test file with corrupted addresses')
  .option('-n, --number <count>', 'Number of addresses to corrupt', '10')
  .option('--seed <seed>', 'Random seed for reproducible corruption', Date.now().toString())
  .parse(process.argv);

const options = program.opts();

// Simple random number generator with seed
function createRandom(seed) {
  let state = parseInt(seed, 10) || Date.now();
  return function() {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

async function main() {
  try {
    // Read vendors
    logger.info(`Reading vendors from ${options.input}`);
    const rawData = fs.readFileSync(path.resolve(options.input), 'utf8');
    const vendors = JSON.parse(rawData);
    
    // How many to corrupt
    const count = Math.min(parseInt(options.number), vendors.length);
    logger.info(`Will corrupt ${count} addresses out of ${vendors.length}`);
    
    // Create a copy of the vendors array
    const modifiedVendors = JSON.parse(JSON.stringify(vendors));
    
    // Create seeded random function
    const random = createRandom(options.seed);
    
    // Generate random indices to corrupt
    const indicesToCorrupt = new Set();
    while (indicesToCorrupt.size < count) {
      indicesToCorrupt.add(Math.floor(random() * vendors.length));
    }
    
    // Different ways to corrupt addresses
    const corruptionMethods = [
      // Method 1: Add nonexistent place
      (address) => `${address} NONEXISTENT PLACE 12345`,
      
      // Method 2: Modify the street number
      (address) => address.replace(/^\d+/, (match) => parseInt(match) + 9000),
      
      // Method 3: Add a bogus building/unit
      (address) => address.replace(/(,|$)/, ', Building Z, Unit 999$1'),
      
      // Method 4: Change city name
      (address) => address.replace(/,\s*([^,]+),\s*AK/, ', Nonexistentville, AK'),
      
      // Method 5: Completely scramble the address
      (address) => `123 Fake Street, Nowhere Land, XX 00000`
    ];
    
    // Corrupt the selected addresses
    indicesToCorrupt.forEach(index => {
      const vendor = modifiedVendors[index];
      
      // Skip if no location or address
      if (!vendor.location || !vendor.location.address) return;
      
      // Save original values for reference
      vendor.originalAddress = vendor.location.address;
      
      // Pick a random corruption method
      const corruptionMethod = corruptionMethods[Math.floor(random() * corruptionMethods.length)];
      
      // Corrupt the address
      vendor.location.address = corruptionMethod(vendor.location.address);
      
      // Remove coordinates if they exist in either structure
      if (vendor.location.coordinates) {
        vendor.location.coordinates.latitude = null;
        vendor.location.coordinates.longitude = null;
      }
      
      if (vendor.location.latitude !== undefined) {
        vendor.location.latitude = null;
        vendor.location.longitude = null;
      }
      
      // Make sure the failed flag is set
      vendor.hasValidCoordinates = false;
      
      logger.info(`Corrupted address for ${vendor.name} (${vendor.id}):`);
      logger.info(`  Original: ${vendor.originalAddress}`);
      logger.info(`  Corrupted: ${vendor.location.address}`);
    });
    
    // Create output directory if it doesn't exist
    const outputPath = path.resolve(options.output);
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Write the modified vendors file
    fs.writeFileSync(outputPath, JSON.stringify(modifiedVendors, null, 2));
    logger.info(`Saved file with ${count} corrupted addresses to ${outputPath}`);
    
  } catch (error) {
    logger.error('Error creating test failures:', error);
    process.exit(1);
  }
}

main();