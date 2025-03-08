// models/Schema.js
/**
 * Schema definitions for the Loot's Ganja Guide admin dashboard
 * 
 * This file defines the shared enums and constants used throughout the app.
 * It maintains compatibility with the app's Schema.js but only includes
 * what's needed for the admin dashboard.
 */

/**
 * Days of the week enum (lowercase for API compatibility)
 * @readonly
 * @enum {string}
 */
const DayOfWeek = {
    MONDAY: 'monday',
    TUESDAY: 'tuesday',
    WEDNESDAY: 'wednesday',
    THURSDAY: 'thursday',
    FRIDAY: 'friday',
    SATURDAY: 'saturday',
    SUNDAY: 'sunday',
    EVERYDAY: 'everyday'
  };
  
  /**
   * Deal type enum
   * @readonly
   * @enum {string}
   */
  const DealType = {
    BIRTHDAY: 'birthday',
    DAILY: 'daily',
    SPECIAL: 'special',
    EVERYDAY: 'everyday'
  };
  
  /**
   * Interaction type enum
   * @readonly
   * @enum {string}
   */
  const InteractionType = {
    CHECK_IN: 'check-in',
    SOCIAL_POST: 'social-post',
    ROUTE_COMPLETION: 'route-completion'
  };
  
  // Constants
  const DAYS_OF_WEEK = Object.values(DayOfWeek);
  const DEAL_TYPES = Object.values(DealType);
  const INTERACTION_TYPES = Object.values(InteractionType);
  
  /**
   * Validates a deal object against the schema
   * @param {Object} deal - Deal object to validate
   * @returns {boolean} True if valid
   */
  const isValidDeal = (deal) => {
    if (!deal || typeof deal !== 'object') return false;
    
    // Required fields
    const requiredFields = ['description', 'discount'];
    for (const field of requiredFields) {
      if (!deal[field]) return false;
    }
    
    // Restrictions should be an array if present
    if (deal.restrictions && !Array.isArray(deal.restrictions)) {
      return false;
    }
    
    return true;
  };
  
  /**
   * Validates a special deal object against the schema
   * @param {Object} deal - Special deal object to validate
   * @returns {boolean} True if valid
   */
  const isValidSpecialDeal = (deal) => {
    if (!isValidDeal(deal)) return false;
    
    // Additional required fields for special deals
    const additionalFields = ['title', 'startDate', 'endDate'];
    for (const field of additionalFields) {
      if (!deal[field]) return false;
    }
    
    // Validate dates
    try {
      new Date(deal.startDate);
      new Date(deal.endDate);
    } catch (e) {
      return false;
    }
    
    return true;
  };
  
  module.exports = {
    DayOfWeek,
    DealType,
    InteractionType,
    DAYS_OF_WEEK,
    DEAL_TYPES,
    INTERACTION_TYPES,
    isValidDeal,
    isValidSpecialDeal
  };