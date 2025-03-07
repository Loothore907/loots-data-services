// split-vendors.js
const fs = require('fs');
const path = require('path');

// Configuration - update these paths as needed
const INPUT_FILE = path.resolve('./data/output/geocoded-vendors.json');
const SUCCESS_OUTPUT = path.resolve('./data/output/successful-vendors.json');
const FAILED_OUTPUT = path.resolve('./data/output/failed-vendors.json');

console.log(`Reading vendors from ${INPUT_FILE}...`);

try {
  // Read and parse the input file
  const rawData = fs.readFileSync(INPUT_FILE, 'utf8');
  const vendors = JSON.parse(rawData);
  
  if (!Array.isArray(vendors)) {
    throw new Error('Input file must contain an array of vendors');
  }
  
  // Split vendors based on geocoding status
  const successfulVendors = vendors.filter(vendor => 
    vendor.location && 
    vendor.location.latitude !== null && 
    vendor.location.longitude !== null
  );
  
  const failedVendors = vendors.filter(vendor => 
    !vendor.location || 
    vendor.location.latitude === null || 
    vendor.location.longitude === null
  );
  
  // Write to output files
  fs.writeFileSync(SUCCESS_OUTPUT, JSON.stringify(successfulVendors, null, 2));
  fs.writeFileSync(FAILED_OUTPUT, JSON.stringify(failedVendors, null, 2));
  
  console.log(`
Separation complete:
- ${successfulVendors.length} successfully geocoded vendors saved to: ${SUCCESS_OUTPUT}
- ${failedVendors.length} failed geocoding vendors saved to: ${FAILED_OUTPUT}
  `);
  
} catch (error) {
  console.error('Error processing vendors:', error);
  process.exit(1);
}