import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { join } from 'path';

async function testBuildingsPage() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('Step 1: Navigating to http://127.0.0.1:2002...');
    await page.goto('http://127.0.0.1:2002', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    
    console.log('Step 2: Taking screenshot of main page...');
    await page.screenshot({ path: 'screenshot-1-main-page.png', fullPage: true });
    console.log('✓ Screenshot saved: screenshot-1-main-page.png');

    console.log('\nStep 3: Clicking on "楼宇资管" in the left sidebar...');
    // Try multiple selectors to find the building management link
    const buildingLink = await page.locator('text=楼宇资管').first();
    await buildingLink.click();
    await page.waitForTimeout(2000);
    
    console.log('Step 4: Taking screenshot of buildings list...');
    await page.screenshot({ path: 'screenshot-2-buildings-list.png', fullPage: true });
    console.log('✓ Screenshot saved: screenshot-2-buildings-list.png');

    // Count buildings
    const buildingRows = await page.locator('table tbody tr').count();
    console.log(`\n📊 Number of buildings shown: ${buildingRows}`);

    // Check if "保存测试楼" is visible
    const testBuildingVisible = await page.locator('text=保存测试楼').isVisible().catch(() => false);
    console.log(`📋 "保存测试楼" visible: ${testBuildingVisible ? '✓ Yes' : '✗ No'}`);

    // Get all building names
    const buildingNames = await page.locator('table tbody tr td:first-child').allTextContents();
    console.log('\n🏢 Buildings found:');
    buildingNames.forEach((name, index) => {
      console.log(`  ${index + 1}. ${name}`);
    });

    console.log('\nStep 5: Looking for green "保存" button in header...');
    // Try to find the save button - it might be in different locations
    const saveButton = await page.locator('button:has-text("保存")').first();
    const saveButtonVisible = await saveButton.isVisible().catch(() => false);
    
    if (saveButtonVisible) {
      console.log('✓ Found "保存" button, clicking...');
      await saveButton.click();
      await page.waitForTimeout(1500);
      
      console.log('Step 6: Taking screenshot of save modal...');
      await page.screenshot({ path: 'screenshot-3-save-modal.png', fullPage: true });
      console.log('✓ Screenshot saved: screenshot-3-save-modal.png');

      // Check modal content
      const modalVisible = await page.locator('[role="dialog"]').isVisible().catch(() => false);
      console.log(`\n💾 Save modal visible: ${modalVisible ? '✓ Yes' : '✗ No'}`);

      if (modalVisible) {
        const modalText = await page.locator('[role="dialog"]').textContent();
        console.log('\n📝 Modal content:');
        console.log(modalText);

        console.log('\nStep 7: Closing modal...');
        // Try to find close button
        const closeButton = await page.locator('[role="dialog"] button:has-text("关闭"), [role="dialog"] button:has-text("取消"), [role="dialog"] [aria-label="Close"]').first();
        const closeButtonVisible = await closeButton.isVisible().catch(() => false);
        
        if (closeButtonVisible) {
          await closeButton.click();
          await page.waitForTimeout(500);
          console.log('✓ Modal closed');
        } else {
          // Try pressing Escape
          await page.keyboard.press('Escape');
          await page.waitForTimeout(500);
          console.log('✓ Modal closed with Escape key');
        }
      }
    } else {
      console.log('✗ "保存" button not found in header');
      console.log('\nSearching for all buttons on the page:');
      const allButtons = await page.locator('button').allTextContents();
      allButtons.forEach((text, index) => {
        if (text.trim()) {
          console.log(`  Button ${index + 1}: "${text}"`);
        }
      });
    }

    // Check for error messages
    console.log('\nStep 8: Checking for error messages...');
    const errorMessages = await page.locator('.error, .alert-error, [role="alert"]').allTextContents();
    if (errorMessages.length > 0) {
      console.log('⚠️  Error messages found:');
      errorMessages.forEach(msg => console.log(`  - ${msg}`));
    } else {
      console.log('✓ No error messages found');
    }

    console.log('\n' + '='.repeat(60));
    console.log('TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`Buildings count: ${buildingRows}`);
    console.log(`"保存测试楼" visible: ${testBuildingVisible ? 'Yes' : 'No'}`);
    console.log(`Save button found: ${saveButtonVisible ? 'Yes' : 'No'}`);
    console.log(`Error messages: ${errorMessages.length > 0 ? 'Yes' : 'No'}`);
    console.log('='.repeat(60));

  } catch (error) {
    console.error('❌ Error during test:', error.message);
    await page.screenshot({ path: 'screenshot-error.png', fullPage: true });
    console.log('Error screenshot saved: screenshot-error.png');
  } finally {
    await browser.close();
  }
}

testBuildingsPage();
