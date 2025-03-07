// backend-schema-fix.js
const fs = require('fs');
const path = require('path');

// Configuration - update these paths as needed
const INPUT_FILE = path.resolve('./data/output/successful-vendors.json');
const OUTPUT_FILE = path.resolve('./data/output/backend-compatible-vendors.json');

console.log(`Reading vendors from ${INPUT_FILE}...`);

try {
  // Read and parse the input file
  const rawData = fs.readFileSync(INPUT_FILE, 'utf8');
  const vendors = JSON.parse(rawData);
  
  if (!Array.isArray(vendors)) {
    throw new Error('Input file must contain an array of vendors');
  }
  
  // Transform each vendor to match the backend schema
  // The backend schema expects latitude/longitude directly in the location object,
  // not in a nested coordinates object
  const transformedVendors = vendors.map(vendor => {
    // Create a deep copy to avoid mutating the original
    const transformed = JSON.parse(JSON.stringify(vendor));
    
    // Remove formattedAddress if present (not in schema)
    if (transformed.location && transformed.location.formattedAddress) {
      delete transformed.location.formattedAddress;
    }
    
    // Ensure hours object exists
    if (!transformed.hours) {
      transformed.hours = {};
    }
    
    // Ensure deals array exists
    if (!transformed.deals) {
      transformed.deals = [];
    }
    
    // Ensure contact has required structure
    if (!transformed.contact) {
      transformed.contact = {
        phone: '',
        email: '',
        social: {
          instagram: '',
          facebook: ''
        }
      };
    } else if (!transformed.contact.social) {
      transformed.contact.social = {
        instagram: '',
        facebook: ''
      };
    }
    
    return transformed;
  });
  
  // Write to output file
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(transformedVendors, null, 2));
  
  console.log(`
Transformation complete:
- ${transformedVendors.length} vendors transformed to match backend schema
- Saved to: ${OUTPUT_FILE}

Try syncing with:
npm run sync -- --input=./data/output/backend-compatible-vendors.json
  `);
  
} catch (error) {
  console.error('Error transforming vendors:', error);
  process.exit(1);
}