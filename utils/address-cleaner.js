// utils/address-cleaner.js
/**
 * Utility for cleaning and standardizing addresses for better geocoding results
 */

/**
 * Cleans addresses for better geocoding success
 * @param {string} address - The original address
 * @returns {Object} - Cleaned address and metadata
 */
function cleanAddressForGeocoding(address) {
    const original = address;
    let cleaned = address;
    
    // Track modifications made
    const modifications = [];
    
    // Remove secondary address information while maintaining primary structure
    const secondaryPatterns = [
      // Remove Suite/Unit/Building info
      { pattern: /,?\s*(?:Suite|Ste\.?|Unit|Bldg\.?|Building)\s+[#]?[A-Za-z0-9-]+/gi, name: 'suite/unit info' },
      
      // Remove apartment designations 
      { pattern: /,?\s*(?:Apt\.?|Apartment)\s+[#]?[A-Za-z0-9-]+/gi, name: 'apartment info' },
      
      // Remove floor/space/room designations
      { pattern: /,?\s*(?:Floor|Fl\.?|Space|Sp\.?|Room|Rm\.?)\s+[#]?[A-Za-z0-9-]+/gi, name: 'floor/space info' },
      
      // Remove specific location designators
      { pattern: /\s*(?:Upper|Lower) (?:Level|Floor)/gi, name: 'level designator' },
      { pattern: /\s*(?:Unit|Suite) [A-Za-z0-9#-]+/gi, name: 'unit designator' },
      
      // Remove parenthetical notes
      { pattern: /\s*\(.*?\)/gi, name: 'parenthetical info' },
      
      // Specific patterns from the data
      { pattern: /, UNITED STATES$/i, name: 'country suffix' },
      { pattern: /Lot \d+[,\s]+Block \d+[,\s]+.*?(?=,\s+\w+,\s+AK)/i, name: 'lot/block designation' }
    ];
    
    // Apply each pattern and track changes
    for (const { pattern, name } of secondaryPatterns) {
      const previousText = cleaned;
      cleaned = cleaned.replace(pattern, '');
      
      if (previousText !== cleaned) {
        modifications.push(`Removed ${name}`);
      }
    }
    
    // Clean up any residual formatting issues
    cleaned = cleaned.replace(/,\s*,/g, ',')           // Fix double commas
                     .replace(/\s+,/g, ',')            // Fix spaces before commas
                     .replace(/,+/g, ',')              // Fix multiple commas
                     .replace(/\s+/g, ' ')             // Fix multiple spaces
                     .trim();                          // Trim extra whitespace
    
    // Remove trailing comma
    cleaned = cleaned.replace(/,$/, '');
    
    // Make sure addresses in Alaska have state and ZIP if possible
    if (cleaned.includes('AK') && !cleaned.match(/\b\d{5}\b/)) {
      // Try to add ZIP code if the address has a city but no ZIP
      const cityMatch = cleaned.match(/([^,]+), AK(?:$|,)/i);
      if (cityMatch) {
        // This is a simplified approach - in production you'd want a city->ZIP lookup
        modifications.push('Could not determine ZIP from city');
      }
    }
    
    return {
      original,
      cleaned,
      modifications,
      wasModified: original !== cleaned
    };
  }
  
  module.exports = {
    cleanAddressForGeocoding
  };