#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { getAdminDb } = require('../config/firebase');
const logger = require('../utils/logger');

async function extractZipCodes() {
  try {
    const db = getAdminDb();
    const timestamp = new Date().toISOString().replace(/[:\.]/g, '-');
    const archiveDir = path.join('./data/archive', 'zipcodes');

    // Ensure archive directory exists
    if (!fs.existsSync(archiveDir)) {
      fs.mkdirSync(archiveDir, { recursive: true });
    }

    // Function to extract unique ZIP codes from a collection
    async function getZipCodesFromCollection(collectionName) {
      const snapshot = await db.collection(collectionName).get();
      const zipCodes = new Set();
      
      snapshot.forEach(doc => {
        const data = doc.data();
        if (data.location?.zipCode) {
          zipCodes.add(data.location.zipCode);
        }
      });

      return {
        collectionName,
        count: snapshot.size,
        zipCodes: Array.from(zipCodes).sort()
      };
    }

    // Get ZIP codes from both collections
    const [activeVendors, priorityVendors] = await Promise.all([
      getZipCodesFromCollection('vendors'),
      getZipCodesFromCollection('priority_vendors')
    ]);

    // Create summary object
    const summary = {
      timestamp: new Date().toISOString(),
      collections: {
        vendors: {
          totalVendors: activeVendors.count,
          uniqueZipCodes: activeVendors.zipCodes.length,
          zipCodes: activeVendors.zipCodes
        },
        priority_vendors: {
          totalVendors: priorityVendors.count,
          uniqueZipCodes: priorityVendors.zipCodes.length,
          zipCodes: priorityVendors.zipCodes
        }
      },
      analysis: {
        allUniqueZipCodes: Array.from(new Set([
          ...activeVendors.zipCodes,
          ...priorityVendors.zipCodes
        ])).sort(),
        commonZipCodes: activeVendors.zipCodes.filter(zip => 
          priorityVendors.zipCodes.includes(zip)
        ).sort(),
        activeOnlyZipCodes: activeVendors.zipCodes.filter(zip => 
          !priorityVendors.zipCodes.includes(zip)
        ).sort(),
        priorityOnlyZipCodes: priorityVendors.zipCodes.filter(zip => 
          !activeVendors.zipCodes.includes(zip)
        ).sort()
      }
    };

    // Save to file
    const outputPath = path.join(archiveDir, `zipcodes_${timestamp}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2));

    // Log results
    logger.info('ZIP Code Analysis Results:');
    logger.info(`Active Vendors Collection: ${summary.collections.vendors.totalVendors} vendors, ${summary.collections.vendors.uniqueZipCodes} unique ZIP codes`);
    logger.info(`Priority Vendors Collection: ${summary.collections.priority_vendors.totalVendors} vendors, ${summary.collections.priority_vendors.uniqueZipCodes} unique ZIP codes`);
    logger.info(`Total Unique ZIP Codes: ${summary.analysis.allUniqueZipCodes.length}`);
    logger.info(`Common ZIP Codes: ${summary.analysis.commonZipCodes.length}`);
    logger.info(`Active-Only ZIP Codes: ${summary.analysis.activeOnlyZipCodes.length}`);
    logger.info(`Priority-Only ZIP Codes: ${summary.analysis.priorityOnlyZipCodes.length}`);
    logger.info(`Results saved to: ${outputPath}`);

    // Also save latest version without timestamp
    const latestPath = path.join(archiveDir, 'zipcodes_latest.json');
    fs.writeFileSync(latestPath, JSON.stringify(summary, null, 2));
    logger.info(`Latest version saved to: ${latestPath}`);

  } catch (error) {
    logger.error('Error extracting ZIP codes:', error);
    process.exit(1);
  }
}

// Run the extraction
extractZipCodes(); 