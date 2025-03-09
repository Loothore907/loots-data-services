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
 * Process vendor data through the updated workflow:
 * 1. Import & normalize
 * 2. Filter revoked licenses
 * 3. Filter for priority regions
 * 4. Clean addresses for geocoding
 * 5. Geocode addresses
 * 6. Validate coordinates
 * 7. Transform schema
 * 8. Sync to Firebase (optional)
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
    syncMode = 'merge',                 // Sync mode: merge or overwrite
    collection = 'vendors',             // Firestore collection
    geocodingConcurrency = 2,           // Concurrent geocoding requests
    geocodingDelay = 200,               // Delay between geocoding batches
    skipExistingCoordinates = true,     // Skip vendors that already have coordinates
    skipSync = true,                    // Skip Firebase sync
    provider = '',                      // Geocoding provider override
    deleteAfterArchive = true,          // Delete files after archiving
    deleteAfterSync = true              // Delete output file after sync
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
    
    // Archive the original input file
    const inputDir = path.dirname(input);
    const inputArchiveDir = path.join(inputDir, 'archive');
    if (!fs.existsSync(inputArchiveDir)) {
      fs.mkdirSync(inputArchiveDir, { recursive: true });
    }
    
    const timestamp = new Date().toISOString().replace(/[:\.]/g, '-');
    const archivedInputPath = path.join(inputArchiveDir, `${path.basename(input, '.json')}_processed_${timestamp}.json`);
    fs.copyFileSync(input, archivedInputPath);
    
    // Only remove if configured/requested
    if (deleteAfterArchive) {
      fs.unlinkSync(input);
      logger.info(`Deleted input file after archiving: ${input}`);
    }
    
    logger.info(`Archived input file to ${archivedInputPath}`);
    
    // Normalize vendors
    const normalizedVendors = vendors.map(vendor => normalizeVendor(vendor));
    logger.info(`Normalized ${normalizedVendors.length} vendors`);
    
    // Extract ZIP codes from addresses
    const vendorsWithZip = normalizedVendors.map(vendor => addZipCodeField(vendor));
    logger.info(`Added zip code field to ${vendorsWithZip.length} vendors`);
    
    // Filter out revoked licenses
    const activeVendors = vendorsWithZip.filter(vendor => 
      (vendor.status || '').toLowerCase() !== 'revoked'
    );
    
    const revokedVendors = vendorsWithZip.filter(vendor => 
      (vendor.status || '').toLowerCase() === 'revoked'
    );
    
    logger.info(`Found ${vendorsWithZip.length} total vendors: ${activeVendors.length} active, ${revokedVendors.length} revoked`);
    
    // Save revoked vendors to failures directory if any exist
    if (revokedVendors.length > 0) {
      const failuresDir = path.resolve('./data/failures');
      if (!fs.existsSync(failuresDir)) {
        fs.mkdirSync(failuresDir, { recursive: true });
      }
      
      // Define the path for the revoked vendors file (non-timestamped for persistence)
      const revokedPath = path.join(failuresDir, 'revoked_vendors.json');
      
      // Check if the file already exists
      let existingRevoked = [];
      let newCount = 0;
      let updatedCount = 0;
      
      if (fs.existsSync(revokedPath)) {
        try {
          // Load existing revoked vendors
          existingRevoked = JSON.parse(fs.readFileSync(revokedPath, 'utf8'));
          logger.info(`Loaded ${existingRevoked.length} existing revoked vendors from ${revokedPath}`);
          
          // Create a map of existing vendors by business license for quick lookup
          const existingMap = new Map();
          existingRevoked.forEach(vendor => {
            const key = vendor.business_license || vendor.id;
            if (key) {
              existingMap.set(key, vendor);
            }
          });
          
          // Process new revoked vendors
          revokedVendors.forEach(vendor => {
            const key = vendor.business_license || vendor.id;
            
            if (!key) {
              // No identifier, just add as new
              existingRevoked.push(vendor);
              newCount++;
              logger.debug(`Added new revoked vendor without identifier: ${vendor.name || 'unknown'}`);
            } else if (existingMap.has(key)) {
              // Update existing vendor
              const index = existingRevoked.findIndex(v => 
                (v.business_license || v.id) === key
              );
              
              if (index !== -1) {
                // Merge the records, keeping the existing data but updating with new data
                existingRevoked[index] = {
                  ...existingRevoked[index],
                  ...vendor,
                  lastUpdated: new Date().toISOString()
                };
                updatedCount++;
                logger.debug(`Updated existing revoked vendor: ${key} (${vendor.name || 'unknown'})`);
              }
            } else {
              // Add new vendor
              vendor.lastUpdated = new Date().toISOString();
              existingRevoked.push(vendor);
              newCount++;
              logger.debug(`Added new revoked vendor: ${key} (${vendor.name || 'unknown'})`);
            }
          });
          
        } catch (error) {
          logger.warn(`Error reading existing revoked vendors file: ${error.message}`);
          logger.warn('Creating new revoked vendors file instead');
          existingRevoked = revokedVendors;
          newCount = revokedVendors.length;
        }
      } else {
        // No existing file, use all new revoked vendors
        existingRevoked = revokedVendors;
        newCount = revokedVendors.length;
      }
      
      // Write the updated revoked vendors file
      fs.writeFileSync(revokedPath, JSON.stringify(existingRevoked, null, 2));
      logger.info(`Saved ${existingRevoked.length} revoked vendors to ${revokedPath} (${newCount} new, ${updatedCount} updated)`);
      
      // Also create a timestamped backup
      const revokedBackupPath = path.join(failuresDir, `revoked_vendors_${timestamp}.json`);
      fs.writeFileSync(revokedBackupPath, JSON.stringify(existingRevoked, null, 2));
      logger.info(`Created backup of revoked vendors at ${revokedBackupPath}`);
    }
    
    // STEP 3: Filter for priority regions - use active vendors (not revoked)
    let priorityVendors = activeVendors;
    let nonPriorityVendors = [];
    
    if (priorityOnly) {
      priorityVendors = activeVendors.filter(isPriorityVendor);
      nonPriorityVendors = activeVendors.filter(v => !isPriorityVendor(v));
      
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
        
        const nonPriorityPath = path.join(archiveDir, `non_priority_vendors_${timestamp}.json`);
        fs.writeFileSync(nonPriorityPath, JSON.stringify(nonPriorityVendors, null, 2));
        logger.info(`Archived ${nonPriorityVendors.length} non-priority vendors to ${nonPriorityPath}`);
      }
    }
    
    // STEP 4: Clean addresses for geocoding
    if (cleanAddresses) {
      logger.info('Cleaning addresses for geocoding');
      
      let cleanedCount = 0;
      
      priorityVendors = priorityVendors.map(vendor => {
        if (!vendor.location || !vendor.location.address) return vendor;
        
        const { cleaned, wasModified, modifications, extractedZip } = cleanAddressForGeocoding(vendor.location.address);
        
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
              address: cleaned,
              zipCode: extractedZip || vendor.location.zipCode // Use extracted ZIP or keep existing
            }
          };
        }
        
        // If the address wasn't modified but we extracted a ZIP, add it
        if (extractedZip) {
          logger.debug(`Extracted ZIP for ${vendor.name}: ${extractedZip}`);
          return {
            ...vendor,
            location: {
              ...vendor.location,
              zipCode: extractedZip
            }
          };
        }
        
        return vendor;
      });
      
      logger.info(`Cleaned ${cleanedCount} addresses`);
      
      // Re-extract ZIP codes after address cleaning to ensure consistency
      priorityVendors = priorityVendors.map(vendor => addZipCodeField(vendor));
      logger.info(`Re-extracted zip codes after address cleaning`);
    }
    
    // STEP 5: Geocode Addresses
    logger.info('Starting geocoding process');
    const vendorsToGeocode = skipExistingCoordinates
      ? priorityVendors.filter(v => !v.hasValidCoordinates && (!v.location.coordinates || !v.location.coordinates.latitude || !v.location.coordinates.longitude))
      : priorityVendors;
    
    logger.info(`Geocoding ${vendorsToGeocode.length} vendors`);
    
    const geocodeOptions = {
      concurrency: geocodingConcurrency,
      delayMs: geocodingDelay,
      provider: provider
    };
    
    const geocodeResult = await batchGeocodeVendors(vendorsToGeocode, geocodeOptions);
    
    // Merge geocoded vendors with original list if skipping existing
    const allVendors = skipExistingCoordinates
      ? priorityVendors.map(original => {
          const geocoded = geocodeResult.vendors.find(v => v.id === original.id);
          return geocoded || original;
        })
      : geocodeResult.vendors;
    
    // STEP 6: Validate coordinates
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
      
      // Verify ZIP codes after geocoding
      validVendors = validVendors.map(vendor => addZipCodeField(vendor));
      logger.info(`Verified zip codes after geocoding`);
    }
    
    // Archive geocoded vendors (both valid and invalid)
    const geocodedDir = path.join('./data/processed', 'geocoded');
    if (!fs.existsSync(geocodedDir)) {
      fs.mkdirSync(geocodedDir, { recursive: true });
    }
    
    const geocodeArchiveDir = path.join(geocodedDir, 'archive');
    if (!fs.existsSync(geocodeArchiveDir)) {
      fs.mkdirSync(geocodeArchiveDir, { recursive: true });
    }
    
    // Archive valid coordinates
    const validGeocodePath = path.join(geocodedDir, 'geocoded-valid-latest.json');
    fs.writeFileSync(validGeocodePath, JSON.stringify(validVendors, null, 2));
    
    const archiveValidPath = path.join(geocodeArchiveDir, `geocoded-valid-${timestamp}.json`);
    fs.writeFileSync(archiveValidPath, JSON.stringify(validVendors, null, 2));
    logger.info(`Archived ${validVendors.length} successfully geocoded vendors to ${archiveValidPath}`);
    
    // Delete the processed file after archiving
    if (deleteAfterArchive) {
      fs.unlinkSync(validGeocodePath);
      logger.info(`Deleted processed file after archiving: ${validGeocodePath}`);
    }
    
    // Save invalid coordinates to separate file
    if (invalidVendors.length > 0) {
      const invalidGeocodePath = path.join(geocodedDir, 'geocoded-invalid-latest.json');
      fs.writeFileSync(invalidGeocodePath, JSON.stringify(invalidVendors.map(iv => iv.vendor), null, 2));
      
      const archiveInvalidPath = path.join(geocodeArchiveDir, `geocoded-invalid-${timestamp}.json`);
      fs.writeFileSync(archiveInvalidPath, JSON.stringify(invalidVendors, null, 2));
      logger.info(`Archived ${invalidVendors.length} vendors with invalid coordinates to ${archiveInvalidPath}`);
      
      // Delete the processed file after archiving
      if (deleteAfterArchive) {
        fs.unlinkSync(invalidGeocodePath);
        logger.info(`Deleted processed file after archiving: ${invalidGeocodePath}`);
      }
    }
    
    // STEP 7: Transform Schema
    logger.info('Transforming vendor schema for Firebase');
    const syncReadyVendors = [];
    const schemaErrors = [];
    
    for (const vendor of validVendors) {
      // Ensure the location structure is correct for Firebase
      const processedVendor = {
        ...vendor,
        location: {
          address: vendor.location.originalAddress || vendor.location.address,
          zipCode: vendor.location.zipCode,
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
    
    // Archive finalized vendors
    const finalDir = path.join(outputDir, 'archive');
    if (!fs.existsSync(finalDir)) {
      fs.mkdirSync(finalDir, { recursive: true });
    }
    
    const archiveFinalPath = path.join(finalDir, `${path.basename(output, '.json')}_${timestamp}.json`);
    fs.writeFileSync(archiveFinalPath, JSON.stringify(syncReadyVendors, null, 2));
    logger.info(`Archived ${syncReadyVendors.length} finalized vendors to ${archiveFinalPath}`);
    
    // STEP 8: Check for pending secondary workflow and optionally sync to Firebase
    // Check for pending secondary workflow (failed geocoding)
    const pendingWorkflowCheck = () => {
      const invalidGeocodePath = path.join('./data/processed/geocoded', 'geocoded-invalid-latest.json');
      if (fs.existsSync(invalidGeocodePath)) {
        try {
          const invalidData = JSON.parse(fs.readFileSync(invalidGeocodePath, 'utf8'));
          if (Array.isArray(invalidData) && invalidData.length > 0) {
            return {
              pending: true,
              count: invalidData.length,
              path: invalidGeocodePath
            };
          }
        } catch (error) {
          logger.warn(`Error checking for pending workflow: ${error.message}`);
        }
      }
      return { pending: false };
    };
    
    // Check if there's a pending retry workflow
    const pendingWorkflow = pendingWorkflowCheck();
    
    // Skip sync if requested or if there's a pending workflow
    // By default, we skip sync and require explicit sync command
    let syncResult = { success: true, stats: { successful: 0 } };
    
    if (!skipSync && syncReadyVendors.length > 0) {
      logger.info(`Syncing ${syncReadyVendors.length} vendors to Firestore (mode: ${syncMode})`);
      
      const syncOptions = {
        collection,
        merge: syncMode !== 'overwrite'
      };
      
      syncResult = await syncVendorsToFirestore(syncReadyVendors, syncOptions);
      
      if (!syncResult.success) {
        throw new Error(`Firebase sync failed: ${syncResult.error}`);
      }
      
      logger.info(`Sync completed successfully: ${syncResult.stats.successful} vendors synced`);
      
      // Delete the output file after successful sync
      if (deleteAfterSync) {
        fs.unlinkSync(output);
        logger.info(`Deleted output file after successful sync: ${output}`);
      }
    } else if (pendingWorkflow.pending) {
      logger.info(`===============================================================`);
      logger.info(`ATTENTION: There ${pendingWorkflow.count === 1 ? 'is' : 'are'} ${pendingWorkflow.count} vendor${pendingWorkflow.count === 1 ? '' : 's'} with failed geocoding.`);
      logger.info(`To process these with the backup geocoder, run:`);
      logger.info(`  npm run retry-failed`);
      logger.info(`Once complete, sync the combined results with:`);
      logger.info(`  npm run sync -- --input=${output}`);
      logger.info(`===============================================================`);
    } else if (syncReadyVendors.length > 0) {
      logger.info(`===============================================================`);
      logger.info(`Processing complete! To sync the results with Firebase, run:`);
      logger.info(`  node scripts/sync-firebase.js --input=${output} --no-merge`);
      logger.info(`===============================================================`);
    }
    
    // Return comprehensive results with all stats
    return {
      success: true,
      stats: {
        total: vendors.length,
        priority: priorityVendors.length,
        nonPriority: nonPriorityVendors.length,
        revoked: revokedVendors.length,
        geocoded: validVendors.length,
        invalid: invalidVendors.length,
        schemaValid: syncReadyVendors.length,
        schemaInvalid: schemaErrors.length,
        synced: syncResult?.stats?.successful || 0,
        pendingWorkflow: pendingWorkflow.pending ? pendingWorkflow.count : 0
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