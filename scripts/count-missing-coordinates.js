const fs = require('fs');
const path = require('path');

// Function to count vendors without coordinates
function countMissingCoordinates(filePath) {
  try {
    console.log(`Analyzing file: ${filePath}`);
    
    // Read and parse the JSON file
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    // Check if the data is an array
    if (!Array.isArray(data)) {
      console.error(`Error: Data in ${filePath} is not an array`);
      return;
    }
    
    // Count vendors without coordinates
    let missingCount = 0;
    let totalCount = data.length;
    let missingVendors = [];
    
    for (const vendor of data) {
      // Check if coordinates are missing
      if (!vendor.coordinates || 
          typeof vendor.coordinates.latitude === 'undefined' || 
          typeof vendor.coordinates.longitude === 'undefined') {
        missingCount++;
        missingVendors.push({
          id: vendor.id || 'unknown',
          name: vendor.name || 'unknown',
          address: vendor.address || 'unknown'
        });
      }
    }
    
    // Print results
    console.log(`\nFile: ${path.basename(filePath)}`);
    console.log(`Total vendors: ${totalCount}`);
    console.log(`Vendors missing coordinates: ${missingCount} (${((missingCount/totalCount)*100).toFixed(2)}%)`);
    console.log(`Vendors with coordinates: ${totalCount - missingCount} (${(((totalCount-missingCount)/totalCount)*100).toFixed(2)}%)`);
    
    // Print first 5 vendors missing coordinates
    if (missingVendors.length > 0) {
      console.log('\nSample of vendors missing coordinates:');
      missingVendors.slice(0, 5).forEach((v, i) => {
        console.log(`${i+1}. ${v.name} (${v.id}) - Address: ${v.address}`);
      });
      console.log(`... and ${missingVendors.length - 5} more`);
    }
    
    return { total: totalCount, missing: missingCount };
  } catch (error) {
    console.error(`Error processing ${filePath}: ${error.message}`);
  }
}

// Analyze a specific file
const filePath = process.argv[2] || path.join(__dirname, '../data/output/geocoded-vendors.json');
countMissingCoordinates(filePath); 