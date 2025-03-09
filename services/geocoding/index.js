// services/geocoding/index.js
const NodeGeocoder = require('node-geocoder');
const axios = require('axios');
require('dotenv').config();

/**
 * Creates a geocoder instance based on environment configuration or passed provider
 * @param {string} provider - Optional provider override
 * @returns {Object} - Configured geocoder instance
 */
function createGeocoder(provider = '') {
  const selectedProvider = provider || process.env.PRIMARY_GEOCODER_PROVIDER || 'google';
  
  // Don't use node-geocoder for RapidAPI - we'll handle that separately
  if (selectedProvider.toLowerCase() === 'rapidapi') {
    return null;
  }
  
  const options = {
    provider: selectedProvider
  };

  // Add API key if specified (required for some providers like Google)
  if (selectedProvider === 'google' && process.env.PRIMARY_GEOCODER_API_KEY) {
    options.apiKey = process.env.PRIMARY_GEOCODER_API_KEY;
  } else if (selectedProvider === 'openstreetmap') {
    // OpenStreetMap specific options
    options.httpAdapter = 'https';
    options.rateLimit = 2;
  }

  return NodeGeocoder(options);
}

/**
 * Geocodes a single address using RapidAPI
 * @param {string} address - The address to geocode
 * @returns {Promise<Object>} - Geocoding result with lat/lng
 */
async function geocodeWithRapidAPI(address) {
  try {
    const apiKey = process.env.BACKUP_GEOCODER_API_KEY;
    const apiHost = process.env.BACKUP_GEOCODER_API_HOST || 'forward-reverse-geocoding.p.rapidapi.com';
    
    if (!apiKey || !apiHost) {
      throw new Error('RapidAPI key or host not configured');
    }
    
    // Clean up the address - remove ", UNITED STATES" suffix if present
    const cleanAddress = address.replace(/, UNITED STATES$/i, '');
    
    console.log(`Geocoding address: ${cleanAddress}`);
    
    // Use the /v1/search endpoint for free-form search with correct parameters
    const options = {
      method: 'GET',
      url: `https://${apiHost}/v1/search`,
      params: {
        q: cleanAddress,             // This is the correct parameter name for the search endpoint
        format: 'json',
        addressdetails: '1',
        limit: '1'
      },
      headers: {
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': apiHost
      }
    };

    const response = await axios.request(options);
    
    // Log the complete response structure for debugging
    console.log('RapidAPI response structure:', JSON.stringify(response.data).substring(0, 300) + '...');
    
    if (!response.data || !Array.isArray(response.data) || response.data.length === 0) {
      console.log('No results found for address:', cleanAddress);
      return { 
        success: false, 
        error: 'No results found' 
      };
    }
    
    const result = response.data[0];
    
    // Check if the result has the lat/lon properties (per documentation)
    if (!result || typeof result.lat === 'undefined' || typeof result.lon === 'undefined') {
      console.log('Invalid result structure:', result);
      return {
        success: false,
        error: 'Invalid response format'
      };
    }
    
    return {
      success: true,
      data: {
        coordinates: {
          latitude: parseFloat(result.lat),
          longitude: parseFloat(result.lon)
        },
        formattedAddress: result.display_name || cleanAddress
      }
    };
  } catch (error) {
    console.error('RapidAPI geocoding error:', error.message);
    
    // Log more details about the error for debugging
    if (error.response) {
      console.error('Error response:', error.response.status, error.response.data);
    } else if (error.request) {
      console.error('No response received');
    }
    
    return {
      success: false,
      error: error.message || 'RapidAPI geocoding failed'
    };
  }
}

/**
 * Geocodes a single address
 * @param {string} address - The address to geocode
 * @param {string} provider - Optional provider to use (overrides env config)
 * @returns {Promise<Object>} - Geocoding result with lat/lng
 */
async function geocodeAddress(address, provider = '') {
  // Use RapidAPI if specified
  if (provider.toLowerCase() === 'rapidapi' || 
     (provider === '' && process.env.PRIMARY_GEOCODER_PROVIDER?.toLowerCase() === 'rapidapi')) {
    return geocodeWithRapidAPI(address);
  }
  
  // Otherwise use node-geocoder for other providers
  try {
    const geocoder = createGeocoder(provider);
    const results = await geocoder.geocode(address);
    
    if (!results || results.length === 0) {
      return { success: false, error: 'No results found' };
    }
    
    const { latitude, longitude, formattedAddress } = results[0];
    
    return {
      success: true,
      data: {
        coordinates: {
          latitude,
          longitude
        },
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
    delayMs = 200,    // Delay between requests in milliseconds
    provider = ''     // Optional provider override
  } = options;
  
  const selectedProvider = provider || process.env.PRIMARY_GEOCODER_PROVIDER || 'google';
  
  // Adjust concurrency and delay based on provider
  let actualConcurrency = concurrency;
  let actualDelay = delayMs;
  
  if (selectedProvider.toLowerCase() === 'rapidapi') {
    // RapidAPI has stricter rate limits - limit to 1 request at a time
    actualConcurrency = 1;
    // Add extra delay to ensure we don't exceed rate limits
    actualDelay = Math.max(delayMs, 1000); // At least 1 second between requests
  }
  
  const results = [];
  const errors = [];
  
  // Process vendors in batches to respect rate limits
  for (let i = 0; i < vendors.length; i += actualConcurrency) {
    const batch = vendors.slice(i, i + actualConcurrency);
    const batchPromises = batch.map(async (vendor) => {
      try {
        // Skip if already has coordinates
        if (vendor.location?.coordinates?.latitude && 
            vendor.location?.coordinates?.longitude) {
          return vendor;
        }
        
        const address = vendor.location.address;
        if (!address) {
          throw new Error('Missing address');
        }
        
        const geocodeResult = await geocodeAddress(address, selectedProvider);
        
        if (!geocodeResult.success) {
          throw new Error(geocodeResult.error);
        }
        
        // Update vendor with geocoded data
        return {
          ...vendor,
          location: {
            ...vendor.location, // This preserves the zipCode field from preprocessing
            address: geocodeResult.data.formattedAddress || vendor.location.address,
            originalAddress: vendor.location.address, // preserve original
            coordinates: geocodeResult.data.coordinates
          },
          hasValidCoordinates: true
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
    if (i + actualConcurrency < vendors.length) {
      await new Promise(resolve => setTimeout(resolve, actualDelay));
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