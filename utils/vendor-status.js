// utils/vendor-status.js
/**
 * Utility functions for working with vendor license statuses
 */

// Define status categories
const LICENSE_STATUS = {
    // Active business statuses - these vendors are operating
    ACTIVE: [
      'Active-Operating',
      'Active',
      'Operating',
      'Active-Pending Inspection',
      'Pending Inspection',
      'Delegated',
      'Returned'
    ],
    
    // Inactive but not revoked - these vendors are temporarily not operating
    // but may return to active status
    INACTIVE: [
      'Suspended',
      'Expired',
      'Surrendered',
      'Complete',
      'Pending'
    ],
    
    // Revoked - these vendors won't return to operation
    REVOKED: [
      'Revoked'
    ]
  };
  
  /**
   * Checks if a vendor's status indicates an active business
   * @param {Object} vendor - Vendor object with status field
   * @returns {boolean} - True if vendor is considered active
   */
  function isVendorActive(vendor) {
    if (!vendor || !vendor.status) return false;
    return LICENSE_STATUS.ACTIVE.some(
      status => vendor.status.toLowerCase().includes(status.toLowerCase())
    );
  }
  
  /**
   * Checks if a vendor's status indicates revocation
   * @param {Object} vendor - Vendor object with status field
   * @returns {boolean} - True if vendor is revoked
   */
  function isVendorRevoked(vendor) {
    if (!vendor || !vendor.status) return false;
    return LICENSE_STATUS.REVOKED.some(
      status => vendor.status.toLowerCase().includes(status.toLowerCase())
    );
  }
  
  /**
   * Gets a status category for a vendor
   * @param {Object} vendor - Vendor object with status field
   * @returns {string} - 'active', 'inactive', 'revoked', or 'unknown'
   */
  function getVendorStatusCategory(vendor) {
    if (!vendor || !vendor.status) return 'unknown';
    
    const status = vendor.status.toLowerCase();
    
    if (LICENSE_STATUS.ACTIVE.some(s => status.includes(s.toLowerCase()))) {
      return 'active';
    }
    
    if (LICENSE_STATUS.INACTIVE.some(s => status.includes(s.toLowerCase()))) {
      return 'inactive';
    }
    
    if (LICENSE_STATUS.REVOKED.some(s => status.includes(s.toLowerCase()))) {
      return 'revoked';
    }
    
    return 'unknown';
  }
  
  /**
   * Gets status badge classes based on vendor status
   * @param {Object} vendor - Vendor object with status field
   * @returns {string} - Bootstrap badge classes
   */
  function getStatusBadgeClass(vendor) {
    const category = getVendorStatusCategory(vendor);
    
    switch (category) {
      case 'active':
        return 'bg-success';
      case 'inactive':
        return 'bg-warning';
      case 'revoked':
        return 'bg-danger';
      case 'unknown':
      default:
        return 'bg-secondary';
    }
  }
  
  /**
   * Filters a list of vendors by status category
   * @param {Array<Object>} vendors - Array of vendor objects
   * @param {string} categoryFilter - Status category to filter by ('active', 'inactive', 'revoked', 'all')
   * @returns {Array<Object>} - Filtered array of vendors
   */
  function filterVendorsByStatus(vendors, categoryFilter = 'all') {
    if (categoryFilter === 'all') return vendors;
    
    return vendors.filter(vendor => {
      const category = getVendorStatusCategory(vendor);
      return category === categoryFilter;
    });
  }
  
  module.exports = {
    LICENSE_STATUS,
    isVendorActive,
    isVendorRevoked,
    getVendorStatusCategory,
    getStatusBadgeClass,
    filterVendorsByStatus
  };