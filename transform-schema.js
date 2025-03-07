// transform-schema.js
const fs = require('fs');
const path = require('path');

// Configuration - update these paths as needed
const INPUT_FILE = path.resolve('./data/output/successful-vendors.json');
const OUTPUT_FILE = path.resolve('./data/output/schema-fixed-vendors.json');

console.log(`Reading vendors from ${INPUT_FILE}...`);

try {
  // Read and parse the input file
  const rawData = fs.readFileSync(INPUT_FILE, 'utf8');
  const vendors = JSON.parse(rawData);
  
  if (!Array.isArray(vendors)) {
    throw new Error('Input file must contain an array of vendors');
  }
  
  // Transform each vendor to match the app schema
  const transformedVendors = vendors.map(vendor => {
    // Create a deep copy to avoid mutating the original
    const transformed = JSON.parse(JSON.stringify(vendor));
    
    // Fix location structure
    if (transformed.location) {
      const { latitude, longitude, formattedAddress, ...otherLocationProps } = transformed.location;
      
      // Replace with the correct structure
      transformed.location = {
        ...otherLocationProps,
        coordinates: {
          latitude: latitude,
          longitude: longitude
        }
      };
      
      // If needed, update address with formatted address
      if (formattedAddress && !transformed.location.address) {
        transformed.location.address = formattedAddress;
      }
    }
    
    // Add other missing required fields with default values
    if (!transformed.hours) {
      transformed.hours = {};
    }
    
    if (!transformed.deals) {
      transformed.deals = {
        daily: {},
        special: []
      };
    }
    
    if (transformed.contact && !transformed.contact.social) {
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
- ${transformedVendors.length} vendors transformed to match app schema
- Saved to: ${OUTPUT_FILE}
  `);
  
} catch (error) {
  console.error('Error transforming vendors:', error);
  process.exit(1);
}