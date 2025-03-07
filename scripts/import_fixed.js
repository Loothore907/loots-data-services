#!/usr/bin/env node
// scripts/import_fixed.js
const fs = require('fs');
const path = require('path');
const { program } = require('commander');
const { normalizeVendor, validateVendor } = require('../models/vendor_new');
const logger = require('../utils/logger');
require('dotenv').config();

// Configure CLI options
program
  .description('Import and normalize vendor data from various sources')
  .requiredOption('-i, --input <path>', 'Input file with vendor data')
  .requiredOption('-o, --output <path>', 'Output path for normalized vendors')
  .option('-f, --format <format>', 'Input format (json, csv)', 'json')
  .option('--validate', 'Validate vendors against schema', true)
  .option('--encoding <encoding>', 'File encoding', 'utf8')
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
        coordinates: {
          latitude: parseFloat(vendor.latitude) || null,
          longitude: parseFloat(vendor.longitude) || null
        }
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

// Function to remove BOM if present
function removeBOM(content) {
  if (content.charCodeAt(0) === 0xFEFF) {
    return content.slice(1);
  }
  return content;
}

async function main() {
  try {
    // Validate input file exists
    const inputPath = path.resolve(options.input);
    if (!fs.existsSync(inputPath)) {
      logger.error(`Input file not found: ${inputPath}`);
      process.exit(1);
    }
    
    // Read input file
    console.log(`Reading data from ${inputPath} with encoding ${options.encoding}`);
    
    // Try to read the file as a buffer first
    const buffer = fs.readFileSync(inputPath);
    
    // Try different encodings if specified encoding fails
    let rawData;
    try {
      rawData = buffer.toString(options.encoding);
      // Remove BOM if present
      rawData = removeBOM(rawData);
    } catch (e) {
      console.warn(`Error reading with ${options.encoding} encoding, trying utf8...`);
      rawData = buffer.toString('utf8');
      rawData = removeBOM(rawData);
    }
    
    // Parse based on format
    let vendors = [];
    if (options.format.toLowerCase() === 'json') {
      try {
        vendors = JSON.parse(rawData);
      } catch (e) {
        console.error(`Error parsing JSON: ${e.message}`);
        console.log('First 100 characters of file:');
        console.log(rawData.substring(0, 100).replace(/[^\x20-\x7E]/g, '?'));
        process.exit(1);
      }
      
      if (!Array.isArray(vendors)) {
        console.error('Input JSON must contain an array of vendors');
        process.exit(1);
      }
    } else if (options.format.toLowerCase() === 'csv') {
      vendors = parseCSV(rawData);
    } else {
      console.error(`Unsupported format: ${options.format}`);
      process.exit(1);
    }
    
    console.log(`Found ${vendors.length} vendors to process`);
    
    // Normalize and validate vendors
    const normalizedVendors = [];
    const invalidVendors = [];
    
    vendors.forEach(vendor => {
      try {
        const normalized = normalizeVendor(vendor);
        
        if (options.validate) {
          const { error } = validateVendor(normalized);
          
          if (error) {
            console.warn(`Validation error for vendor ${vendor.id || 'unknown'}: ${error.message}`);
            invalidVendors.push({ vendor, errors: error.details });
            return;
          }
        }
        
        normalizedVendors.push(normalized);
      } catch (error) {
        console.error(`Error processing vendor ${vendor.id || 'unknown'}: ${error.message}`);
        invalidVendors.push({ vendor, errors: [{ message: error.message }] });
      }
    });
    
    console.log(`Normalization complete: ${normalizedVendors.length} valid, ${invalidVendors.length} invalid`);
    
    if (invalidVendors.length > 0) {
      console.warn('Some vendors failed validation and will be skipped');
      
      // Write invalid vendors to file for review
      const invalidPath = path.join(path.dirname(options.output), 'invalid-vendors.json');
      fs.writeFileSync(invalidPath, JSON.stringify(invalidVendors, null, 2));
      console.log(`Invalid vendors written to ${invalidPath} for review`);
    }
    
    // Write output file
    const outputPath = path.resolve(options.output);
    const outputDir = path.dirname(outputPath);
    
    // Create output directory if it doesn't exist
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    fs.writeFileSync(outputPath, JSON.stringify(normalizedVendors, null, 2));
    console.log(`Saved ${normalizedVendors.length} normalized vendors to ${outputPath}`);
    
  } catch (error) {
    console.error('Error during import process:', error);
    process.exit(1);
  }
}

main(); 