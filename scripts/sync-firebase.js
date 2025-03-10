#!/usr/bin/env node
// scripts/sync-firebase.js - Enhanced with region integration
const fs = require('fs');
const path = require('path');
const { program } = require('commander');
const { syncVendorsToFirestore } = require('../services/firebase');
const { normalizeVendor, validateVendor } = require('../models/vendor');
const { fetchRegionsFromFirestore, extractZipCodeFromAddress } = require('../models/region');
const logger = require('../utils/logger');
require('dotenv').config();

program
  .description('Sync vendors to Firestore with region-based filtering and metadata')
  .requiredOption('-i, --input <path>', 'Input JSON file with vendor data')
  .option('-m, --merge', 'Merge with existing documents', false)
  .option('--dry-run', 'Validate and categorize data without writing to Firestore', false)
  .option('--save-invalid', 'Save invalid vendors to a separate file', true)
  .option('--save-categorized', 'Save categorized vendors to separate files', false)
  .option('--delete-after-sync', 'Delete input file after successful sync', false)
  .parse(process.argv);

const options = program.opts();

/**
 * Enhance vendors with region information
 * @param {Array<Object>} vendors - Array of vendor objects 
 * @param {Array<Object>} regions - Array of region objects
 * @returns {Array<Object>} - Enhanced vendor objects
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
 * Categorize vendors by region status
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
 */
function saveCategorizedVendors(categorizedVendors, basePath) {
  const baseDir = path.dirname(basePath);
  const baseFileName = path.basename(basePath, path.extname(basePath));
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  
  // Save active vendors
  if (categorizedVendors.activeVendors.length > 0) {
    const activePath = path.join(baseDir, `${baseFileName}_active_${timestamp}.json`);
    fs.writeFileSync(activePath, JSON.stringify(categorizedVendors.activeVendors, null, 2));
    logger.info(`Saved ${categorizedVendors.activeVendors.length} active vendors to ${activePath}`);
  }
  
  // Save priority-only vendors
  if (categorizedVendors.priorityOnlyVendors.length > 0) {
    const priorityPath = path.join(baseDir, `${baseFileName}_priority_${timestamp}.json`);
    fs.writeFileSync(priorityPath, JSON.stringify(categorizedVendors.priorityOnlyVendors, null, 2));
    logger.info(`Saved ${categorizedVendors.priorityOnlyVendors.length} priority-only vendors to ${priorityPath}`);
  }
  
  // Save other vendors
  if (categorizedVendors.otherVendors.length > 0) {
    const otherPath = path.join(baseDir, `${baseFileName}_other_${timestamp}.json`);
    fs.writeFileSync(otherPath, JSON.stringify(categorizedVendors.otherVendors, null, 2));
    logger.info(`Saved ${categorizedVendors.otherVendors.length} other vendors to ${otherPath}`);
  }
}

/**
 * Main function to sync vendors to Firestore with region integration
 */
async function syncVendorsWithRegionIntegration() {
  try {
    // Read and parse input file
    const inputPath = path.resolve(options.input);
    if (!fs.existsSync(inputPath)) {
      logger.error(`Input file not found: ${inputPath}`);
      return { success: false, error: 'Input file not found' };
    }
    
    logger.info(`Reading vendors from ${inputPath}`);
    const rawData = fs.readFileSync(inputPath, 'utf8');
    let vendors;
    
    try {
      vendors = JSON.parse(rawData);
    } catch (error) {
      logger.error(`Failed to parse JSON: ${error.message}`);
      return { success: false, error: `Invalid JSON: ${error.message}` };
    }
    
    if (!Array.isArray(vendors)) {
      logger.error('Input file must contain an array of vendors');
      return { success: false, error: 'Input file must contain an array of vendors' };
    }
    
    logger.info(`Found ${vendors.length} vendors to process`);

    // Normalize and validate vendors
    const validVendors = [];
    const invalidVendors = [];

    vendors.forEach(vendor => {
      try {
        const normalized = normalizeVendor(vendor);
        const { error } = validateVendor(normalized);
        
        if (error) {
          logger.warn(`Validation error for vendor ${vendor.id || 'unknown'}: ${error.message}`);
          invalidVendors.push({ vendor, errors: error.details });
        } else {
          validVendors.push(normalized);
        }
      } catch (err) {
        logger.warn(`Error processing vendor ${vendor.id || 'unknown'}: ${err.message}`);
        invalidVendors.push({ vendor, errors: [{ message: err.message }] });
      }
    });

    logger.info(`Validation complete: ${validVendors.length} valid, ${invalidVendors.length} invalid`);

    // Fetch regions from Firestore
    logger.info('Fetching regions from Firestore...');
    const regionsResult = await fetchRegionsFromFirestore();
    
    if (!regionsResult.success) {
      logger.error(`Failed to fetch regions: ${regionsResult.error}`);
      return { success: false, error: 'Failed to fetch regions' };
    }
    
    const regions = regionsResult.regions;
    logger.info(`Fetched ${regions.length} regions`);
    
    // Log region counts by status
    const activeRegions = regions.filter(r => r.isActive);
    const priorityRegions = regions.filter(r => r.isPriority);
    const priorityOnlyRegions = regions.filter(r => r.isPriority && !r.isActive);
    
    logger.info(`Region counts: ${activeRegions.length} active, ${priorityRegions.length} priority, ${priorityOnlyRegions.length} priority-only`);
    
    // Enhance vendors with region information
    logger.info('Enhancing vendors with region information...');
    const enhancedVendors = enhanceVendorsWithRegionInfo(validVendors, regions);
    
    // Categorize vendors by region status
    logger.info('Categorizing vendors by region...');
    const categorizedVendors = categorizeVendorsByRegion(enhancedVendors);
    
    logger.info(`Categorized vendors: ${categorizedVendors.activeVendors.length} active, ${categorizedVendors.priorityOnlyVendors.length} priority-only, ${categorizedVendors.otherVendors.length} other`);
    
    // Save categorized vendors if requested
    if (options.saveCategorized) {
      logger.info('Saving categorized vendors to separate files...');
      saveCategorizedVendors(categorizedVendors, inputPath);
    }
    
    // If dry run, just return the stats without syncing
    if (options.dryRun) {
      logger.info('Dry run completed. No data was written to Firestore.');
      return {
        success: true,
        activeVendorsCount: categorizedVendors.activeVendors.length,
        priorityOnlyVendorsCount: categorizedVendors.priorityOnlyVendors.length,
        otherVendorsCount: categorizedVendors.otherVendors.length,
        invalidVendorsCount: invalidVendors.length
      };
    }

    // Sync to vendors collection (active regions)
    logger.info(`Syncing ${categorizedVendors.activeVendors.length} vendors to active region collection: vendors`);
    const activeSync = await syncVendorsToFirestore(categorizedVendors.activeVendors, {
      collection: 'vendors',
      merge: options.merge
    });

    // Sync to priority_vendors collection (priority-only regions)
    logger.info(`Syncing ${categorizedVendors.priorityOnlyVendors.length} vendors to priority region collection: priority_vendors`);
    const prioritySync = await syncVendorsToFirestore(categorizedVendors.priorityOnlyVendors, {
      collection: 'priority_vendors',
      merge: options.merge
    });

    // Sync "other" vendors to a backup collection if there are any
    let otherSync = { stats: { successful: 0 } };
    if (categorizedVendors.otherVendors.length > 0) {
      logger.info(`Syncing ${categorizedVendors.otherVendors.length} vendors to backup collection: other_vendors`);
      otherSync = await syncVendorsToFirestore(categorizedVendors.otherVendors, {
        collection: 'other_vendors',
        merge: options.merge
      });
    }

    // Log results
    logger.info('Sync Results:');
    logger.info(`Active Region Vendors: ${activeSync.stats.successful} synced`);
    logger.info(`Priority-Only Region Vendors: ${prioritySync.stats.successful} synced`);
    if (categorizedVendors.otherVendors.length > 0) {
      logger.info(`Other Region Vendors: ${otherSync.stats.successful} synced`);
    }

    // Save invalid vendors if requested
    if (invalidVendors.length > 0 && options.saveInvalid) {
      const invalidPath = path.join(path.dirname(inputPath), 'invalid-vendors.json');
      fs.writeFileSync(invalidPath, JSON.stringify(invalidVendors, null, 2));
      logger.info(`Saved ${invalidVendors.length} invalid vendors to ${invalidPath}`);
    }
    
    // Delete input file after successful sync if requested
    if (options.deleteAfterSync) {
      try {
        fs.unlinkSync(inputPath);
        logger.info(`Deleted input file ${inputPath} after successful sync`);
      } catch (error) {
        logger.warn(`Could not delete input file: ${error.message}`);
      }
    }

    return {
      success: true,
      activeRegionStats: activeSync.stats,
      priorityRegionStats: prioritySync.stats,
      otherRegionStats: otherSync.stats,
      invalidVendorsCount: invalidVendors.length
    };
  } catch (error) {
    logger.error('Error during region-based sync:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

syncVendorsWithRegionIntegration()
  .then(result => {
    if (!result.success) {
      logger.error(`Sync failed: ${result.error}`);
      process.exit(1);
    }
    
    logger.info('Sync completed successfully');
    process.exit(0);
  })
  .catch(error => {
    logger.error('Unhandled error:', error);
    process.exit(1);
  });