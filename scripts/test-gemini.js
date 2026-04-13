// Tests all three Gemini prompt chains end-to-end
// Usage: node test-gemini.js

require('dotenv').config();
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL_PRO = 'gemini-1.5-pro-latest';
const MODEL_FLASH = 'gemini-1.5-flash-latest';

async function callGemini(model, systemPrompt, userMessage, temperature = 0.5, maxTokens = 1000) {
  const body = {
    contents: [{ parts: [{ text: userMessage }] }],
    generationConfig: { temperature, maxOutputTokens: maxTokens }
  };

  if (systemPrompt) {
    body.system_instruction = { parts: [{ text: systemPrompt }] };
  }

  const response = await fetch(
    `${GEMINI_BASE}/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }
  );

  const data = await response.json();
  if (!response.ok) throw new Error(`Gemini error: ${JSON.stringify(data)}`);
  return data.candidates[0].content.parts[0].text;
}

async function runTests() {
  console.log('=== Testing Mastodon Marketing LinkedIn Automation ===\n');

  // Load prompts
  const masterPrompt = fs.readFileSync(path.join(__dirname, '../prompts/master-system-prompt.txt'), 'utf8');
  const intelligencePrompt = fs.readFileSync(path.join(__dirname, '../prompts/intelligence-prompt.txt'), 'utf8');
  const qcPrompt = fs.readFileSync(path.join(__dirname, '../prompts/qc-rubric-prompt.txt'), 'utf8');

  // Test 1: Intelligence
  console.log('TEST 1: Intelligence scan...');
  const mockNews = `
    HEADLINE: Google updates local pack algorithm, prioritizes proximity signals | URL: https://example.com/1 | DATE: ${new Date().toISOString()}
    HEADLINE: HomeAdvisor rebrands to Angi, contractor backlash grows | URL: https://example.com/2 | DATE: ${new Date().toISOString()}
    HEADLINE: Construction costs rise 8% in Q1 2025, contractors adjust bids | URL: https://example.com/3 | DATE: ${new Date().toISOString()}
  `;

  const intelligenceResult = await callGemini(
    MODEL_FLASH,
    null,
    `${intelligencePrompt}\n\nNEWS ITEMS TO ANALYZE:\n${mockNews}`,
    0.3, 1000
  );

  console.log('Intelligence result (raw):\n', intelligenceResult.substring(0, 500), '\n');
  const intelligenceJson = JSON.parse(intelligenceResult.replace(/```json\n?/g, '').replace(/```\n?/g, ''));
  console.log('Selected topic:', intelligenceJson.selected_item.topic);
  console.log('Bucket:', intelligenceJson.selected_item.bucket);
  console.log('✓ Intelligence test passed\n');

  // Test 2: Draft generation
  console.log('TEST 2: Draft generation...');
  const draftPrompt = `CONTENT BUCKET: ${intelligenceJson.selected_item.bucket}\n\nTOPIC: ${intelligenceJson.selected_item.topic}\n\nSOURCE: ${intelligenceJson.selected_item.source}\n\nANGLE TO TAKE: ${intelligenceJson.selected_item.angle}\n\nWrite a LinkedIn post for Mastodon Marketing following all voice and format rules.`;

  const draft = await callGemini(MODEL_PRO, masterPrompt, draftPrompt, 0.8, 800);
  console.log('Draft:\n---\n', draft, '\n---\n');
  console.log('✓ Draft generation test passed\n');

  // Test 3: QC scoring
  console.log('TEST 3: QC scoring...');
  const qcResult = await callGemini(
    MODEL_FLASH,
    null,
    `${qcPrompt}\n\nPOST TO SCORE:\n${draft}`,
    0.1, 500
  );

  const qcJson = JSON.parse(qcResult.replace(/```json\n?/g, '').replace(/```\n?/g, ''));
  console.log('QC Scores:', qcJson.scores);
  console.log('Weighted Average:', qcJson.weighted_average);
  console.log('Verdict:', qcJson.verdict);
  console.log('✓ QC scoring test passed\n');

  console.log('=== ALL TESTS PASSED ===');
  console.log('\nNext step: Copy your .env values and import the Make.com blueprints.');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
