// test-address-cleaner.js
try {
  const { cleanAddressForGeocoding } = require('./utils/address-cleaner');
  console.log('Module imported successfully');
  
  // Test with a sample address
  const result = cleanAddressForGeocoding('123 Main St, Anytown, AK 12345');
  console.log('Result:', JSON.stringify(result, null, 2));
} catch (error) {
  console.error('Error importing or using module:', error);
} 