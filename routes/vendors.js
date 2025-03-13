// Updated routes/vendors.js with region integration
const express = require('express');
const router = express.Router();
const { getAdminDb } = require('../config/firebase');
const { normalizeVendor, validateVendor } = require('../models/vendor');
const { extractZipCodeFromAddress } = require('../models/region');
const { 
  isVendorActive, 
  getVendorStatusCategory, 
  getStatusBadgeClass,
  filterVendorsByStatus
} = require('../utils/vendor-status');
const logger = require('../utils/logger');
const admin = require('firebase-admin');

// List vendors with pagination, filtering, and region integration
router.get('/', async (req, res) => {
  try {
    const db = getAdminDb();
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const searchTerm = req.query.search || '';
    const status = req.query.status || '';
    const regionName = req.query.region || '';
    const isActiveRegion = req.query.isActiveRegion === 'true';
    const statusCategory = req.query.statusCategory || 'all'; // 'active', 'inactive', 'revoked', 'all'
    const activeBusinessOnly = req.query.activeBusinessOnly === 'true';
    
    // Fetch all regions first
    const regionsSnapshot = await db.collection('regions').get();
    const regions = [];
    regionsSnapshot.forEach(doc => {
      regions.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    // Find active and priority regions for filtering
    const activeRegions = regions.filter(r => r.isActive);
    const priorityRegions = regions.filter(r => r.isPriority);
    
    // Find specific region if requested
    let selectedRegion = null;
    if (regionName) {
      selectedRegion = regions.find(r => r.name === regionName);
    }
    
    // Build query
    let query = db.collection('vendors');
    
    // Add filters if provided
    if (status) {
      query = query.where('status', '==', status);
    }
    
    // Get total count for pagination
    const countSnapshot = await query.count().get();
    const totalVendors = countSnapshot.data().count;
    
    // Apply pagination
    query = query.orderBy('name')
                .limit(limit)
                .offset((page - 1) * limit);
    
    // Execute query
    const snapshot = await query.get();
    let vendors = [];
    
    snapshot.forEach(doc => {
      const vendor = {
        id: doc.id,
        ...doc.data()
      };
      
      // Apply search filter client-side if needed
      if (searchTerm && !vendor.name.toLowerCase().includes(searchTerm.toLowerCase())) {
        return;
      }
      
      // Determine which region(s) the vendor belongs to
      if (vendor.location && vendor.location.address) {
        const zipCode = extractZipCodeFromAddress(vendor.location.address);
        
        if (zipCode) {
          // Check if vendor is in selected region
          if (selectedRegion && !selectedRegion.zipCodes.includes(zipCode)) {
            return; // Skip this vendor if not in the selected region
          }
          
          // Check if vendor should be in active region only
          if (isActiveRegion && !activeRegions.some(r => r.zipCodes.includes(zipCode))) {
            return; // Skip this vendor if not in an active region
          }
          
          // Determine which region the vendor belongs to
          vendor.region = regions.find(r => r.zipCodes.includes(zipCode))?.name || 'Unknown';
          vendor.isInActiveRegion = activeRegions.some(r => r.zipCodes.includes(zipCode));
          vendor.isInPriorityRegion = priorityRegions.some(r => r.zipCodes.includes(zipCode));
        } else {
          vendor.region = 'Unknown';
          vendor.isInActiveRegion = false;
          vendor.isInPriorityRegion = false;
        }
      } else {
        vendor.region = 'Unknown';
        vendor.isInActiveRegion = false;
        vendor.isInPriorityRegion = false;
      }
      
      // Add status category and badge class
      vendor.statusCategory = getVendorStatusCategory(vendor);
      vendor.statusBadgeClass = getStatusBadgeClass(vendor);
      vendor.isActiveVendor = isVendorActive(vendor);
      
      vendors.push(vendor);
    });
    
    // Filter by status category if requested
    if (statusCategory !== 'all') {
      vendors = filterVendorsByStatus(vendors, statusCategory);
    }
    
    // Filter to show only active businesses if requested
    if (activeBusinessOnly) {
      vendors = vendors.filter(v => isVendorActive(v));
    }
    
    // Render the vendor list page
    res.render('vendors/index', {
      vendors,
      pagination: {
        current: page,
        limit,
        total: Math.ceil(totalVendors / limit),
        totalItems: totalVendors
      },
      filters: {
        search: searchTerm,
        status,
        region: regionName,
        isActiveRegion,
        statusCategory,
        activeBusinessOnly
      },
      regions: regions // Pass regions for the filter dropdown
    });
  } catch (error) {
    logger.error('Error fetching vendors:', error);
    res.status(500).render('error', { error: 'Failed to fetch vendors' });
  }
});

// Show vendor creation form
router.get('/new', async (req, res) => {
  try {
    // Fetch regions for the dropdown
    const db = getAdminDb();
    const regionsSnapshot = await db.collection('regions').get();
    const regions = [];
    regionsSnapshot.forEach(doc => {
      regions.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    res.render('vendors/new', { 
      vendor: {},
      regions: regions, 
      errors: {} 
    });
  } catch (error) {
    logger.error('Error loading vendor creation form:', error);
    res.status(500).render('error', { error: 'Failed to load vendor creation form' });
  }
});

// Show single vendor with region information
router.get('/:id', async (req, res) => {
  try {
    const db = getAdminDb();
    const vendorDoc = await db.collection('vendors').doc(req.params.id).get();
    
    if (!vendorDoc.exists) {
      return res.status(404).render('error', { error: 'Vendor not found' });
    }
    
    const vendor = {
      id: vendorDoc.id,
      ...vendorDoc.data()
    };
    
    // Get regions to determine which region the vendor belongs to
    const regionsSnapshot = await db.collection('regions').get();
    const regions = [];
    regionsSnapshot.forEach(doc => {
      regions.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    // Determine which region the vendor belongs to
    if (vendor.location && vendor.location.address) {
      const zipCode = extractZipCodeFromAddress(vendor.location.address);
      
      if (zipCode) {
        const vendorRegion = regions.find(r => r.zipCodes.includes(zipCode));
        if (vendorRegion) {
          vendor.region = vendorRegion.name;
          vendor.regionData = vendorRegion;
          vendor.isInActiveRegion = vendorRegion.isActive;
          vendor.isInPriorityRegion = vendorRegion.isPriority;
        }
      }
    }
    
    // Get deals for this vendor
    let vendorDeals = [];
    try {
      const dealsSnapshot = await db.collection('deals')
        .where('vendorId', '==', req.params.id)
        .orderBy('updatedAt', 'desc')
        .get();
      
      dealsSnapshot.forEach(doc => {
        vendorDeals.push({
          id: doc.id,
          ...doc.data()
        });
      });
    } catch (dealError) {
      logger.warn(`Error fetching deals for vendor ${req.params.id}:`, dealError);
      // Continue rendering the page even if deals fetch fails
    }
    
    res.render('vendors/show', { vendor, regions, deals: vendorDeals });
  } catch (error) {
    logger.error('Error fetching vendor:', error);
    res.status(500).render('error', { error: 'Failed to fetch vendor details' });
  }
});

// Show vendor edit form
router.get('/:id/edit', async (req, res) => {
  try {
    const db = getAdminDb();
    const vendorDoc = await db.collection('vendors').doc(req.params.id).get();
    
    if (!vendorDoc.exists) {
      return res.status(404).render('error', { error: 'Vendor not found' });
    }
    
    const vendor = {
      id: vendorDoc.id,
      ...vendorDoc.data()
    };
    
    // Fetch regions for the dropdown
    const regionsSnapshot = await db.collection('regions').get();
    const regions = [];
    regionsSnapshot.forEach(doc => {
      regions.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    res.render('vendors/edit', { vendor, regions, errors: {} });
  } catch (error) {
    logger.error('Error fetching vendor for edit:', error);
    res.status(500).render('error', { error: 'Failed to fetch vendor for editing' });
  }
});

// Create vendor
router.post('/', async (req, res) => {
  try {
    // Process form data
    const vendorData = {
      ...req.body,
      id: 'new_vendor', // Temporary ID that will be replaced by Firestore
      isPartner: req.body.isPartner === 'on'
    };
    
    // Convert hours and deals from strings to objects if needed
    if (typeof vendorData.hours === 'string') {
      try {
        vendorData.hours = JSON.parse(vendorData.hours);
      } catch (e) {
        vendorData.hours = {};
        logger.warn('Error parsing hours JSON:', e);
      }
    }
    
    if (typeof vendorData.deals === 'string') {
      try {
        vendorData.deals = JSON.parse(vendorData.deals);
      } catch (e) {
        vendorData.deals = [];
        logger.warn('Error parsing deals JSON:', e);
      }
    }
    
    // Normalize and validate
    const normalizedVendor = normalizeVendor(vendorData);
    const { error } = validateVendor(normalizedVendor);
    
    if (error) {
      // Fetch regions for the dropdown
      const db = getAdminDb();
      const regionsSnapshot = await db.collection('regions').get();
      const regions = [];
      regionsSnapshot.forEach(doc => {
        regions.push({
          id: doc.id,
          ...doc.data()
        });
      });
      
      logger.warn('Vendor validation errors:', error.details);
      
      return res.render('vendors/new', {
        vendor: normalizedVendor,
        regions: regions,
        errors: error.details.reduce((acc, curr) => {
          acc[curr.path.join('.')] = curr.message;
          return acc;
        }, {})
      });
    }
    
    // Remove the temporary ID before saving
    delete normalizedVendor.id;
    
    const db = getAdminDb();
    const docRef = await db.collection('vendors').add({
      ...normalizedVendor,
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString()
    });
    
    logger.info(`Created new vendor: ${docRef.id}`);
    res.redirect(`/vendors/${docRef.id}`);
  } catch (error) {
    logger.error('Error creating vendor:', error);
    
    // Add detailed error info for debugging
    if (error.stack) {
      logger.error('Error stack:', error.stack);
    }
    
    // Check if it's a validation error from Firestore
    if (error.code) {
      logger.error('Firestore error code:', error.code);
    }
    
    res.status(500).render('error', { error: 'Failed to create vendor: ' + error.message });
  }
});

// Update vendor
router.post('/:id', async (req, res) => {
  try {
    const db = getAdminDb();
    
    // Get the current vendor to track status changes
    const vendorDoc = await db.collection('vendors').doc(req.params.id).get();
    
    if (!vendorDoc.exists) {
      return res.status(404).render('error', { error: 'Vendor not found' });
    }
    
    const currentVendor = vendorDoc.data();
    const oldStatus = currentVendor.status;
    const oldIsPartner = currentVendor.isPartner || false;
    const newIsPartner = req.body.isPartner === 'on';
    
    // Add ID to the request body
    const vendorData = {
      ...req.body,
      id: req.params.id,
      isPartner: newIsPartner
    };
    
    // Convert hours and deals from strings to objects if needed
    if (typeof vendorData.hours === 'string') {
      try {
        vendorData.hours = JSON.parse(vendorData.hours);
      } catch (e) {
        vendorData.hours = {};
        logger.warn('Error parsing hours JSON:', e);
      }
    }
    
    if (typeof vendorData.deals === 'string') {
      try {
        vendorData.deals = JSON.parse(vendorData.deals);
      } catch (e) {
        vendorData.deals = [];
        logger.warn('Error parsing deals JSON:', e);
      }
    }
    
    // Normalize and validate
    const normalizedVendor = normalizeVendor(vendorData);
    const { error } = validateVendor(normalizedVendor);
    
    if (error) {
      // Fetch regions for the dropdown
      const regionsSnapshot = await db.collection('regions').get();
      const regions = [];
      regionsSnapshot.forEach(doc => {
        regions.push({
          id: doc.id,
          ...doc.data()
        });
      });
      
      logger.warn('Vendor validation errors:', error.details);
      
      return res.render('vendors/edit', {
        vendor: normalizedVendor,
        regions: regions,
        errors: error.details.reduce((acc, curr) => {
          acc[curr.path.join('.')] = curr.message;
          return acc;
        }, {})
      });
    }
    
    // Track status changes
    const updateData = {
      ...normalizedVendor,
      lastUpdated: new Date().toISOString()
    };
    
    // If license status changed, record it in statusChanges
    if (oldStatus !== normalizedVendor.status) {
      updateData.statusLastChangedAt = new Date().toISOString();
      updateData.statusChanges = admin.firestore.FieldValue.arrayUnion({
        from: oldStatus,
        to: normalizedVendor.status,
        date: new Date().toISOString(),
        source: 'manual',
        notes: 'License status updated via vendor edit'
      });
      
      logger.info(`Updated vendor license status: ${req.params.id} from ${oldStatus} to ${normalizedVendor.status}`);
    }
    
    // If partner status changed, record it in statusChanges
    if (oldIsPartner !== newIsPartner) {
      updateData.partnerStatusLastChangedAt = new Date().toISOString();
      updateData.statusChanges = admin.firestore.FieldValue.arrayUnion({
        from: oldIsPartner ? 'Featured Partner' : 'Regular Vendor',
        to: newIsPartner ? 'Featured Partner' : 'Regular Vendor',
        date: new Date().toISOString(),
        source: 'manual',
        notes: `Vendor ${newIsPartner ? 'marked as' : 'removed from'} featured partner status`
      });
      
      logger.info(`Updated vendor partner status: ${req.params.id} from ${oldIsPartner} to ${newIsPartner}`);
    }
    
    await db.collection('vendors').doc(req.params.id).update(updateData);
    
    logger.info(`Updated vendor: ${req.params.id}`);
    res.redirect(`/vendors/${req.params.id}`);
  } catch (error) {
    logger.error('Error updating vendor:', error);
    
    // Add detailed error info for debugging
    if (error.stack) {
      logger.error('Error stack:', error.stack);
    }
    
    // Check if it's a validation error from Firestore
    if (error.code) {
      logger.error('Firestore error code:', error.code);
    }
    
    res.status(500).render('error', { error: 'Failed to update vendor: ' + error.message });
  }
});

// Delete vendor
router.post('/:id/delete', async (req, res) => {
  try {
    const db = getAdminDb();
    await db.collection('vendors').doc(req.params.id).delete();
    
    logger.info(`Deleted vendor: ${req.params.id}`);
    res.redirect('/vendors');
  } catch (error) {
    logger.error('Error deleting vendor:', error);
    res.status(500).render('error', { error: 'Failed to delete vendor' });
  }
});

// Add this route to routes/vendors.js - Quick status update endpoint
router.post('/:id/update-status', async (req, res) => {
  try {
    const { status, returnUrl } = req.body;
    const vendorId = req.params.id;
    
    if (!status) {
      return res.status(400).render('error', { error: 'No status provided' });
    }
    
    // Get the current vendor to track the change
    const db = getAdminDb();
    const vendorDoc = await db.collection('vendors').doc(vendorId).get();
    
    if (!vendorDoc.exists) {
      return res.status(404).render('error', { error: 'Vendor not found' });
    }
    
    const vendor = vendorDoc.data();
    const oldStatus = vendor.status;
    
    // Update vendor status with tracking info
    await db.collection('vendors').doc(vendorId).update({
      status: status,
      lastUpdated: new Date().toISOString(),
      statusLastChangedAt: new Date().toISOString(),
      statusChanges: admin.firestore.FieldValue.arrayUnion({
        from: oldStatus,
        to: status,
        date: new Date().toISOString(),
        source: 'manual',
        notes: req.body.notes || ''
      })
    });
    
    logger.info(`Updated vendor status: ${vendorId} (${vendor.name}) from ${oldStatus} to ${status}`);
    
    // Redirect back to the referring page or the vendor detail page
    const redirectUrl = returnUrl || `/vendors/${vendorId}`;
    return res.redirect(redirectUrl);
  } catch (error) {
    logger.error('Error updating vendor status:', error);
    res.status(500).render('error', { error: 'Failed to update vendor status' });
  }
});

module.exports = router;