const { getAdminDb } = require('./config/firebase');
const { normalizeDeal, validateDeal } = require('./models/deal');

async function testAddDeal() {
  console.log("====================================");
  console.log("      DEAL CREATION TEST SCRIPT     ");
  console.log("====================================");

  // Test data matching what you've been entering in the form
  const dealData = {
    vendorId: "10646", // Changed to THE GREEN ROOM AK
    dealType: "daily",
    redemptionFrequency: "once_per_day",
    days: ["friday", "saturday", "sunday"],
    title: "Weekend Weed Days",
    description: "Come in and get 25% off all edibles",
    discount: "25% off",
    restrictions: ["NONE"],
    isActive: true,
    saveAndAddAnother: "1"
  };

  console.log("FORM DATA RECEIVED:", JSON.stringify(dealData, null, 2));
  
  // Log days array (same as web form)
  console.log("DAYS ARRAY AFTER PROCESSING:", dealData.days);

  // Normalize the deal data
  const normalized = normalizeDeal(dealData);
  console.log("NORMALIZED DATA BEFORE VALIDATION:", JSON.stringify(normalized, null, 2));

  // Validate the normalized data
  const validationResult = validateDeal(normalized);
  
  if (validationResult.error) {
    // Match the exact format from the web form
    console.log("VALIDATION ERROR:", JSON.stringify(validationResult.error, null, 2));
    console.log("COMPLETE DEAL DATA:", JSON.stringify(normalized, null, 2));
    
    // Log additional details about the validation schemas being used
    console.log("\nADDITIONAL VALIDATION DETAILS:");
    console.log("Schema structure is using:", validationResult.error.details[0]?.type);
    
    // Analyze what validation alternatives were attempted
    if (validationResult.error.details[0]?.context?.details) {
      const details = validationResult.error.details[0].context.details;
      const dealTypeErrors = details.filter(d => d.path[0] === 'dealType');
      console.log("Deal types being checked against:", dealTypeErrors.map(e => e.context?.valids).flat());
    }
    
    return;
  } else {
    console.log("VALIDATION SUCCESS - Deal data passed validation");
    
    try {
      // Add to database
      const db = getAdminDb();
      const docRef = await db.collection('deals').add({
        ...normalized,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      
      console.log("DEAL CREATED SUCCESSFULLY:", docRef.id);
      
      // Fetch and log the created deal for verification
      const newDeal = await db.collection('deals').doc(docRef.id).get();
      console.log("CREATED DEAL IN DATABASE:", JSON.stringify(newDeal.data(), null, 2));
      
    } catch (error) {
      console.error("DATABASE ERROR:", error);
    }
  }
}

// Run the test function
testAddDeal()
  .then(() => console.log("Test script execution completed"))
  .catch(error => console.error("UNEXPECTED ERROR:", error)); 