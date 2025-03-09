#!/usr/bin/env node
// scripts/import-vendors.js
const fs = require('fs');
const path = require('path');
const { program } = require('commander');
const { normalizeVendor, validateVendor } = require('../models/vendor');
const logger = require('../utils/logger');
const { cleanAddressForGeocoding } = require('../utils/address-cleaner');
require('dotenv').config();

// Configure CLI options
program
  .description('Import and normalize vendor data from various sources')
  .option('-i, --input <path>', 'Input file with vendor data (optional, will use first JSON file in data/input if not specified)')
  .option('-o, --output <path>', 'Output path for normalized vendors (optional, will use timestamped path if not specified)')
  .option('-f, --format <format>', 'Input format (json, csv)', 'json')
  .option('--validate', 'Validate vendors against schema', true)
  .parse(process.argv);

const options = program.opts();

// Simple CSV parser (for basic CSV files)
function parseCSV(content) {
  const lines = content.split('\n').filter(line => line.trim());
  const headers = lines[0].split(',').map(h => h.trim());
  
  return lines.slice(1).map(line => {
    const values = line.split(',').map(v => v.trim());
    const vendor = {};
    
    headers.forEach((header, index) => {
      vendor[header] = values[index] || '';
    });
    
    // Transform to match expected schema structure
    return {
      id: vendor.id || vendor.business_id,
      name: vendor.name || vendor.business_name,
      business_license: vendor.business_license || vendor.license,
      license_type: vendor.license_type || vendor.type,
      status: vendor.status,
      location: {
        address: vendor.address || `${vendor.street || ''}, ${vendor.city || ''}, ${vendor.state || ''} ${vendor.zip || ''}`.trim(),
        latitude: parseFloat(vendor.latitude) || null,
        longitude: parseFloat(vendor.longitude) || null
      },
      contact: {
        phone: vendor.phone,
        email: vendor.email,
        social: {
          instagram: vendor.instagram,
          facebook: vendor.facebook
        }
      }
    };
  });
}

async function main() {
  try {
    // Find current input file (could be parameterized or use the only file in the directory)
    const inputDir = path.resolve('./data/input');
    let inputFiles = fs.readdirSync(inputDir).filter(f => 
      f.endsWith('.json') && !f.startsWith('.') && f !== '.gitkeep'
    );
    
    if (inputFiles.length === 0) {
      logger.error('No input files found in ./data/input');
      process.exit(1);
    }
    
    // Use the first file or a specified one
    let inputPath;
    if (options.input) {
      // Check if input is a full path or just a filename
      inputPath = path.isAbsolute(options.input) ? options.input : path.join(inputDir, path.basename(options.input));
    } else {
      inputPath = path.join(inputDir, inputFiles[0]);
    }
    
    if (!fs.existsSync(inputPath)) {
      logger.error(`Input file not found: ${inputPath}`);
      process.exit(1);
    }
    
    // Read input file
    logger.info(`Reading data from ${inputPath}`);
    const rawData = fs.readFileSync(inputPath, 'utf8');
    
    // Parse based on format
    let vendors = [];
    if (options.format.toLowerCase() === 'json') {
      vendors = JSON.parse(rawData);
      if (!Array.isArray(vendors)) {
        logger.error('Input JSON must contain an array of vendors');
        process.exit(1);
      }
    } else if (options.format.toLowerCase() === 'csv') {
      vendors = parseCSV(rawData);
    } else {
      logger.error(`Unsupported format: ${options.format}`);
      process.exit(1);
    }
    
    logger.info(`Found ${vendors.length} vendors to process`);
    
    // Filter out revoked vendors with case-insensitive comparison
    const activeVendors = vendors.filter(vendor => 
      (vendor.status || '').toLowerCase() !== 'revoked'
    );
    
    const revokedVendors = vendors.filter(vendor => 
      (vendor.status || '').toLowerCase() === 'revoked'
    );
    
    logger.info(`Found ${vendors.length} total vendors: ${activeVendors.length} active, ${revokedVendors.length} revoked`);
    
    // Process active vendors as normal
    const normalizedVendors = [];
    const invalidVendors = [];
    
    activeVendors.forEach(vendor => {
      try {
        // Clean the address before normalization if it exists
        if (vendor.location && vendor.location.address) {
          const { cleaned, wasModified, modifications, extractedZip } = cleanAddressForGeocoding(vendor.location.address);
          if (wasModified) {
            logger.debug(`Cleaned address for vendor ${vendor.id || vendor.business_license || 'unknown'}:`);
            logger.debug(`  Original: "${vendor.location.address}"`);
            logger.debug(`  Cleaned:  "${cleaned}"`);
            logger.debug(`  Changes:  ${modifications.join(', ')}`);
            vendor.location.address = cleaned;
          }
          
          // Add the extracted ZIP code if available
          if (extractedZip) {
            vendor.location.zip = extractedZip;
            logger.debug(`  Extracted ZIP: ${extractedZip}`);
          }
        }

        const normalized = normalizeVendor(vendor);
        
        if (options.validate) {
          const { error } = validateVendor(normalized);
          
          if (error) {
            logger.warn(`Validation error for vendor ${vendor.id || 'unknown'}: ${error.message}`);
            invalidVendors.push({ vendor, errors: error.details });
            return;
          }
        }
        
        normalizedVendors.push(normalized);
      } catch (error) {
        logger.error(`Error processing vendor ${vendor.id || 'unknown'}: ${error.message}`);
        invalidVendors.push({ vendor, errors: [{ message: error.message }] });
      }
    });
    
    logger.info(`Normalization complete: ${normalizedVendors.length} valid, ${invalidVendors.length} invalid`);
    
    // Save revoked vendors to failures directory
    if (revokedVendors.length > 0) {
      const failuresDir = path.resolve('./data/failures');
      if (!fs.existsSync(failuresDir)) {
        fs.mkdirSync(failuresDir, { recursive: true });
      }
      
      // Define the path for the revoked vendors file (non-timestamped for persistence)
      const revokedPath = path.join(failuresDir, 'revoked_vendors.json');
      
      // Check if the file already exists
      let existingRevoked = [];
      let newCount = 0;
      let updatedCount = 0;
      
      if (fs.existsSync(revokedPath)) {
        try {
          // Load existing revoked vendors
          existingRevoked = JSON.parse(fs.readFileSync(revokedPath, 'utf8'));
          logger.info(`Loaded ${existingRevoked.length} existing revoked vendors from ${revokedPath}`);
          
          // Create a map of existing vendors by business license for quick lookup
          const existingMap = new Map();
          existingRevoked.forEach(vendor => {
            const key = vendor.business_license || vendor.id;
            if (key) {
              existingMap.set(key, vendor);
            }
          });
          
          // Process new revoked vendors
          revokedVendors.forEach(vendor => {
            const key = vendor.business_license || vendor.id;
            
            if (!key) {
              // No identifier, just add as new
              existingRevoked.push(vendor);
              newCount++;
              logger.debug(`Added new revoked vendor without identifier: ${vendor.name || 'unknown'}`);
            } else if (existingMap.has(key)) {
              // Update existing vendor
              const index = existingRevoked.findIndex(v => 
                (v.business_license || v.id) === key
              );
              
              if (index !== -1) {
                // Merge the records, keeping the existing data but updating with new data
                existingRevoked[index] = {
                  ...existingRevoked[index],
                  ...vendor,
                  lastUpdated: new Date().toISOString()
                };
                updatedCount++;
                logger.debug(`Updated existing revoked vendor: ${key} (${vendor.name || 'unknown'})`);
              }
            } else {
              // Add new vendor
              vendor.lastUpdated = new Date().toISOString();
              existingRevoked.push(vendor);
              newCount++;
              logger.debug(`Added new revoked vendor: ${key} (${vendor.name || 'unknown'})`);
            }
          });
          
        } catch (error) {
          logger.warn(`Error reading existing revoked vendors file: ${error.message}`);
          logger.warn('Creating new revoked vendors file instead');
          existingRevoked = revokedVendors;
          newCount = revokedVendors.length;
        }
      } else {
        // No existing file, use all new revoked vendors
        existingRevoked = revokedVendors;
        newCount = revokedVendors.length;
      }
      
      // Write the updated revoked vendors file
      fs.writeFileSync(revokedPath, JSON.stringify(existingRevoked, null, 2));
      logger.info(`Saved ${existingRevoked.length} revoked vendors to ${revokedPath} (${newCount} new, ${updatedCount} updated)`);
      
      // Also create a timestamped backup
      const timestamp = new Date().toISOString().replace(/[:\.]/g, '-');
      const revokedBackupPath = path.join(failuresDir, `revoked_vendors_${timestamp}.json`);
      fs.writeFileSync(revokedBackupPath, JSON.stringify(existingRevoked, null, 2));
      logger.info(`Created backup of revoked vendors at ${revokedBackupPath}`);
    }
    
    // Save invalid vendors for review
    if (invalidVendors.length > 0) {
      logger.warn('Some vendors failed validation and will be skipped');
      
      // Write invalid vendors to file for review
      const failuresDir = path.resolve('./data/failures');
      if (!fs.existsSync(failuresDir)) {
        fs.mkdirSync(failuresDir, { recursive: true });
      }
      
      const timestamp = new Date().toISOString().replace(/[:\.]/g, '-');
      const invalidPath = path.join(failuresDir, `invalid_vendors_${timestamp}.json`);
      fs.writeFileSync(invalidPath, JSON.stringify(invalidVendors, null, 2));
      logger.info(`Invalid vendors written to ${invalidPath} for review`);
    }
    
    // For the processed directory, only save one file - the latest
    const outputDir = path.resolve('./data/processed');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const latestPath = path.join(outputDir, 'norm_vendors_latest.json');
    fs.writeFileSync(latestPath, JSON.stringify(normalizedVendors, null, 2));
    logger.info(`Saved ${normalizedVendors.length} normalized vendors to ${latestPath}`);
    
    // Also create a timestamped copy in the archive directory
    const archiveDir = path.join(outputDir, 'archive');
    if (!fs.existsSync(archiveDir)) {
      fs.mkdirSync(archiveDir, { recursive: true });
    }
    
    const timestamp = new Date().toISOString().replace(/[:\.]/g, '-');
    const archivedOutputPath = path.join(archiveDir, `norm_vendors_${timestamp}.json`);
    fs.writeFileSync(archivedOutputPath, JSON.stringify(normalizedVendors, null, 2));
    logger.info(`Archived processed output to ${archivedOutputPath}`);
    
    // Archive the input file
    const inputArchiveDir = path.join(inputDir, 'archive');
    if (!fs.existsSync(inputArchiveDir)) {
      fs.mkdirSync(inputArchiveDir, { recursive: true });
    }
    
    const archivedInputPath = path.join(inputArchiveDir, `${path.basename(inputPath, '.json')}_processed_${timestamp}.json`);
    fs.copyFileSync(inputPath, archivedInputPath);
    fs.unlinkSync(inputPath); // Remove from input directory
    logger.info(`Archived input file to ${archivedInputPath}`);
    
  } catch (error) {
    logger.error('Error during import process:', error);
    process.exit(1);
  }
}

main(); 