// Run once to find your LinkedIn account ID in GHL
// Usage: node get-ghl-linkedin-account.js

require('dotenv').config();
const fetch = require('node-fetch');

async function getLinkedInAccountId() {
  const url = `https://services.leadconnectorhq.com/social-media-posting/${process.env.GHL_LOCATION_ID}/accounts`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${process.env.GHL_API_KEY}`,
      'Version': '2021-07-28',
      'Content-Type': 'application/json'
    }
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('Error:', data);
    return;
  }

  console.log('\n=== Connected Social Accounts ===\n');

  if (data.accounts && data.accounts.length > 0) {
    data.accounts.forEach(account => {
      console.log(`Platform: ${account.type || account.platform}`);
      console.log(`Name: ${account.name || account.displayName}`);
      console.log(`ID (_id): ${account._id}`);
      console.log(`---`);
    });

    const linkedinAccounts = data.accounts.filter(a =>
      (a.type || a.platform || '').toLowerCase().includes('linkedin')
    );

    if (linkedinAccounts.length > 0) {
      console.log('\n=== YOUR LINKEDIN ACCOUNT ID ===');
      console.log(linkedinAccounts[0]._id);
      console.log('\nCopy this value into your .env file as GHL_LINKEDIN_ACCOUNT_ID');
    } else {
      console.log('\nNo LinkedIn account found. Connect LinkedIn in GHL Social Planner first:');
      console.log('Marketing → Social Planner → Settings → Add LinkedIn Profile/Page');
    }
  } else {
    console.log('No connected accounts found. Connect accounts in GHL Social Planner first.');
    console.log('Raw response:', JSON.stringify(data, null, 2));
  }
}

getLinkedInAccountId().catch(console.error);
