// services/geocoding/index.js
const NodeGeocoder = require('node-geocoder');
require('dotenv').config();

/**
 * Creates a geocoder instance based on environment configuration
 * @returns {Object} - Configured geocoder instance
 */
function createGeocoder() {
  const options = {
    provider: process.env.GEOCODER_PROVIDER || 'openstreetmap'
  };

  // Add API key if specified (required for some providers like Google)
  if (process.env.GEOCODER_API_KEY) {
    options.apiKey = process.env.GEOCODER_API_KEY;
  }

  return NodeGeocoder(options);
}

/**
 * Geocodes a single address
 * @param {string} address - The address to geocode
 * @returns {Promise<Object>} - Geocoding result with lat/lng
 */
async function geocodeAddress(address) {
  try {
    const geocoder = createGeocoder();
    const results = await geocoder.geocode(address);
    
    if (!results || results.length === 0) {
      return { success: false, error: 'No results found' };
    }
    
    const { latitude, longitude, formattedAddress } = results[0];
    
    return {
      success: true,
      data: {
        latitude,
        longitude,
        formattedAddress
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Geocoding failed'
    };
  }
}

/**
 * Batch geocodes multiple vendors
 * @param {Array} vendors - Array of vendor objects
 * @param {Object} options - Options for batch processing
 * @returns {Promise<Array>} - Array of vendors with geocoded data
 */
async function batchGeocodeVendors(vendors, options = {}) {
  const { 
    concurrency = 2,  // Default to 2 concurrent requests to avoid rate limits
    delayMs = 200     // Delay between requests in milliseconds
  } = options;
  
  const results = [];
  const errors = [];
  
  // Process vendors in batches to respect rate limits
  for (let i = 0; i < vendors.length; i += concurrency) {
    const batch = vendors.slice(i, i + concurrency);
    const batchPromises = batch.map(async (vendor) => {
      try {
        // Skip if already has coordinates
        if (vendor.location.latitude && vendor.location.longitude) {
          return vendor;
        }
        
        const address = vendor.location.address;
        if (!address) {
          throw new Error('Missing address');
        }
        
        const geocodeResult = await geocodeAddress(address);
        
        if (!geocodeResult.success) {
          throw new Error(geocodeResult.error);
        }
        
        // Update vendor with geocoded data
        return {
          ...vendor,
          location: {
            ...vendor.location,
            latitude: geocodeResult.data.latitude,
            longitude: geocodeResult.data.longitude,
            formattedAddress: geocodeResult.data.formattedAddress
          }
        };
      } catch (error) {
        errors.push({
          vendorId: vendor.id,
          name: vendor.name,
          error: error.message
        });
        return vendor; // Return original vendor on error
      }
    });
    
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
    
    // Add delay between batches
    if (i + concurrency < vendors.length) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  return {
    vendors: results,
    errors,
    stats: {
      total: vendors.length,
      successful: vendors.length - errors.length,
      failed: errors.length
    }
  };
}

module.exports = {
  geocodeAddress,
  batchGeocodeVendors
}; 