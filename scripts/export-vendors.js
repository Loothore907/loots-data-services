#!/usr/bin/env node
// scripts/export-vendors.js
const fs = require('fs');
const path = require('path');
const { program } = require('commander');
const logger = require('../utils/logger');
require('dotenv').config();

// Configure CLI options
program
  .description('Export vendors data to a JSON file')
  .option('-i, --input <path>', 'Input file with vendor data (optional, will use latest processed data if not specified)')
  .option('-o, --output <path>', 'Output path for exported vendors (required)')
  .option('-p, --pretty', 'Pretty print JSON output', false)
  .option('-d, --data-dir <path>', 'Directory to search for vendor files (default: ./data)', './data')
  .parse(process.argv);

const options = program.opts();

// Validate required options
if (!options.output) {
  logger.error('Output path is required. Use --output or -o option.');
  process.exit(1);
}

async function main() {
  try {
    // Determine input file
    let inputPath;
    if (options.input) {
      inputPath = path.isAbsolute(options.input) ? options.input : path.resolve(options.input);
    } else {
      // Search for vendor files in multiple directories
      const searchDirs = [
        path.resolve(options.dataDir, 'output'),
        path.resolve(options.dataDir, 'processed'),
        path.resolve(options.dataDir, 'input'),
        path.resolve(options.dataDir)
      ];
      
      let vendorFiles = [];
      
      for (const dir of searchDirs) {
        if (fs.existsSync(dir)) {
          const files = fs.readdirSync(dir)
            .filter(f => f.endsWith('.json') && !f.startsWith('.'))
            .map(f => ({
              path: path.join(dir, f),
              mtime: fs.statSync(path.join(dir, f)).mtime.getTime()
            }));
          
          vendorFiles = [...vendorFiles, ...files];
        }
      }
      
      // Sort by modification time, newest first
      vendorFiles.sort((a, b) => b.mtime - a.mtime);
      
      if (vendorFiles.length === 0) {
        logger.error(`No vendor files found in ${options.dataDir} subdirectories`);
        process.exit(1);
      }
      
      inputPath = vendorFiles[0].path;
      logger.info(`Using most recent file: ${path.basename(inputPath)}`);
    }
    
    // Ensure output directory exists
    const outputDir = path.dirname(options.output);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Read vendors data
    logger.info(`Reading vendors from ${inputPath}`);
    const rawData = fs.readFileSync(inputPath, 'utf8');
    let vendors;
    
    try {
      vendors = JSON.parse(rawData);
    } catch (error) {
      logger.error(`Failed to parse JSON from ${inputPath}`);
      throw error;
    }
    
    // Handle both array of vendors and object with vendors property
    if (!Array.isArray(vendors)) {
      if (vendors.vendors && Array.isArray(vendors.vendors)) {
        vendors = vendors.vendors;
      } else {
        logger.warn('Input file does not contain an array of vendors. Attempting to export anyway.');
      }
    }
    
    // Write to output file
    const outputPath = path.isAbsolute(options.output) ? options.output : path.resolve(options.output);
    const indent = options.pretty ? 2 : 0;
    fs.writeFileSync(outputPath, JSON.stringify(vendors, null, indent));
    
    const count = Array.isArray(vendors) ? vendors.length : 'unknown';
    logger.info(`
Export complete:
- ${count} vendors exported
- Saved to: ${outputPath}
    `);
    
  } catch (error) {
    logger.error('Error exporting vendors:', error);
    process.exit(1);
  }
}

main(); 