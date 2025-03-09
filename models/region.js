// models/region.js
const Joi = require('joi');

/**
 * Region Model
 * Defines regions for vendor filtering and processing
 * 
 * @typedef {Object} Region
 * @property {string} id - Unique identifier
 * @property {string} name - Region name (e.g., "Anchorage", "MatSu")
 * @property {string[]} zipCodes - Array of zip codes in this region
 * @property {boolean} isActive - Whether region is active in the app
 * @property {boolean} isPriority - Whether region is prioritized for processing
 * @property {string} lastUpdated - ISO date string of last update
 */

// Define schema validation
const regionSchema = Joi.object({
  id: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
  name: Joi.string().required(),
  zipCodes: Joi.array().items(Joi.string().pattern(/^\d{5}$/)).required(),
  isActive: Joi.boolean().default(false),
  isPriority: Joi.boolean().default(true),
  lastUpdated: Joi.string().allow(null)
});

/**
 * Validates a region object against the schema
 * @param {Object} region - Region to validate
 * @returns {Object} - Validation result
 */
function validateRegion(region) {
  return regionSchema.validate(region, { abortEarly: false });
}

/**
 * Extracts zip code from an address string
 * @param {string} address - Full address string
 * @returns {string|null} - Extracted zip code or null if not found
 */
function extractZipCodeFromAddress(address) {
  if (!address) return null;
  
  // Look for 5-digit zip code with possible 4-digit extension
  const zipMatch = address.match(/\b(\d{5})(?:-\d{4})?\b/);
  return zipMatch ? zipMatch[1] : null;
}

/**
 * Checks if a vendor is in a specific region
 * @param {Object} vendor - Vendor object with location
 * @param {Object} region - Region object with zip codes
 * @returns {boolean} - True if vendor is in the region
 */
function isVendorInRegion(vendor, region) {
  // First check if the vendor has a zipCode field
  if (vendor.location && vendor.location.zipCode) {
    return region.zipCodes.includes(vendor.location.zipCode);
  }
  
  // Fall back to address extraction
  if (!vendor.location || !vendor.location.address) return false;
  
  const zipCode = extractZipCodeFromAddress(vendor.location.address);
  if (!zipCode) return false;
  
  return region.zipCodes.includes(zipCode);
}

/**
 * Checks if a vendor is in any active region
 * @param {Object} vendor - Vendor object with location
 * @param {Array<Object>} regions - Array of region objects
 * @returns {boolean} - True if vendor is in any active region
 */
function isVendorInActiveRegion(vendor, regions) {
  // First check if the vendor has a zipCode field
  if (vendor.location && vendor.location.zipCode) {
    // Check if vendor's zip code is in any active region
    return regions
      .filter(region => region.isActive)
      .some(region => region.zipCodes.includes(vendor.location.zipCode));
  }
  
  // Fall back to address extraction
  if (!vendor.location || !vendor.location.address) return false;
  
  const zipCode = extractZipCodeFromAddress(vendor.location.address);
  if (!zipCode) return false;
  
  // Check if vendor's zip code is in any active region
  return regions
    .filter(region => region.isActive)
    .some(region => region.zipCodes.includes(zipCode));
}

/**
 * Gets the region a vendor belongs to
 * @param {Object} vendor - Vendor object with location
 * @param {Array<Object>} regions - Array of region objects
 * @returns {Object|null} - Region object or null if not found
 */
function getVendorRegion(vendor, regions) {
  // First check if the vendor has a zipCode field
  if (vendor.location && vendor.location.zipCode) {
    // Find first region that contains this zip code
    return regions.find(region => region.zipCodes.includes(vendor.location.zipCode)) || null;
  }
  
  // Fall back to address extraction
  if (!vendor.location || !vendor.location.address) return null;
  
  const zipCode = extractZipCodeFromAddress(vendor.location.address);
  if (!zipCode) return null;
  
  // Find first region that contains this zip code
  return regions.find(region => region.zipCodes.includes(zipCode)) || null;
}

/**
 * Creates a normalized region object
 * @param {Object} rawRegion - Raw region data
 * @returns {Object} - Normalized region object
 */
function normalizeRegion(rawRegion) {
  // Create a copy to avoid mutations
  const region = { ...rawRegion };
  
  // Ensure array for zip codes
  region.zipCodes = Array.isArray(region.zipCodes) ? region.zipCodes : [];
  
  // Remove duplicates and ensure proper format for zip codes
  region.zipCodes = [...new Set(region.zipCodes)]
    .map(zip => zip.trim())
    .filter(zip => /^\d{5}$/.test(zip));
  
  // Ensure boolean values
  region.isActive = Boolean(region.isActive);
  region.isPriority = Boolean(region.isPriority);
  
  // Set lastUpdated if not present
  if (!region.lastUpdated) {
    region.lastUpdated = new Date().toISOString();
  }
  
  return region;
}

// Firebase service for regions
async function syncRegionsToFirestore(regions, options = {}) {
  const { getAdminDb } = require('../config/firebase');
  const {
    collection = 'regions',
    merge = true
  } = options;
  
  try {
    const db = getAdminDb();
    const regionsCollection = db.collection(collection);
    const results = { successful: [], failed: [] };
    
    // Process each region
    for (const region of regions) {
      try {
        const docRef = regionsCollection.doc(String(region.id));
        await docRef.set({
          ...region,
          lastUpdated: new Date().toISOString()
        }, { merge });
        
        results.successful.push(region.id);
      } catch (error) {
        console.error(`Error syncing region ${region.id}:`, error);
        results.failed.push({ id: region.id, error: error.message });
      }
    }
    
    return {
      success: true,
      stats: {
        total: regions.length,
        successful: results.successful.length,
        failed: results.failed.length
      }
    };
  } catch (error) {
    console.error('Error syncing regions to Firestore:', error);
    return {
      success: false,
      error: error.message,
      stats: {
        total: regions.length,
        successful: 0,
        failed: regions.length
      }
    };
  }
}

/**
 * Fetches regions from Firestore
 * @param {Object} options - Query options
 * @returns {Promise<Array>} - Array of region objects
 */
async function fetchRegionsFromFirestore(options = {}) {
  const { getAdminDb } = require('../config/firebase');
  const {
    collection = 'regions',
    activeOnly = false,
    priorityOnly = false
  } = options;
  
  try {
    const db = getAdminDb();
    let query = db.collection(collection);
    
    if (activeOnly) {
      query = query.where('isActive', '==', true);
    }
    
    if (priorityOnly) {
      query = query.where('isPriority', '==', true);
    }
    
    const snapshot = await query.get();
    const regions = [];
    
    snapshot.forEach(doc => {
      regions.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    return {
      success: true,
      regions,
      count: regions.length
    };
  } catch (error) {
    console.error('Error fetching regions from Firestore:', error);
    return {
      success: false,
      error: error.message,
      regions: []
    };
  }
}

module.exports = {
  validateRegion,
  normalizeRegion,
  extractZipCodeFromAddress,
  isVendorInRegion,
  isVendorInActiveRegion,
  getVendorRegion,
  syncRegionsToFirestore,
  fetchRegionsFromFirestore
};