// scripts/finalize-vendors.js
const fs = require('fs');
const path = require('path');
const { program } = require('commander');
const logger = require('../utils/logger');

program
  .description('Combine and finalize vendor data for Firebase sync')
  .requiredOption('-i, --input <path>', 'Primary geocoded vendors file')
  .option('-r, --retry <path>', 'Retry geocoded vendors file')
  .requiredOption('-o, --output <path>', 'Output path for finalized vendors')
  .option('-a, --archive', 'Archive previous final vendors file', false)
  .parse(process.argv);

const options = program.opts();

async function main() {
  try {
    // Read primary geocoded vendors
    logger.info(`Reading primary vendors from ${options.input}`);
    const primaryData = fs.readFileSync(path.resolve(options.input), 'utf8');
    const primaryVendors = JSON.parse(primaryData);
    
    let allVendors = [...primaryVendors];
    
    // Read retry vendors if provided
    if (options.retry) {
      logger.info(`Reading retry vendors from ${options.retry}`);
      const retryData = fs.readFileSync(path.resolve(options.retry), 'utf8');
      const retryVendors = JSON.parse(retryData);
      
      // Merge by replacing vendors with same ID
      const vendorMap = new Map();
      primaryVendors.forEach(v => vendorMap.set(v.id, v));
      retryVendors.forEach(v => vendorMap.set(v.id, v));
      
      allVendors = Array.from(vendorMap.values());
    }
    
    // Archive previous file if it exists and option is enabled
    const outputPath = path.resolve(options.output);
    if (options.archive && fs.existsSync(outputPath)) {
      const archiveDir = path.join(path.dirname(outputPath), 'archive');
      if (!fs.existsSync(archiveDir)) {
        fs.mkdirSync(archiveDir, { recursive: true });
      }
      
      const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
      const archivePath = path.join(archiveDir, `${path.basename(outputPath, '.json')}_${timestamp}.json`);
      
      fs.copyFileSync(outputPath, archivePath);
      logger.info(`Archived previous file to ${archivePath}`);
    }
    
    // Write finalized vendors
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    fs.writeFileSync(outputPath, JSON.stringify(allVendors, null, 2));
    logger.info(`Saved ${allVendors.length} finalized vendors to ${outputPath}`);
    
  } catch (error) {
    logger.error('Error finalizing vendors:', error);
    process.exit(1);
  }
}

main();