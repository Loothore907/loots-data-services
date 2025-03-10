// workflows/process-vendors-updated.js
const fs = require('fs');
const path = require('path');
const Joi = require('joi');
const { normalizeVendor, validateVendor } = require('../models/vendor');
const { batchGeocodeVendors } = require('../services/geocoding');
const { syncVendorsToFirestore } = require('../services/firebase');
const { isPriorityVendor, getVendorRegion } = require('../config/priority-regions');
const { cleanAddressForGeocoding } = require('../utils/address-cleaner');
const { validateVendorCoordinates } = require('../utils/coordinate-validator');
const { fetchRegionsFromFirestore } = require('../models/region');
const logger = require('../utils/logger');

/**
 * Enhanced vendor schema with region information
 */
const vendorSchemaWithRegion = Joi.object({
  // Existing schema elements
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
  
  // Existing schema elements (continued)
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
 * Extracts zip code from address string
 * @param {string} address - Address string to extract from
 * @returns {string|null} - Extracted ZIP code or null
 */
function extractZipCodeFromAddress(address) {
  if (!address) return null;
  const zipMatch = address.match(/\b(\d{5})(?:-\d{4})?\b/);
  return zipMatch ? zipMatch[1] : null;
}

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
    
    // STEP 7: Fetch regions from Firestore
    logger.info('Fetching regions from Firestore...');
    const regionsResult = await fetchRegionsFromFirestore();
    
    if (!regionsResult.success) {
      logger.warn(`Failed to fetch regions: ${regionsResult.error}. Proceeding without region enhancement.`);
      // Continue with existing workflow
    } else {
      const regions = regionsResult.regions;
      logger.info(`Fetched ${regions.length} regions`);
      
      // STEP 8: Enhance vendors with region information
      logger.info('Enhancing vendors with region information...');
      validVendors = enhanceVendorsWithRegionInfo(validVendors, regions);
      
      // STEP 9: Categorize vendors by region
      logger.info('Categorizing vendors by region...');
      const categorizedVendors = categorizeVendorsByRegion(validVendors);
      
      // Log categorization results
      logger.info(`Categorization results: ${categorizedVendors.activeVendors.length} active, ${categorizedVendors.priorityOnlyVendors.length} priority-only, ${categorizedVendors.otherVendors.length} other`);
      
      // Save categorized vendors if requested
      if (options.saveCategorized) {
        saveCategorizedVendors(categorizedVendors, options.output);
      }
      
      // Sync to Firebase if not skipped
      if (!options.skipSync) {
        logger.info('Syncing categorized vendors to Firestore...');
        const syncResults = await syncCategorizedVendors(categorizedVendors, {
          merge: options.merge || false
        });
        
        // Log sync results
        logger.info('Sync Results:');
        logger.info(`Active Region Vendors: ${syncResults.activeSync.stats.successful} synced, ${syncResults.activeSync.stats.failed} failed`);
        logger.info(`Priority-Only Region Vendors: ${syncResults.prioritySync.stats.successful} synced, ${syncResults.prioritySync.stats.failed} failed`);
        logger.info(`Other Vendors: ${syncResults.otherSync.stats.successful} synced, ${syncResults.otherSync.stats.failed} failed`);
        
        // Delete input file after sync if requested
        if (options.deleteAfterSync && fs.existsSync(options.input)) {
          fs.unlinkSync(options.input);
          logger.info(`Deleted input file after sync: ${options.input}`);
        }
      }
      
      // Return comprehensive results
      return {
        success: true,
        stats: {
          total: vendors.length,
          valid: validVendors.length,
          active: categorizedVendors.activeVendors.length,
          priorityOnly: categorizedVendors.priorityOnlyVendors.length,
          other: categorizedVendors.otherVendors.length,
          invalid: invalidVendors.length,
          geocodeFailed: geocodeResult.failures?.length || 0,
          coordinateInvalid: invalidVendors.length
        }
      };
    }
    
    // STEP 10: Check for pending secondary workflow and optionally sync to Firebase
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
    
    if (!skipSync && validVendors.length > 0) {
      logger.info(`Syncing ${validVendors.length} vendors to Firestore (mode: ${syncMode})`);
      
      const syncOptions = {
        collection,
        merge: syncMode !== 'overwrite'
      };
      
      syncResult = await syncVendorsToFirestore(validVendors, syncOptions);
      
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
    } else if (validVendors.length > 0) {
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
        schemaValid: validVendors.length,
        schemaInvalid: invalidVendors.length,
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

/**
 * Enhanced function to apply region metadata to vendors
 * @param {Array<Object>} vendors - Array of vendor objects
 * @param {Array<Object>} regions - Array of region objects
 * @returns {Array<Object>} - Vendors with region metadata added
 */
function enhanceVendorsWithRegionInfo(vendors, regions) {
  return vendors.map(vendor => {
    // Extract ZIP code from vendor
    const zipCode = vendor.location?.zipCode || 
                   (vendor.location?.address ? extractZipCodeFromAddress(vendor.location.address) : null);
    
    if (!zipCode) {
      // No ZIP code found - set default region info
      vendor.regionInfo = {
        regionId: null,
        regionName: 'Unknown',
        isActiveRegion: false,
        isPriorityRegion: false,
        lastRegionCheck: new Date().toISOString()
      };
      return vendor;
    }
    
    // Find matching region for this ZIP code
    const matchedRegion = regions.find(region => 
      region.zipCodes && region.zipCodes.includes(zipCode)
    );
    
    if (matchedRegion) {
      // Set region information based on the matched region
      vendor.regionInfo = {
        regionId: matchedRegion.id,
        regionName: matchedRegion.name,
        isActiveRegion: matchedRegion.isActive,
        isPriorityRegion: matchedRegion.isPriority,
        lastRegionCheck: new Date().toISOString()
      };
    } else {
      // No matching region found
      vendor.regionInfo = {
        regionId: null,
        regionName: 'Unknown',
        isActiveRegion: false,
        isPriorityRegion: false,
        lastRegionCheck: new Date().toISOString()
      };
    }
    
    return vendor;
  });
}

/**
 * Enhanced function to categorize vendors into collections
 * @param {Array<Object>} vendors - Array of vendor objects with region info
 * @returns {Object} - Categorized vendor objects
 */
function categorizeVendorsByRegion(vendors) {
  const categorized = {
    activeVendors: [],
    priorityOnlyVendors: [],
    otherVendors: []
  };
  
  vendors.forEach(vendor => {
    if (vendor.regionInfo?.isActiveRegion) {
      categorized.activeVendors.push(vendor);
    } else if (vendor.regionInfo?.isPriorityRegion) {
      categorized.priorityOnlyVendors.push(vendor);
    } else {
      categorized.otherVendors.push(vendor);
    }
  });
  
  return categorized;
}

/**
 * Save categorized vendors to separate files
 * @param {Object} categorizedVendors - Categorized vendor objects
 * @param {string} basePath - Base path for output files
 * @returns {Object} - Paths to saved files
 */
function saveCategorizedVendors(categorizedVendors, basePath) {
  const baseDir = path.dirname(basePath);
  const baseFileName = path.basename(basePath, path.extname(basePath));
  const extension = path.extname(basePath);
  
  const outputPaths = {};
  
  // Save active vendors
  if (categorizedVendors.activeVendors.length > 0) {
    const activePath = path.join(baseDir, `${baseFileName}_active${extension}`);
    fs.writeFileSync(activePath, JSON.stringify(categorizedVendors.activeVendors, null, 2));
    logger.info(`Saved ${categorizedVendors.activeVendors.length} active vendors to ${activePath}`);
    outputPaths.activePath = activePath;
  }
  
  // Save priority-only vendors
  if (categorizedVendors.priorityOnlyVendors.length > 0) {
    const priorityPath = path.join(baseDir, `${baseFileName}_priority${extension}`);
    fs.writeFileSync(priorityPath, JSON.stringify(categorizedVendors.priorityOnlyVendors, null, 2));
    logger.info(`Saved ${categorizedVendors.priorityOnlyVendors.length} priority-only vendors to ${priorityPath}`);
    outputPaths.priorityPath = priorityPath;
  }
  
  // Save other vendors
  if (categorizedVendors.otherVendors.length > 0) {
    const otherPath = path.join(baseDir, `${baseFileName}_other${extension}`);
    fs.writeFileSync(otherPath, JSON.stringify(categorizedVendors.otherVendors, null, 2));
    logger.info(`Saved ${categorizedVendors.otherVendors.length} other vendors to ${otherPath}`);
    outputPaths.otherPath = otherPath;
  }
  
  return outputPaths;
}

/**
 * Enhanced sync function to sync vendors based on region categorization
 * @param {Object} categorizedVendors - Categorized vendor objects
 * @param {Object} options - Sync options
 * @returns {Object} - Sync results
 */
async function syncCategorizedVendors(categorizedVendors, options = {}) {
  const { merge = false } = options;
  const results = {};
  
  // Sync active vendors
  if (categorizedVendors.activeVendors.length > 0) {
    logger.info(`Syncing ${categorizedVendors.activeVendors.length} vendors to active collection: vendors`);
    results.activeSync = await syncVendorsToFirestore(categorizedVendors.activeVendors, {
      collection: 'vendors',
      merge
    });
  } else {
    results.activeSync = { stats: { successful: 0, failed: 0 } };
  }
  
  // Sync priority-only vendors
  if (categorizedVendors.priorityOnlyVendors.length > 0) {
    logger.info(`Syncing ${categorizedVendors.priorityOnlyVendors.length} vendors to priority collection: priority_vendors`);
    results.prioritySync = await syncVendorsToFirestore(categorizedVendors.priorityOnlyVendors, {
      collection: 'priority_vendors',
      merge
    });
  } else {
    results.prioritySync = { stats: { successful: 0, failed: 0 } };
  }
  
  // Sync other vendors
  if (categorizedVendors.otherVendors.length > 0) {
    logger.info(`Syncing ${categorizedVendors.otherVendors.length} vendors to other collection: other_vendors`);
    results.otherSync = await syncVendorsToFirestore(categorizedVendors.otherVendors, {
      collection: 'other_vendors',
      merge
    });
  } else {
    results.otherSync = { stats: { successful: 0, failed: 0 } };
  }
  
  return results;
}

module.exports = {
  processVendors
};