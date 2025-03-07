// workflows/process-vendors-updated.js
const fs = require('fs');
const path = require('path');
const { normalizeVendor, validateVendor } = require('../models/vendor');
const { batchGeocodeVendors } = require('../services/geocoding');
const { syncVendorsToFirestore } = require('../services/firebase');
const { isPriorityVendor, getVendorRegion } = require('../config/priority-regions');
const { cleanAddressForGeocoding } = require('../utils/address-cleaner');
const { validateVendorCoordinates } = require('../utils/coordinate-validator');
const logger = require('../utils/logger');

/**
 * Process vendor data through the updated workflow:
 * 1. Import & normalize
 * 2. Filter for priority regions
 * 3. Clean addresses for geocoding
 * 4. Geocode addresses
 * 5. Validate coordinates
 * 6. Transform schema
 * 7. Sync to Firebase
 * 
 * @param {Object} options Configuration options
 * @returns {Promise<Object>} Processing results
 */
async function processVendors(options) {
  const {
    input,                              // Input file path
    output = './data/output/finalized-vendors.json', // Output path for finalized vendors
    priorityOnly = true,                // Process only priority regions
    archiveNonPriority = true,          // Archive non-priority vendors
    cleanAddresses = true,              // Clean addresses before geocoding
    validateCoordinates = true,         // Validate coordinates after geocoding
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
    
    // STEP 2: Filter for priority regions
    let priorityVendors = normalizedVendors;
    let nonPriorityVendors = [];
    
    if (priorityOnly) {
      priorityVendors = normalizedVendors.filter(isPriorityVendor);
      nonPriorityVendors = normalizedVendors.filter(v => !isPriorityVendor(v));
      
      logger.info(`Priority filtering: ${priorityVendors.length} priority vendors, ${nonPriorityVendors.length} non-priority vendors`);
      
      // Group priority vendors by region
      const regionCounts = {};
      priorityVendors.forEach(vendor => {
        const region = getVendorRegion(vendor) || 'Unknown';
        regionCounts[region] = (regionCounts[region] || 0) + 1;
      });
      
      // Log region breakdown
      logger.info('Priority vendors by region:');
      Object.entries(regionCounts).forEach(([region, count]) => {
        logger.info(`  - ${region}: ${count} vendors`);
      });
      
      // Archive non-priority vendors if requested
      if (archiveNonPriority && nonPriorityVendors.length > 0) {
        const archiveDir = path.join('./data/archive', 'non_priority_vendors');
        if (!fs.existsSync(archiveDir)) {
          fs.mkdirSync(archiveDir, { recursive: true });
        }
        
        const timestamp = new Date().toISOString().replace(/[:\.]/g, '-');
        const archivePath = path.join(archiveDir, `non_priority_vendors_${timestamp}.json`);
        fs.writeFileSync(archivePath, JSON.stringify(nonPriorityVendors, null, 2));
        logger.info(`Archived ${nonPriorityVendors.length} non-priority vendors to ${archivePath}`);
      }
    }
    
    // STEP 3: Clean addresses for geocoding
    if (cleanAddresses) {
      logger.info('Cleaning addresses for geocoding');
      
      let cleanedCount = 0;
      
      priorityVendors = priorityVendors.map(vendor => {
        if (!vendor.location || !vendor.location.address) return vendor;
        
        const { cleaned, wasModified, modifications } = cleanAddressForGeocoding(vendor.location.address);
        
        if (wasModified) {
          cleanedCount++;
          logger.debug(`Cleaned address for ${vendor.name}: "${vendor.location.address}" → "${cleaned}"`);
          logger.debug(`Modifications: ${modifications.join(', ')}`);
          
          // Create a copy of the vendor with both original and cleaned address
          return {
            ...vendor,
            location: {
              ...vendor.location,
              originalAddress: vendor.location.address,
              address: cleaned
            }
          };
        }
        
        return vendor;
      });
      
      logger.info(`Cleaned ${cleanedCount} addresses`);
    }
    
    // STEP 4: Geocode Addresses
    logger.info('Starting geocoding process');
    const vendorsToGeocode = skipExistingCoordinates
      ? priorityVendors.filter(v => !v.hasValidCoordinates && (!v.location.coordinates || !v.location.coordinates.latitude || !v.location.coordinates.longitude))
      : priorityVendors;
    
    logger.info(`Geocoding ${vendorsToGeocode.length} vendors`);
    
    const geocodeOptions = {
      concurrency: geocodingConcurrency,
      delayMs: geocodingDelay,
      provider: geocodingProvider
    };
    
    const geocodeResult = await batchGeocodeVendors(vendorsToGeocode, geocodeOptions);
    
    // Merge geocoded vendors with original list if skipping existing
    const allVendors = skipExistingCoordinates
      ? priorityVendors.map(original => {
          const geocoded = geocodeResult.vendors.find(v => v.id === original.id);
          return geocoded || original;
        })
      : geocodeResult.vendors;
    
    // STEP 5: Validate coordinates
    let validVendors = allVendors;
    let invalidVendors = [];
    
    if (validateCoordinates) {
      logger.info('Validating geocoded coordinates');
      
      validVendors = [];
      invalidVendors = [];
      
      allVendors.forEach(vendor => {
        const validationResult = validateVendorCoordinates(vendor);
        
        if (validationResult.valid) {
          validVendors.push(vendor);
        } else {
          logger.warn(`Invalid coordinates for ${vendor.name} (${vendor.id}): ${validationResult.issues.join(', ')}`);
          invalidVendors.push({
            vendor,
            issues: validationResult.issues
          });
        }
      });
      
      logger.info(`Validation results: ${validVendors.length} valid, ${invalidVendors.length} invalid`);
      
      // Save invalid vendors for review
      if (invalidVendors.length > 0) {
        const invalidPath = path.join(path.dirname(output), 'invalid-coordinates.json');
        fs.writeFileSync(invalidPath, JSON.stringify(invalidVendors, null, 2));
        logger.info(`Saved ${invalidVendors.length} vendors with invalid coordinates to ${invalidPath}`);
      }
    }
    
    // STEP 6: Transform Schema
    logger.info('Transforming vendor schema for Firebase');
    const syncReadyVendors = [];
    const schemaErrors = [];
    
    for (const vendor of validVendors) {
      // Ensure the location structure is correct for Firebase
      const processedVendor = {
        ...vendor,
        location: {
          address: vendor.location.originalAddress || vendor.location.address,
          coordinates: {
            latitude: vendor.location.coordinates?.latitude,
            longitude: vendor.location.coordinates?.longitude
          }
        }
      };
      
      // Remove any fields not in schema
      if (processedVendor.location.originalAddress) {
        delete processedVendor.location.originalAddress;
      }
      if (processedVendor.location.formattedAddress) {
        delete processedVendor.location.formattedAddress;
      }
      
      // Validate against schema
      const { error } = validateVendor(processedVendor);
      
      if (error) {
        logger.warn(`Schema validation error for vendor ${vendor.id}: ${error.message}`);
        schemaErrors.push({ vendor: processedVendor, errors: error.details });
      } else {
        syncReadyVendors.push(processedVendor);
      }
    }
    
    logger.info(`Schema validation: ${syncReadyVendors.length} valid, ${schemaErrors.length} invalid`);
    
    // Save finalized vendors regardless of sync
    const outputDir = path.dirname(output);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    fs.writeFileSync(output, JSON.stringify(syncReadyVendors, null, 2));
    logger.info(`Saved ${syncReadyVendors.length} finalized vendors to ${output}`);
    
    // STEP 7: Sync to Firebase
    if (skipSync) {
      logger.info('Skipping Firebase sync as requested');
      return {
        success: true,
        stats: {
          total: vendors.length,
          priority: priorityVendors.length,
          nonPriority: nonPriorityVendors.length,
          geocoded: validVendors.length,
          invalid: invalidVendors.length,
          schemaValid: syncReadyVendors.length,
          schemaInvalid: schemaErrors.length,
          synced: 0
        }
      };
    }

    if (syncReadyVendors.length === 0) {
      logger.warn('No valid vendors to sync to Firebase');
      return {
        success: true,
        stats: {
          total: vendors.length,
          priority: priorityVendors.length,
          nonPriority: nonPriorityVendors.length,
          geocoded: validVendors.length,
          invalid: invalidVendors.length,
          schemaValid: syncReadyVendors.length,
          schemaInvalid: schemaErrors.length,
          synced: 0
        }
      };
    }
    
    logger.info(`Syncing ${syncReadyVendors.length} vendors to Firestore (mode: ${syncMode})`);
    
    const syncOptions = {
      collection,
      merge: syncMode !== 'overwrite'
    };
    
    const syncResult = await syncVendorsToFirestore(syncReadyVendors, syncOptions);
    
    if (!syncResult.success) {
      throw new Error(`Firebase sync failed: ${syncResult.error}`);
    }
    
    logger.info(`Sync completed successfully: ${syncResult.stats.successful} vendors synced`);
    
    // Return comprehensive results
    return {
      success: true,
      stats: {
        total: vendors.length,
        priority: priorityVendors.length,
        nonPriority: nonPriorityVendors.length,
        geocoded: validVendors.length,
        invalid: invalidVendors.length,
        schemaValid: syncReadyVendors.length,
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