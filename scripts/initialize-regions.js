// scripts/initialize-regions.js
const { getAdminDb } = require('../config/firebase');
const logger = require('../utils/logger');
require('dotenv').config();

// Import priority regions from config
const PRIORITY_REGIONS = {
  "Anchorage": [
    "99501", "99502", "99503", "99504", "99505", 
    "99506", "99507", "99508", "99509", "99510", 
    "99511", "99513", "99514", "99515", "99516", 
    "99517", "99518", "99519", "99520", "99521", 
    "99522", "99523", "99524"
  ],
  "MatSu": [
    "99645", "99654", "99623", "99687", "99629", 
    "99652", "99694", "99674", "99688", "99695"
  ],
  "Fairbanks": [
    "99701", "99702", "99703", "99705", "99706", 
    "99707", "99708", "99709", "99710", "99711", 
    "99712", "99714", "99775"
  ],
  "Kenai": [
    "99669", "99611", "99572", "99603", "99635", 
    "99639", "99610", "99664", "99672", "99631"
  ],
  "Juneau": [
    "99801", "99802", "99803", "99811", "99812", 
    "99821"
  ]
};

// Currently active regions - by default, only Anchorage is active
const ACTIVE_REGIONS = ["Anchorage"];

async function initializeRegions() {
  try {
    console.log('Initializing regions from priority regions config...');
    const db = getAdminDb();
    const regionsCollection = db.collection('regions');
    
    // Check if regions already exist
    const snapshot = await regionsCollection.get();
    if (!snapshot.empty) {
      console.log(`Regions collection already contains ${snapshot.size} regions.`);
      console.log('To reinitialize, delete existing regions first.');
      return;
    }
    
    // Create region objects from config
    const regionObjects = Object.entries(PRIORITY_REGIONS).map(([name, zipCodes]) => {
      return {
        name,
        zipCodes,
        isActive: ACTIVE_REGIONS.includes(name),
        isPriority: true,
        lastUpdated: new Date().toISOString()
      };
    });
    
    // Add regions to Firestore
    const batch = db.batch();
    
    regionObjects.forEach(region => {
      const docRef = regionsCollection.doc();
      batch.set(docRef, region);
    });
    
    await batch.commit();
    console.log(`Successfully initialized ${regionObjects.length} regions:`);
    regionObjects.forEach(region => {
      console.log(`- ${region.name}: ${region.zipCodes.length} ZIP codes, Active: ${region.isActive}`);
    });
    
  } catch (error) {
    console.error('Error initializing regions:', error);
  }
}

// Execute the initialization
initializeRegions();