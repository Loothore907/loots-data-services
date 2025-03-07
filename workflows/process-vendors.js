// workflows/process-vendors.js
const fs = require('fs');
const path = require('path');
const { normalizeVendor, validateVendor } = require('../models/vendor');
const { batchGeocodeVendors } = require('../services/geocoding');
const { syncVendorsToFirestore } = require('../services/firebase');
const logger = require('../utils/logger');

/**
 * Process vendor data through the complete workflow:
 * 1. Import & normalize
 * 2. Geocode addresses
 * 3. Transform schema
 * 4. Sync to Firebase
 * 
 * @param {Object} options Configuration options
 * @returns {Promise<Object>} Processing results
 */
async function processVendors(options) {
  const {
    input,                              // Input file path
    output = './data/output/failed-geocoding.json', // Output path for failed vendors
    syncMode = 'overwrite',             // 'overwrite', 'append', or 'update'
    collection = 'vendors',             // Firestore collection
    geocodingConcurrency = 2,           // Concurrent geocoding requests
    geocodingDelay = 200,               // Delay between geocoding batches
    skipExistingCoordinates = true,     // Skip vendors that already have coordinates
    skipSync = false,                   // Skip Firebase sync step
    geocodingProvider = ''              // Geocoding provider to use
  } = options;
  
  try {
    logger.info('Starting vendor processing workflow');
    
    // STEP 1: Import & Normalize
    logger.info(`Reading vendors from ${input}`);
    const rawData = fs.readFileSync(input, 'utf8');
    let vendors;
    
    try {
      vendors = JSON.parse(rawData);
    } catch (error) {
      throw new Error(`Invalid JSON format: ${error.message}`);
    }
    
    if (!Array.isArray(vendors)) {
      throw new Error('Input file must contain an array of vendors');
    }
    
    logger.info(`Found ${vendors.length} vendors to process`);
    
    // Normalize vendors
    const normalizedVendors = vendors.map(vendor => normalizeVendor(vendor));
    logger.info(`Normalized ${normalizedVendors.length} vendors`);
    
    // STEP 2: Geocode Addresses
    logger.info('Starting geocoding process');
    const vendorsToGeocode = skipExistingCoordinates
      ? normalizedVendors.filter(v => !v.location.latitude || !v.location.longitude)
      : normalizedVendors;
    
    logger.info(`Geocoding ${vendorsToGeocode.length} vendors`);
    
    const geocodeOptions = {
      concurrency: geocodingConcurrency,
      delayMs: geocodingDelay,
      provider: geocodingProvider
    };
    
    const geocodeResult = await batchGeocodeVendors(vendorsToGeocode, geocodeOptions);
    
    // Merge geocoded vendors with original list if skipping existing
    const allVendors = skipExistingCoordinates
      ? normalizedVendors.map(original => {
          const geocoded = geocodeResult.vendors.find(v => v.id === original.id);
          return geocoded || original;
        })
      : geocodeResult.vendors;
    
    // Split into successful and failed geocoding
    const successful = allVendors.filter(v => 
      v.location && v.location.latitude && v.location.longitude);
    
    const failed = allVendors.filter(v => 
      !v.location || !v.location.latitude || !v.location.longitude);
    
    logger.info(`Geocoding results: ${successful.length} successful, ${failed.length} failed`);
    
    // Save failed vendors for review
    if (failed.length > 0) {
      const failedDir = path.dirname(output);
      if (!fs.existsSync(failedDir)) {
        fs.mkdirSync(failedDir, { recursive: true });
      }
      
      fs.writeFileSync(output, JSON.stringify(failed, null, 2));
      logger.info(`Saved ${failed.length} failed vendors to ${output}`);
    }
    
    // STEP 3: Transform Schema (ensure it matches backend validation)
    logger.info('Transforming vendor schema');
    const validVendors = [];
    const schemaErrors = [];
    
    for (const vendor of successful) {
      // Clean up any fields not in the schema (like formattedAddress)
      if (vendor.location && vendor.location.formattedAddress) {
        delete vendor.location.formattedAddress;
      }
      
      const { error } = validateVendor(vendor);
      
      if (error) {
        logger.warn(`Schema validation error for vendor ${vendor.id}: ${error.message}`);
        schemaErrors.push({ vendor, errors: error.details });
      } else {
        validVendors.push(vendor);
      }
    }
    
    logger.info(`Schema validation: ${validVendors.length} valid, ${schemaErrors.length} invalid`);
    
    // STEP 4: Sync to Firebase
    if (skipSync) {
      logger.info('Skipping Firebase sync as requested');
      return {
        success: true,
        stats: {
          total: vendors.length,
          normalized: normalizedVendors.length,
          geocoded: successful.length,
          failed: failed.length,
          schemaValid: validVendors.length,
          schemaInvalid: schemaErrors.length,
          synced: 0
        }
      };
    }

    if (validVendors.length === 0) {
      logger.warn('No valid vendors to sync to Firebase');
      return {
        success: true,
        stats: {
          total: vendors.length,
          normalized: normalizedVendors.length,
          geocoded: successful.length,
          failed: failed.length,
          schemaValid: validVendors.length,
          schemaInvalid: schemaErrors.length,
          synced: 0
        }
      };
    }
    
    logger.info(`Syncing ${validVendors.length} vendors to Firestore (mode: ${syncMode})`);
    
    const syncOptions = {
      collection,
      merge: syncMode !== 'overwrite'
    };
    
    const syncResult = await syncVendorsToFirestore(validVendors, syncOptions);
    
    if (!syncResult.success) {
      throw new Error(`Firebase sync failed: ${syncResult.error}`);
    }
    
    logger.info(`Sync completed successfully: ${syncResult.stats.successful} vendors synced`);
    
    // Return comprehensive results
    return {
      success: true,
      stats: {
        total: vendors.length,
        normalized: normalizedVendors.length,
        geocoded: successful.length,
        failed: failed.length,
        schemaValid: validVendors.length,
        schemaInvalid: schemaErrors.length,
        synced: syncResult.stats.successful
      }
    };
    
  } catch (error) {
    logger.error('Error in vendor processing workflow:', error);
    return {
      success: false,
      error: error.message,
      stats: {}
    };
  }
}

module.exports = {
  processVendors
};