// routes/region.js
const express = require('express');
const router = express.Router();
const { 
  validateRegion, 
  normalizeRegion, 
  syncRegionsToFirestore,
  fetchRegionsFromFirestore,
  extractZipCodeFromAddress
} = require('../models/region');
const { 
  isVendorActive, 
  isVendorRevoked,
  getVendorStatusCategory, 
  getStatusBadgeClass,
  filterVendorsByStatus
} = require('../utils/vendor-status');
const { getAdminDb } = require('../config/firebase');
const logger = require('../utils/logger');

// List all regions
router.get('/', async (req, res) => {
  try {
    const result = await fetchRegionsFromFirestore();
    
    if (!result.success) {
      logger.error('Error fetching regions:', result.error);
      return res.status(500).render('error', { error: 'Failed to fetch regions' });
    }
    
    // Get vendor count by region for the dashboard
    const db = getAdminDb();
    const vendorSnapshot = await db.collection('vendors').get();
    const vendors = [];
    
    vendorSnapshot.forEach(doc => {
      vendors.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    // Count vendors by region
    const regionStats = result.regions.map(region => {
      const vendorsInRegion = vendors.filter(vendor => {
        if (!vendor.location || !vendor.location.address) return false;
        const zipCode = extractZipCodeFromAddress(vendor.location.address);
        return zipCode && region.zipCodes.includes(zipCode);
      });
      
      return {
        ...region,
        vendorCount: vendorsInRegion.length
      };
    });
    
    res.render('regions/index', { 
      regions: regionStats,
      activeCount: regionStats.filter(r => r.isActive).reduce((sum, r) => sum + r.vendorCount, 0),
      priorityCount: regionStats.filter(r => r.isPriority).reduce((sum, r) => sum + r.vendorCount, 0)
    });
  } catch (error) {
    logger.error('Error loading regions page:', error);
    res.status(500).render('error', { error: 'Failed to load regions page' });
  }
});

// Show region creation form
router.get('/new', (req, res) => {
  res.render('regions/new', { region: {}, errors: {} });
});

// Create new region
router.post('/', async (req, res) => {
  try {
    // Process zip codes input (handle various formats)
    let zipCodes = [];
    if (req.body.zipCodes) {
      // Handle both comma-separated and newline-separated inputs
      zipCodes = req.body.zipCodes
        .split(/[\n,]/)
        .map(zip => zip.trim())
        .filter(zip => /^\d{5}$/.test(zip));
    }
    
    const regionData = {
      name: req.body.name,
      zipCodes: zipCodes,
      isActive: req.body.isActive === 'on',
      isPriority: req.body.isPriority === 'on',
      lastUpdated: new Date().toISOString()
    };
    
    // Normalize and validate
    const normalized = normalizeRegion(regionData);
    const { error } = validateRegion(normalized);
    
    if (error) {
      return res.render('regions/new', { 
        region: regionData, 
        errors: error.details.reduce((acc, detail) => {
          acc[detail.path[0]] = detail.message;
          return acc;
        }, {})
      });
    }
    
    // Save to Firestore
    const db = getAdminDb();
    const docRef = await db.collection('regions').add(normalized);
    
    logger.info(`Created new region: ${docRef.id} (${normalized.name})`);
    res.redirect('/regions');
  } catch (error) {
    logger.error('Error creating region:', error);
    res.status(500).render('error', { error: 'Failed to create region' });
  }
});

// Show region details with status filtering
router.get('/:id', async (req, res) => {
  try {
    const db = getAdminDb();
    const regionDoc = await db.collection('regions').doc(req.params.id).get();
    
    // Get status filter from query params or default to 'active'
    const statusFilter = req.query.statusFilter || 'active';
    
    if (!regionDoc.exists) {
      return res.status(404).render('error', { error: 'Region not found' });
    }
    
    const region = {
      id: regionDoc.id,
      ...regionDoc.data()
    };
    
    // Get vendors in this region
    const vendorSnapshot = await db.collection('vendors').get();
    let vendorsInRegion = [];
    
    vendorSnapshot.forEach(doc => {
      const vendor = {
        id: doc.id,
        ...doc.data()
      };
      
      if (vendor.location && vendor.location.address) {
        const zipCode = extractZipCodeFromAddress(vendor.location.address);
        if (zipCode && region.zipCodes.includes(zipCode)) {
          // Add status category and badge class
          vendor.statusCategory = getVendorStatusCategory(vendor);
          vendor.statusBadgeClass = getStatusBadgeClass(vendor);
          vendor.isActiveVendor = isVendorActive(vendor);
          
          vendorsInRegion.push(vendor);
        }
      }
    });
    
    // First count total vendors by status for stats
    const activeCount = vendorsInRegion.filter(v => getVendorStatusCategory(v) === 'active').length;
    const inactiveCount = vendorsInRegion.filter(v => getVendorStatusCategory(v) === 'inactive').length;
    const revokedCount = vendorsInRegion.filter(v => getVendorStatusCategory(v) === 'revoked').length;
    const totalCount = vendorsInRegion.length;
    
    // Then apply status filtering if not set to 'all'
    if (statusFilter !== 'all') {
      vendorsInRegion = filterVendorsByStatus(vendorsInRegion, statusFilter);
    }
    
    res.render('regions/show', { 
      region, 
      vendors: vendorsInRegion,
      statusFilter,
      stats: {
        activeCount,
        inactiveCount,
        revokedCount,
        totalCount
      }
    });
  } catch (error) {
    logger.error('Error fetching region details:', error);
    res.status(500).render('error', { error: 'Failed to fetch region details' });
  }
});

// Show region edit form
router.get('/:id/edit', async (req, res) => {
  try {
    const db = getAdminDb();
    const regionDoc = await db.collection('regions').doc(req.params.id).get();
    
    if (!regionDoc.exists) {
      return res.status(404).render('error', { error: 'Region not found' });
    }
    
    const region = {
      id: regionDoc.id,
      ...regionDoc.data()
    };
    
    // Format zip codes for textarea display
    region.zipCodesText = region.zipCodes.join(', ');
    
    res.render('regions/edit', { region, errors: {} });
  } catch (error) {
    logger.error('Error loading region for editing:', error);
    res.status(500).render('error', { error: 'Failed to load region for editing' });
  }
});

// Update region
router.post('/:id', async (req, res) => {
  try {
    // Process zip codes input
    let zipCodes = [];
    if (req.body.zipCodes) {
      zipCodes = req.body.zipCodes
        .split(/[\n,]/)
        .map(zip => zip.trim())
        .filter(zip => /^\d{5}$/.test(zip));
    }
    
    const regionData = {
      id: req.params.id,
      name: req.body.name,
      zipCodes: zipCodes,
      isActive: req.body.isActive === 'on',
      isPriority: req.body.isPriority === 'on',
      lastUpdated: new Date().toISOString()
    };
    
    // Normalize and validate
    const normalized = normalizeRegion(regionData);
    const { error } = validateRegion(normalized);
    
    if (error) {
      return res.render('regions/edit', { 
        region: {...regionData, zipCodesText: req.body.zipCodes}, 
        errors: error.details.reduce((acc, detail) => {
          acc[detail.path[0]] = detail.message;
          return acc;
        }, {})
      });
    }
    
    // Save to Firestore
    const db = getAdminDb();
    await db.collection('regions').doc(req.params.id).set(normalized, { merge: true });
    
    logger.info(`Updated region: ${req.params.id} (${normalized.name})`);
    res.redirect(`/regions/${req.params.id}`);
  } catch (error) {
    logger.error('Error updating region:', error);
    res.status(500).render('error', { error: 'Failed to update region' });
  }
});

// Toggle region active status
router.post('/:id/toggle-status', async (req, res) => {
  try {
    const isActive = req.body.isActive === 'true';
    const db = getAdminDb();
    
    await db.collection('regions').doc(req.params.id).update({
      isActive: isActive,
      lastUpdated: new Date().toISOString()
    });
    
    logger.info(`Toggled region ${req.params.id} active status to: ${isActive}`);
    res.redirect(`/regions/${req.params.id}`);
  } catch (error) {
    logger.error('Error toggling region status:', error);
    res.status(500).render('error', { error: 'Failed to toggle region status' });
  }
});

// Toggle region priority status
router.post('/:id/toggle-priority', async (req, res) => {
  try {
    const isPriority = req.body.isPriority === 'true';
    const db = getAdminDb();
    
    await db.collection('regions').doc(req.params.id).update({
      isPriority: isPriority,
      lastUpdated: new Date().toISOString()
    });
    
    logger.info(`Toggled region ${req.params.id} priority status to: ${isPriority}`);
    res.redirect(`/regions/${req.params.id}`);
  } catch (error) {
    logger.error('Error toggling region priority:', error);
    res.status(500).render('error', { error: 'Failed to toggle region priority' });
  }
});

// Delete region
router.post('/:id/delete', async (req, res) => {
  try {
    const db = getAdminDb();
    await db.collection('regions').doc(req.params.id).delete();
    
    logger.info(`Deleted region: ${req.params.id}`);
    res.redirect('/regions');
  } catch (error) {
    logger.error('Error deleting region:', error);
    res.status(500).render('error', { error: 'Failed to delete region' });
  }
});

module.exports = router;