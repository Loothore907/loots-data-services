// vendor-processor-ui.js
const express = require('express');
const multer = require('multer');
const fileUpload = require('express-fileupload');
const path = require('path');
const fs = require('fs');
const logger = require('./utils/logger');

// const { DealType, DayOfWeek, DAYS_OF_WEEK } = require('./models/Schema');

// Import routes
const vendorRoutes = require('./routes/vendors');
const workflowRoutes = require('./routes/workflows');
const regionRoutes = require('./routes/region');
// Import deals routes
const dealsRoutes = require('./routes/deals');

// Setup file upload storage for multipart forms
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.resolve('./data/input');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, 'vendors-' + Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ storage });
const app = express();
const PORT = process.env.PORT || 3000;

// Configure express-fileupload
app.use(fileUpload({
  useTempFiles: true,
  tempFileDir: '/tmp/',
  createParentPath: true,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max file size
}));

// Serve static files and set view engine
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');

// Initialize global variables for active workflows
global.activeWorkflows = new Map();

// Dashboard home page with enhanced region stats
app.get('/', async (req, res) => {
  try {
    // Get vendors count
    const { getAdminDb } = require('./config/firebase');
    const db = getAdminDb();
    const countSnapshot = await db.collection('vendors').count().get();
    const vendorCount = countSnapshot.data().count;
    
    // Get deals count
    const dealsSnapshot = await db.collection('deals').where('isActive', '==', true).count().get();
    const dealsCount = dealsSnapshot.data().count;
    
    // Get region information
    const regionSnapshot = await db.collection('regions').get();
    const regions = [];
    regionSnapshot.forEach(doc => {
      regions.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    // Get active regions count
    const activeRegions = regions.filter(r => r.isActive);
    const priorityRegions = regions.filter(r => r.isPriority);
    
    // Get vendors to count by region
    const vendorSnapshot = await db.collection('vendors').get();
    const vendors = [];
    vendorSnapshot.forEach(doc => {
      vendors.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    // Count vendors in active regions
    const { extractZipCodeFromAddress } = require('./models/region');
    const vendorsInActiveRegions = vendors.filter(vendor => {
      if (!vendor.location || !vendor.location.address) return false;
      const zipCode = extractZipCodeFromAddress(vendor.location.address);
      if (!zipCode) return false;
      
      // Check if vendor's zip code is in any active region
      return activeRegions.some(region => 
        region.zipCodes && region.zipCodes.includes(zipCode)
      );
    });
    
    // Count vendors in priority regions
    const vendorsInPriorityRegions = vendors.filter(vendor => {
      if (!vendor.location || !vendor.location.address) return false;
      const zipCode = extractZipCodeFromAddress(vendor.location.address);
      if (!zipCode) return false;
      
      // Check if vendor's zip code is in any priority region
      return priorityRegions.some(region => 
        region.zipCodes && region.zipCodes.includes(zipCode)
      );
    });
    
    // Count partner vendors
    const partnerVendors = vendors.filter(v => v.isPartner);
    
    // Check for recent workflows
    const recentWorkflows = Array.from(global.activeWorkflows || [])
      .slice(0, 5)
      .map(([id, workflow]) => ({
        id,
        status: workflow.status,
        startTime: workflow.startTime,
        endTime: workflow.endTime
      }));
    
    // Render dashboard with stats
    res.render('dashboard', { 
      stats: {
        vendorCount,
        regionCount: regions.length,
        activeRegionCount: activeRegions.length,
        activeCount: vendorsInActiveRegions.length,
        priorityCount: vendorsInPriorityRegions.length,
        partnerCount: partnerVendors.length,
        dealsCount,
        recentWorkflows,
        
        // Add percentage stats
        geocodedPercent: Math.round(vendors.filter(v => 
          v.location && v.location.coordinates && 
          v.location.coordinates.latitude && 
          v.location.coordinates.longitude
        ).length / (vendors.length || 1) * 100),
        
        priorityRegionPercent: Math.round(vendorsInPriorityRegions.length / (vendors.length || 1) * 100),
        
        activeRegionPercent: Math.round(vendorsInActiveRegions.length / (vendors.length || 1) * 100)
      } 
    });
  } catch (error) {
    logger.error('Error loading dashboard:', error);
    res.render('dashboard', { 
      stats: {
        vendorCount: 'Error',
        regionCount: 'Error',
        activeRegionCount: 'Error',
        dealsCount: 'Error',
        recentWorkflows: []
      } 
    });
  }
});

// Mount routes
app.use('/vendors', vendorRoutes);
app.use('/workflows', workflowRoutes);
app.use('/regions', regionRoutes);
app.use('/deals', dealsRoutes);

// Debug script to add to server.js for troubleshooting routes
// Add this right after mounting routes but before error handlers

// Print all registered routes for debugging
console.log('Registered Routes:');
console.log('=================');
console.log('GET /');

function printRoutes(routePrefix, router) {
  if (!router.stack) return;
  
  router.stack.forEach(function(r) {
    if (r.route && r.route.path) {
      Object.keys(r.route.methods).forEach(method => {
        if (r.route.methods[method]) {
          console.log(`${method.toUpperCase()} ${routePrefix}${r.route.path}`);
        }
      });
    } else if (r.name === 'router' && r.handle.stack) {
      // This is a mounted router
      printRoutes(routePrefix, r.handle);
    }
  });
}

// Print routes for each mounted router
console.log('Vendor Routes:');
printRoutes('/vendors', vendorRoutes);

console.log('Workflow Routes:');
printRoutes('/workflows', workflowRoutes);

console.log('Region Routes:');
printRoutes('/regions', regionRoutes);

// Check if all expected route handlers exist
console.log('\nChecking region routes implementation:');
const regionRouteMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(regionRoutes));
console.log('Region route handler methods:', regionRouteMethods);

// Print all express registered routes in a flat list
console.log('\nAll Express Routes:');
function print(path, layer) {
  if (layer.route) {
    const methods = Object.keys(layer.route.methods)
      .filter(method => layer.route.methods[method])
      .join(',');
    console.log(`${methods.toUpperCase()} ${path}${layer.route.path}`);
  } else if (layer.name === 'router' && layer.handle.stack) {
    layer.handle.stack.forEach(print.bind(null, path + layer.regexp.source.replace(/\\\/\?(?=\/|$)/g, '')));
  }
}
app._router.stack.forEach(print.bind(null, ''));

// Error handler
app.use((err, req, res, next) => {
  logger.error('Server error:', err);
  res.status(500).render('error', { error: err.message });
});

// 404 handler
app.use((req, res) => {
  res.status(404).render('error', { error: 'Page not found' });
});

// Start server
app.listen(PORT, () => {
  logger.info(`Loot's Ganja Guide Admin running on http://localhost:${PORT}`);
});