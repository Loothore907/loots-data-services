// scripts/verify-regions.js
// This script verifies that the regions collection exists and contains data

const { getAdminDb } = require('../config/firebase');
require('dotenv').config();

async function verifyRegions() {
  try {
    console.log('Verifying regions collection...');
    const db = getAdminDb();
    
    // Check if regions collection exists and has documents
    const regionsSnapshot = await db.collection('regions').get();
    
    console.log(`Found ${regionsSnapshot.size} regions in Firestore.`);
    
    if (regionsSnapshot.empty) {
      console.log('No regions found! You should run the initialization script:');
      console.log('node scripts/initialize-regions.js');
    } else {
      console.log('Regions found:');
      regionsSnapshot.forEach(doc => {
        const region = doc.data();
        console.log(`- ${region.name}: ${region.zipCodes.length} ZIP codes, Active: ${region.isActive}, Priority: ${region.isPriority}`);
      });
    }
    
    // Check router connection
    console.log('\nVerifying routes:');
    const routes = require('../routes/region');
    console.log('Routes module loaded successfully.');
    
    // Check if the module has the correct structure
    console.log(`Routes module type: ${typeof routes}`);
    if (typeof routes === 'function') {
      console.log('Routes appear to be correctly structured as an Express router.');
    } else {
      console.log('WARNING: Routes may not be properly structured!');
    }
    
    console.log('\nPlease verify that server.js includes:');
    console.log('1. const regionRoutes = require(\'./routes/region\');');
    console.log('2. app.use(\'/regions\', regionRoutes);');
    
  } catch (error) {
    console.error('Verification error:', error);
  }
}

verifyRegions(); 