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
    originalAddress: Joi.string().allow(null, ''),
    zipCode: Joi.string().pattern(/^\d{5}$/).allow(null),
    latitude: Joi.number().allow(null),
    longitude: Joi.number().allow(null)
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
  ).allow({}),
  deals: Joi.array().items(Joi.object()),
  isPartner: Joi.boolean().default(false),
  rating: Joi.number().allow(null),
  lastUpdated: Joi.string().allow(null)
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
  vendor.location = vendor.location || { address: '', latitude: null, longitude: null };
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