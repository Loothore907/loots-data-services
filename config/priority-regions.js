// config/priority-regions.js
/**
 * Configuration for priority regions based on ZIP codes
 * Defines areas where services will be deployed first
 */

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
  
  // Flatten all priority ZIP codes into a single array for easy lookup
  const ALL_PRIORITY_ZIPS = Object.values(PRIORITY_REGIONS).flat();
  
  /**
   * Checks if a vendor is in a priority region based on its zipCode
   * @param {Object} vendor - Vendor object to check
   * @returns {boolean} - True if vendor is in a priority region
   */
  function isPriorityVendor(vendor) {
    // First try the dedicated zipCode field
    if (vendor.location && vendor.location.zipCode) {
      return ALL_PRIORITY_ZIPS.includes(vendor.location.zipCode);
    }
    
    // Fall back to address extraction if needed
    if (!vendor.location || !vendor.location.address) return false;
    
    // Extract ZIP from address
    const zipMatch = vendor.location.address.match(/\b(\d{5})\b/);
    if (!zipMatch) return false;
    
    const zip = zipMatch[1];
    return ALL_PRIORITY_ZIPS.includes(zip);
  }
  
  /**
   * Gets the region name for a vendor based on its zipCode
   * @param {Object} vendor - Vendor object to check
   * @returns {string|null} - Region name or null if not in a priority region
   */
  function getVendorRegion(vendor) {
    // First try the dedicated zipCode field
    const zip = vendor.location?.zipCode;
    
    if (zip) {
      // Find the region that contains this ZIP
      for (const [region, zips] of Object.entries(PRIORITY_REGIONS)) {
        if (zips.includes(zip)) {
          return region;
        }
      }
      return null;
    }
    
    // Fall back to address extraction if needed
    if (!vendor.location || !vendor.location.address) return null;
    
    // Extract ZIP from address
    const zipMatch = vendor.location.address.match(/\b(\d{5})\b/);
    if (!zipMatch) return null;
    
    const extractedZip = zipMatch[1];
    
    // Find the region that contains this ZIP
    for (const [region, zips] of Object.entries(PRIORITY_REGIONS)) {
      if (zips.includes(extractedZip)) {
        return region;
      }
    }
    
    return null;
  }
  
  /**
   * Checks if a vendor is in a specific region based on ZIP code
   * @param {Object} vendor - Vendor object to check
   * @param {Object} region - Region object with zipCodes array
   * @returns {boolean} - True if vendor is in the region
   */
  function isVendorInRegion(vendor, region) {
    if (!vendor.location || !vendor.location.zipCode) return false;
    return region.zipCodes.includes(vendor.location.zipCode);
  }
  
  module.exports = {
    PRIORITY_REGIONS,
    ALL_PRIORITY_ZIPS,
    isPriorityVendor,
    getVendorRegion,
    isVendorInRegion
  };