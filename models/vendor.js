// models/vendor.js - Enhanced with region integration
const Joi = require('joi');

// Define enhanced schema with region information
const vendorSchema = Joi.object({
  id: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
  business_license: Joi.string().allow(null, ''),
  name: Joi.string().required(),
  license_type: Joi.string().allow(null, ''),
  status: Joi.string().allow(null, ''),
  location: Joi.object({
    address: Joi.string().required(),
    originalAddress: Joi.string().allow(null, ''),
    zipCode: Joi.string().pattern(/^\d{5}$/).allow(null),
    coordinates: Joi.object({
      latitude: Joi.number().allow(null),
      longitude: Joi.number().allow(null)
    }).required()
  }).required(),
  contact: Joi.object({
    phone: Joi.string().allow(null, ''),
    email: Joi.string().email().allow(null, ''),
    social: Joi.object({
      instagram: Joi.string().allow(null, ''),
      facebook: Joi.string().allow(null, '')
    }).optional()
  }).required(),
  // New region-related fields
  regionInfo: Joi.object({
    regionId: Joi.string().allow(null, ''),
    regionName: Joi.string().allow(null, ''),
    isActiveRegion: Joi.boolean().default(false),
    isPriorityRegion: Joi.boolean().default(false),
    lastRegionCheck: Joi.string().allow(null)  // ISO date string
  }).optional(),
  hours: Joi.object().pattern(
    Joi.string(),
    Joi.object({
      open: Joi.string().allow(null, ''),
      close: Joi.string().allow(null, '')
    })
  ).optional(),
  deals: Joi.array().items(Joi.object()).optional(),
  isPartner: Joi.boolean().default(false),
  rating: Joi.number().allow(null),
  lastUpdated: Joi.string().allow(null),
  hasValidCoordinates: Joi.boolean().default(false)
});

/**
 * Validates a vendor object against the schema
 * @param {Object} vendor - Vendor object to validate
 * @returns {Object} - Validation result
 */
function validateVendor(vendor) {
  return vendorSchema.validate(vendor, { abortEarly: false });
}

/**
 * Transforms vendor data to match the expected schema
 * @param {Object} rawVendor - Raw vendor data
 * @returns {Object} - Normalized vendor object
 */
function normalizeVendor(rawVendor) {
  // Create a copy to avoid mutations
  const vendor = { ...rawVendor };
  
  // Ensure proper structure
  vendor.location = vendor.location || { 
    address: '', 
    coordinates: { latitude: null, longitude: null } 
  };
  
  // Handle case where coordinates are at the location level
  if (vendor.location.latitude !== undefined && vendor.location.longitude !== undefined) {
    // Move coordinates to the coordinates object
    vendor.location.coordinates = {
      latitude: vendor.location.latitude,
      longitude: vendor.location.longitude
    };
    
    // Remove the old properties to avoid duplication
    delete vendor.location.latitude;
    delete vendor.location.longitude;
  }
  
  // Ensure zipCode field exists
  if (vendor.location.zipCode === undefined) {
    // Try to extract from address if not already set
    if (vendor.location.address) {
      const zipMatch = vendor.location.address.match(/\b(\d{5})(?:-\d{4})?\b/);
      vendor.location.zipCode = zipMatch ? zipMatch[1] : null;
    } else {
      vendor.location.zipCode = null;
    }
  }
  
  // Handle case where coordinates are nested but we need them at the top level for validation
  if (vendor.location.coordinates && 
      vendor.location.coordinates.latitude && 
      vendor.location.coordinates.longitude) {
    // Ensure they're numbers
    vendor.location.coordinates.latitude = Number(vendor.location.coordinates.latitude);
    vendor.location.coordinates.longitude = Number(vendor.location.coordinates.longitude);
    
    // Add a flag to indicate valid coordinates
    vendor.hasValidCoordinates = true;
  } else {
    // Ensure coordinates object exists
    vendor.location.coordinates = vendor.location.coordinates || { latitude: null, longitude: null };
    vendor.hasValidCoordinates = false;
  }
  
  // Ensure regionInfo exists with defaults if not present
  if (!vendor.regionInfo) {
    vendor.regionInfo = {
      regionId: null,
      regionName: 'Unknown',
      isActiveRegion: false,
      isPriorityRegion: false,
      lastRegionCheck: null
    };
  }
  
  vendor.contact = vendor.contact || { phone: null };
  vendor.hours = vendor.hours || {};
  vendor.deals = vendor.deals || [];
  vendor.isPartner = vendor.isPartner || false;
  
  // Ensure lastUpdated is a string
  if (vendor.lastUpdated && typeof vendor.lastUpdated !== 'string') {
    vendor.lastUpdated = new Date(vendor.lastUpdated).toISOString();
  }
  
  return vendor;
}

/**
 * Updates a vendor's region information
 * @param {Object} vendor - Vendor object to update
 * @param {Object} regionInfo - Region information object
 * @returns {Object} - Updated vendor
 */
function updateVendorRegionInfo(vendor, regionInfo) {
  // Create a deep copy to avoid mutations
  const updatedVendor = JSON.parse(JSON.stringify(vendor));
  
  // Update the region information
  updatedVendor.regionInfo = {
    ...updatedVendor.regionInfo || {},
    ...regionInfo,
    lastRegionCheck: new Date().toISOString()
  };
  
  return updatedVendor;
}

/**
 * Gets a vendor's region status for filtering
 * @param {Object} vendor - Vendor object
 * @returns {string} - 'active', 'priority', or 'other'
 */
function getVendorRegionStatus(vendor) {
  if (vendor.regionInfo?.isActiveRegion) {
    return 'active';
  } else if (vendor.regionInfo?.isPriorityRegion) {
    return 'priority';
  } else {
    return 'other';
  }
}

/**
 * Filters vendors by region status
 * @param {Array<Object>} vendors - Array of vendor objects
 * @param {string} regionStatus - Status to filter by ('active', 'priority', 'other', 'all')
 * @returns {Array<Object>} - Filtered vendor objects
 */
function filterVendorsByRegionStatus(vendors, regionStatus = 'all') {
  if (regionStatus === 'all') return vendors;
  
  return vendors.filter(vendor => {
    const status = getVendorRegionStatus(vendor);
    return status === regionStatus;
  });
}

module.exports = {
  validateVendor,
  normalizeVendor,
  updateVendorRegionInfo,
  getVendorRegionStatus,
  filterVendorsByRegionStatus,
  vendorSchema
};