// Candidate-only visual acceptance. The HTTPS API response below is a local
// fixture, never delivered in the candidate HTML and never an OS subscription.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
const out=path.resolve('design/calendar-editorial');
const html=(await fs.readFile('../藏历日历-视觉提案.html','utf8'))
  .replace('{"apiBaseUrl":""}','{"apiBaseUrl":"https://calendar-preview.test"}');
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={date:new Date().toISOString(),scope:'候选订阅面板浏览器模拟；合成HTTPS响应，不代表真实手机订阅或通知',cases:[],errors:[]};
const phone='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
const mac='Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15';
try {
  for(const [width,height,mobile,app] of [[320,640,true,'iphone'],[390,844,true,'iphone'],[768,1024,true,'iphone'],[1024,871,false,'iphone'],[1440,1000,false,'google'],[844,390,true,'other']]) {
    const context=await browser.newContext({viewport:{width,height},userAgent:mobile?phone:mac,timezoneId:'Asia/Singapore'});
    const page=await context.newPage();
    page.on('pageerror',error=>report.errors.push(error.message));
    await page.route('https://calendar-preview.test/**',async route=>{
      if(route.request().method()==='POST') {
        const {settings}=route.request().postDataJSON();
        await route.fulfill({json:{id:'visual-fixture',manageToken:'not-a-real-token',feedUrl:'https://calendar-preview.invalid/calendar/review-only.ics',revision:1,settings}});
      } else await route.fulfill({contentType:'text/html',body:html});
    });
    await page.goto('https://calendar-preview.test/');
    await expect(page.locator('#app')).toBeVisible();
    await page.locator('[data-preset=guru]').click();
    await page.locator('#subscribe').click();
    await page.locator(`input[name=device][value=${app}]`).check();
    await expect(page.locator('#copy-feed')).toBeEnabled();
    const dialog=page.locator('#subscription-dialog');
    await dialog.evaluate(node=>{node.scrollTop=0});
    const metrics=await dialog.evaluate(node=>({overflow:node.scrollWidth>node.clientWidth,height:node.getBoundingClientRect().height,available:innerHeight}));
    assert.equal(metrics.overflow,false,`dialog width ${width}`);
    assert.ok(metrics.height<=height,`dialog height ${height}`);
    await expect(page.locator('#guide-seen')).not.toBeChecked();
    await page.screenshot({path:path.join(out,`review-entry-${width}.png`)});
    await page.locator('.guide-add-details>summary').click();
    await expect(page.locator('.guide-add-body').first()).toBeVisible();
    await page.locator('[data-close=subscription-dialog]').last().scrollIntoViewIfNeeded();
    await page.locator('[data-close=subscription-dialog]').last().click();
    await expect(dialog).toBeHidden();
    report.cases.push({viewport:{width,height},app,dialog:metrics});
    await context.close();
  }
  assert.deepEqual(report.errors,[]);report.status='passed';
}catch(error){report.status='failed';report.failure=error.message;throw error;}
finally{await fs.writeFile(path.join(out,'review-entry-report.json'),JSON.stringify(report,null,2));await browser.close();}
console.log(JSON.stringify(report,null,2));
