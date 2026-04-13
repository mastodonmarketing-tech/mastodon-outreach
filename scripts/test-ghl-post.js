// Tests GHL Social Planner API — creates a DRAFT post (status: draft, not published)
// Usage: node test-ghl-post.js
// WARNING: This creates an actual draft in your GHL Social Planner. Delete it after testing.

require('dotenv').config();
const fetch = require('node-fetch');

async function testGhlPost() {
  const testPost = `[TEST POST - DELETE ME]

This is an automated test from the Mastodon Marketing LinkedIn automation system.

If you can see this in GHL Social Planner, the API connection is working correctly.

#TestPost`;

  // Schedule 7 days from now (gives plenty of time to delete before it goes live)
  const scheduleDate = new Date();
  scheduleDate.setDate(scheduleDate.getDate() + 7);
  scheduleDate.setHours(14, 0, 0, 0); // 2pm UTC

  const body = {
    accountIds: [process.env.GHL_LINKEDIN_ACCOUNT_ID],
    summary: testPost,
    scheduleDate: scheduleDate.toISOString(),
    status: "scheduled"
  };

  console.log('Sending test post to GHL...');
  console.log('Location ID:', process.env.GHL_LOCATION_ID);
  console.log('LinkedIn Account ID:', process.env.GHL_LINKEDIN_ACCOUNT_ID);
  console.log('Scheduled for:', scheduleDate.toISOString());

  const response = await fetch(
    `https://services.leadconnectorhq.com/social-media-posting/${process.env.GHL_LOCATION_ID}/posts`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GHL_API_KEY}`,
        'Content-Type': 'application/json',
        'Version': '2021-07-28'
      },
      body: JSON.stringify(body)
    }
  );

  const data = await response.json();

  if (response.ok) {
    console.log('\n✅ SUCCESS! Post created in GHL Social Planner');
    console.log('GHL Post ID:', data._id || data.id);
    console.log('\n⚠️  IMPORTANT: Go to GHL → Marketing → Social Planner and DELETE this test post!');
    console.log('It is scheduled 7 days from now so you have time to delete it.');
  } else {
    console.error('\n❌ FAILED:', JSON.stringify(data, null, 2));
    console.log('\nCommon issues:');
    console.log('1. GHL_LINKEDIN_ACCOUNT_ID not set — run get-ghl-linkedin-account.js first');
    console.log('2. LinkedIn not connected in GHL Social Planner');
    console.log('3. GHL_API_KEY expired or incorrect');
    console.log('4. GHL_LOCATION_ID incorrect');
  }
}

testGhlPost().catch(console.error);
