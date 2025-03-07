const Joi = require('joi');

// Define schema based on the app's Schema.js
const vendorSchema = Joi.object({
  id: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
  business_license: Joi.string().allow(null, ''),
  name: Joi.string().required(),
  license_type: Joi.string().allow(null, ''),
  status: Joi.string().allow(null, ''),
  location: Joi.object({
    address: Joi.string().required(),
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
  
  // Handle case where coordinates are nested but we need them at the top level for validation
  if (vendor.location.coordinates && 
      vendor.location.coordinates.latitude && 
      vendor.location.coordinates.longitude) {
    // Ensure the coordinates are numbers
    vendor.location.coordinates.latitude = parseFloat(vendor.location.coordinates.latitude);
    vendor.location.coordinates.longitude = parseFloat(vendor.location.coordinates.longitude);
    
    // Add a flag to indicate valid coordinates
    vendor.hasValidCoordinates = true;
  } else {
    // Ensure coordinates object exists
    vendor.location.coordinates = vendor.location.coordinates || { latitude: null, longitude: null };
    vendor.hasValidCoordinates = false;
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

module.exports = {
  validateVendor,
  normalizeVendor,
  vendorSchema
};