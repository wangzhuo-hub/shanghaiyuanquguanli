/**
 * Test script for Building Save Functionality
 * Tests the exact steps requested
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BASE_URL = 'http://127.0.0.1:2002';
const SCREENSHOT_DIR = join(__dirname, 'test-screenshots');

// Ensure screenshot directory exists
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTest() {
  console.log('🚀 Starting Building Save Functionality Test...\n');
  
  const browser = await chromium.launch({ 
    headless: false,
    slowMo: 500
  });
  
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });
  
  const page = await context.newPage();
  
  try {
    // PREPARATION: Clear localStorage
    console.log('📋 PREPARATION: Clearing localStorage...');
    await page.goto(BASE_URL);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    console.log('✅ localStorage cleared and page reloaded\n');
    
    // Wait for initial load
    console.log('⏳ Waiting 5 seconds for data to load...');
    await sleep(5000);
    
    // STEP 1: Screenshot of loaded dashboard
    console.log('📸 STEP 1: Taking screenshot of dashboard...');
    await page.screenshot({ 
      path: join(SCREENSHOT_DIR, 'step1-dashboard-loaded.png'),
      fullPage: true 
    });
    console.log('✅ Step 1 complete\n');
    
    // STEP 2: Click 楼宇资管 and count buildings
    console.log('📋 STEP 2: Navigating to 楼宇资管...');
    
    const buildingButton = await page.locator('text=楼宇资管').first();
    await buildingButton.click();
    console.log('✅ Clicked 楼宇资管');
    
    await sleep(2000);
    
    await page.screenshot({ 
      path: join(SCREENSHOT_DIR, 'step2-building-management.png'),
      fullPage: true 
    });
    
    // Count buildings - try multiple selectors
    let buildingCount = 0;
    let buildingNames = [];
    
    // Try to find building tabs/cards
    const possibleSelectors = [
      '[role="tab"]',
      'button:has-text("A座")',
      'button:has-text("B座")',
      'button:has-text("C座")',
      '.building-tab',
      '[data-building]'
    ];
    
    for (const selector of possibleSelectors) {
      const elements = await page.locator(selector).all();
      if (elements.length > buildingCount) {
        buildingCount = elements.length;
        buildingNames = [];
        for (const el of elements) {
          const text = await el.textContent();
          if (text) buildingNames.push(text.trim());
        }
      }
    }
    
    console.log(`✅ Step 2 complete: Found ${buildingCount} buildings`);
    console.log(`   Names: ${buildingNames.join(', ')}\n`);
    
    // STEP 3: Click Save button
    console.log('📋 STEP 3: Looking for 保存 button...');
    
    const saveButton = page.locator('button:has-text("保存")').first();
    
    const saveButtonVisible = await saveButton.isVisible().catch(() => false);
    
    if (saveButtonVisible) {
      console.log('✅ Found 保存 button, clicking...');
      await saveButton.click();
      await sleep(1000);
      
      await page.screenshot({ 
        path: join(SCREENSHOT_DIR, 'step3-save-modal.png'),
        fullPage: true 
      });
      
      const modal = page.locator('[role="dialog"], .modal').first();
      const modalVisible = await modal.isVisible().catch(() => false);
      
      if (modalVisible) {
        const modalText = await modal.textContent();
        console.log(`✅ Modal content: ${modalText?.substring(0, 200)}`);
        
        const cancelButton = page.locator('button:has-text("取消")').first();
        const cancelVisible = await cancelButton.isVisible().catch(() => false);
        
        if (cancelVisible) {
          await cancelButton.click();
          console.log('✅ Closed modal\n');
        }
      }
    } else {
      console.log('⚠️  保存 button not found\n');
      await page.screenshot({ 
        path: join(SCREENSHOT_DIR, 'step3-no-save-button.png'),
        fullPage: true 
      });
    }
    
    // STEP 4: Refresh and verify
    console.log('📋 STEP 4: Refreshing page...');
    await page.goto(BASE_URL);
    await sleep(5000);
    
    const buildingButton2 = await page.locator('text=楼宇资管').first();
    await buildingButton2.click();
    await sleep(2000);
    
    await page.screenshot({ 
      path: join(SCREENSHOT_DIR, 'step4-after-refresh.png'),
      fullPage: true 
    });
    
    // Count buildings again
    let buildingCountAfter = 0;
    let buildingNamesAfter = [];
    
    for (const selector of possibleSelectors) {
      const elements = await page.locator(selector).all();
      if (elements.length > buildingCountAfter) {
        buildingCountAfter = elements.length;
        buildingNamesAfter = [];
        for (const el of elements) {
          const text = await el.textContent();
          if (text) buildingNamesAfter.push(text.trim());
        }
      }
    }
    
    console.log(`✅ Step 4 complete: Found ${buildingCountAfter} buildings\n`);
    
    // STEP 5: Report
    console.log('📊 FINAL REPORT:');
    console.log('================');
    console.log(`Buildings before save (Step 2): ${buildingCount}`);
    console.log(`  Names: ${buildingNames.join(', ')}`);
    console.log(`Buildings after refresh (Step 4): ${buildingCountAfter}`);
    console.log(`  Names: ${buildingNamesAfter.join(', ')}`);
    
    if (buildingCount !== buildingCountAfter) {
      console.log(`\n⚠️  WARNING: Building count changed!`);
      console.log(`  Difference: ${buildingCount - buildingCountAfter} buildings`);
    } else {
      console.log(`\n✅ Building count remained the same`);
    }
    
    console.log(`\n📸 Screenshots saved to: ${SCREENSHOT_DIR}`);
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    await page.screenshot({ 
      path: join(SCREENSHOT_DIR, 'error.png'),
      fullPage: true 
    });
  } finally {
    await browser.close();
  }
}

runTest().catch(console.error);
