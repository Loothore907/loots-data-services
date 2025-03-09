/**
 * Utility functions for processing vendor data
 */

/**
 * Extracts zip code from address and adds it as a separate field in vendor object
 * @param {Object} vendor - Vendor object to process
 * @returns {Object} - Vendor with added zipCode field
 */
function addZipCodeField(vendor) {
  if (!vendor.location || !vendor.location.address) return vendor;
  
  // Extract zip code using regex
  const zipMatch = vendor.location.address.match(/\b(\d{5})(?:-\d{4})?\b/);
  
  // Create a deep copy to avoid mutations
  const updatedVendor = JSON.parse(JSON.stringify(vendor));
  
  // Add zipCode field directly to location object
  if (zipMatch && zipMatch[1]) {
    updatedVendor.location.zipCode = zipMatch[1];
  } else {
    updatedVendor.location.zipCode = null;
  }
  
  return updatedVendor;
}

/**
 * Process a batch of vendors to add zipCode fields
 * @param {Array} vendors - Array of vendor objects
 * @returns {Array} - Array of vendors with added zipCode fields
 */
function processVendorsWithZipCodes(vendors) {
  if (!Array.isArray(vendors)) return vendors;
  
  return vendors.map(vendor => addZipCodeField(vendor));
}

module.exports = {
  addZipCodeField,
  processVendorsWithZipCodes
}; 