/**
 * Improved Test Script with Proper Building Tab Selectors
 * This version correctly identifies and counts the building tabs
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BASE_URL = 'http://127.0.0.1:2002';
const SCREENSHOT_DIR = join(__dirname, 'test-screenshots-detailed');

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTest() {
  console.log('🚀 Starting Improved Building Save Functionality Test...\n');
  
  const browser = await chromium.launch({ 
    headless: false,
    slowMo: 300
  });
  
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });
  
  const page = await context.newPage();
  
  try {
    // PREPARATION
    console.log('📋 PREPARATION: Clearing localStorage...');
    await page.goto(BASE_URL);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await sleep(5000);
    console.log('✅ localStorage cleared\n');
    
    // STEP 1
    console.log('📸 STEP 1: Dashboard loaded');
    await page.screenshot({ 
      path: join(SCREENSHOT_DIR, 'step1-dashboard.png'),
      fullPage: true 
    });
    console.log('✅ Screenshot saved\n');
    
    // STEP 2
    console.log('📋 STEP 2: Navigating to 楼宇资管...');
    await page.locator('text=楼宇资管').first().click();
    await sleep(2000);
    
    await page.screenshot({ 
      path: join(SCREENSHOT_DIR, 'step2-buildings.png'),
      fullPage: true 
    });
    
    // Count buildings using multiple strategies
    console.log('🔍 Analyzing building tabs...');
    
    // Strategy 1: Look for specific building names
    const buildingNames = ['1号楼', '2号楼', '3号楼', '国际公馆新楼'];
    const foundBuildings = [];
    
    for (const name of buildingNames) {
      const element = page.locator(`text="${name}"`).first();
      const isVisible = await element.isVisible().catch(() => false);
      if (isVisible) {
        foundBuildings.push(name);
        console.log(`  ✓ Found: ${name}`);
      }
    }
    
    // Strategy 2: Count all elements containing "号楼" or building indicators
    const buildingElements = await page.locator('button, div, span').filter({ hasText: /[0-9]号楼|国际公馆/ }).all();
    
    // Get unique building tabs by checking parent elements
    const uniqueBuildings = new Set();
    for (const el of buildingElements) {
      const text = await el.textContent();
      if (text) {
        const match = text.match(/([0-9]号楼|国际公馆新楼)/);
        if (match) {
          uniqueBuildings.add(match[1]);
        }
      }
    }
    
    console.log(`\n✅ Step 2 Results:`);
    console.log(`   Buildings found (Strategy 1): ${foundBuildings.length}`);
    console.log(`   Names: ${foundBuildings.join(', ')}`);
    console.log(`   Buildings found (Strategy 2): ${uniqueBuildings.size}`);
    console.log(`   Names: ${Array.from(uniqueBuildings).join(', ')}\n`);
    
    // STEP 3
    console.log('📋 STEP 3: Clicking 保存 button...');
    
    const saveButton = page.locator('button:has-text("保存")').first();
    await saveButton.click();
    await sleep(1500);
    
    await page.screenshot({ 
      path: join(SCREENSHOT_DIR, 'step3-modal.png'),
      fullPage: true 
    });
    
    // Read modal content
    const modal = page.locator('[role="dialog"]').first();
    const modalText = await modal.textContent().catch(() => '');
    
    console.log('✅ Modal content:');
    console.log(`   ${modalText.substring(0, 150)}...`);
    
    // Check if "暂无变动" is present
    const noChanges = modalText.includes('暂无变动');
    console.log(`   Changes detected: ${noChanges ? 'NO' : 'YES'}\n`);
    
    // Close modal
    await page.locator('button:has-text("取消")').first().click();
    await sleep(500);
    
    // STEP 4
    console.log('📋 STEP 4: Refreshing and verifying...');
    await page.goto(BASE_URL);
    await sleep(5000);
    
    await page.locator('text=楼宇资管').first().click();
    await sleep(2000);
    
    await page.screenshot({ 
      path: join(SCREENSHOT_DIR, 'step4-after-refresh.png'),
      fullPage: true 
    });
    
    // Count buildings again
    const foundBuildingsAfter = [];
    for (const name of buildingNames) {
      const element = page.locator(`text="${name}"`).first();
      const isVisible = await element.isVisible().catch(() => false);
      if (isVisible) {
        foundBuildingsAfter.push(name);
      }
    }
    
    console.log(`✅ Step 4 Results:`);
    console.log(`   Buildings after refresh: ${foundBuildingsAfter.length}`);
    console.log(`   Names: ${foundBuildingsAfter.join(', ')}\n`);
    
    // FINAL REPORT
    console.log('═══════════════════════════════════════');
    console.log('📊 FINAL TEST REPORT');
    console.log('═══════════════════════════════════════\n');
    
    console.log('Step 2 - Buildings before save:');
    console.log(`  Count: ${foundBuildings.length}`);
    console.log(`  Names: ${foundBuildings.join(', ')}\n`);
    
    console.log('Step 3 - Save modal:');
    console.log(`  Status: ${noChanges ? '✅ No changes (expected)' : '⚠️ Changes detected'}\n`);
    
    console.log('Step 4 - Buildings after refresh:');
    console.log(`  Count: ${foundBuildingsAfter.length}`);
    console.log(`  Names: ${foundBuildingsAfter.join(', ')}\n`);
    
    if (foundBuildings.length === foundBuildingsAfter.length) {
      console.log('✅ TEST PASSED: All buildings persisted correctly!');
      console.log('   No data loss detected.');
    } else {
      console.log('❌ TEST FAILED: Building count changed!');
      console.log(`   Before: ${foundBuildings.length}, After: ${foundBuildingsAfter.length}`);
      console.log(`   Lost buildings: ${foundBuildings.filter(b => !foundBuildingsAfter.includes(b)).join(', ')}`);
    }
    
    console.log(`\n📸 Screenshots: ${SCREENSHOT_DIR}`);
    
  } catch (error) {
    console.error('❌ Test error:', error);
    await page.screenshot({ 
      path: join(SCREENSHOT_DIR, 'error.png'),
      fullPage: true 
    });
  } finally {
    await browser.close();
  }
}

runTest().catch(console.error);
