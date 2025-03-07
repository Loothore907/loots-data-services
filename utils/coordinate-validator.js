// utils/coordinate-validator.js
/**
 * Utility for validating geographic coordinates
 */

// Alaska bounding box (approximate)
const ALASKA_BOUNDS = {
    minLat: 51.0,
    maxLat: 71.5,
    minLng: -179.0, // Crosses dateline
    maxLng: -130.0
  };
  
  /**
   * Validates coordinates to ensure they're valid and within Alaska
   * @param {Object} vendor - Vendor object to validate
   * @returns {Object} - Validation result with issues if any
   */
  function validateVendorCoordinates(vendor) {
    const issues = [];
    const location = vendor.location || {};
    
    // Handle both coordinate structures (nested or flat)
    let lat, lng;
    
    if (location.coordinates) {
      // Nested structure
      lat = parseFloat(location.coordinates.latitude);
      lng = parseFloat(location.coordinates.longitude);
    } else {
      // Flat structure
      lat = parseFloat(location.latitude);
      lng = parseFloat(location.longitude);
    }
    
    // Check if coordinates exist
    if (isNaN(lat) || isNaN(lng)) {
      issues.push('Missing or invalid coordinates');
      return { valid: false, issues };
    }
    
    // Check basic coordinate ranges
    if (lat < -90 || lat > 90) {
      issues.push(`Latitude out of range: ${lat}`);
    }
    
    if (lng < -180 || lng > 180) {
      issues.push(`Longitude out of range: ${lng}`);
    }
    
    // Check Alaska-specific bounds
    // Need special handling for longitude because Alaska crosses the dateline
    const inAlaska = (
      lat >= ALASKA_BOUNDS.minLat && 
      lat <= ALASKA_BOUNDS.maxLat && 
      (lng >= ALASKA_BOUNDS.minLng || lng <= ALASKA_BOUNDS.maxLng)
    );
    
    if (!inAlaska) {
      issues.push(`Coordinates outside Alaska bounds: ${lat}, ${lng}`);
    }
    
    // Check for zero coordinates (often indicates failed geocode)
    if (Math.abs(lat) < 0.001 && Math.abs(lng) < 0.001) {
      issues.push('Near-zero coordinates (likely geocoding failure)');
    }
    
    return { 
      valid: issues.length === 0,
      issues,
      coordinates: { lat, lng }
    };
  }
  
  module.exports = {
    ALASKA_BOUNDS,
    validateVendorCoordinates
  };