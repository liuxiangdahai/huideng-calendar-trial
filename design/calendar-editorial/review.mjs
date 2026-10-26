import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {chromium, expect} from '@playwright/test';

const output=path.resolve('design/calendar-editorial');
const url=pathToFileURL(path.resolve('../藏历日历-视觉提案.html')).href;
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={date:new Date().toISOString(),status:'running',scope:'P1关键画面候选；浏览器模拟，不是全产品验收',viewports:[],errors:[]};
const test=async(name,fn)=>{await fn();(report.checks??=[]).push(name)};
try{
 const page=await browser.newPage({viewport:{width:1440,height:1060},timezoneId:'Asia/Singapore'});
 page.on('pageerror',error=>report.errors.push(error.message));
 await page.addInitScript(()=>localStorage.setItem('huideng.calendar.v2','original-settings-sentinel'));
 await page.goto(url);await expect(page.locator('#app')).toBeVisible();
 await test('新访客空选择，等待自主选择方案',async()=>{await expect(page.locator('#selection-count')).toHaveText('已选 0 项');await expect(page.locator('#reminder-count')).toHaveText('0 项提醒');await expect(page.locator('#subscribe')).toBeDisabled();await expect(page.locator('#search,#reset')).toHaveCount(0)});
 await page.screenshot({path:path.join(output,'review-desktop-empty.png')});
 await test('候选使用独立存储，不写原设置',async()=>{await page.locator('[data-preset=tsok]').click();assert.equal(await page.evaluate(()=>localStorage.getItem('huideng.calendar.v2')),'original-settings-sentinel');assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('huideng.calendar.design-review.v1.v2')).events['guru-tsok'].mode),'remind')});
 await test('全部修行日54项，只有两个荟供日提醒',async()=>{await page.locator('[data-preset=practice]').click();await expect(page.locator('#selection-count')).toHaveText('已选 54 项');await expect(page.locator('#reminder-count')).toHaveText('2 项提醒')});
 await test('无撤销；清空在底部主要操作旁',async()=>{assert.equal(await page.locator('#undo-preset,#preset-undo').count(),0);assert.equal(await page.locator('.action-buttons #clear-selection').count(),1)});
 await page.locator('[data-cal-month]').selectOption('2026-10');
 await page.locator('[data-cal-date="2026-10-21"]').click();
 await page.evaluate(()=>scrollTo(0,0));
 await page.screenshot({path:path.join(output,'review-desktop.png')});
 await page.screenshot({path:path.join(output,'review-desktop-full.png'),fullPage:true});
 for(const [width,height] of [[320,844],[390,844],[545,871],[629,871],[768,1024],[1024,871],[1440,1060],[844,390]]){
   await page.setViewportSize({width,height});
   if(width<1024)await page.locator('#tab-selection').click();
   await page.locator('#clear-selection').click();await page.evaluate(()=>scrollTo(0,0));
   const selection=await page.evaluate(()=>{const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {top:r.top,bottom:r.bottom,width:r.width}};return {overflow:document.documentElement.scrollWidth>innerWidth,firstCategory:rect('.group-card>summary'),bar:rect('.action-bar')}});
   assert.equal(selection.overflow,false,`selection ${width}`);
   if([320,390,545,1024,1440].includes(width)){
     await page.locator('[data-preset=guru]').click();
     await page.locator('.quick-section').screenshot({path:path.join(output,`review-presets-${width}.png`)});
     await page.locator('#clear-selection').click();await page.evaluate(()=>scrollTo(0,0));
   }
   if(width===390){assert.ok(selection.firstCategory.bottom<=selection.bar.top,'390 first category visible');await expect(page.locator('#toast')).toBeHidden({timeout:6000});await page.screenshot({path:path.join(output,'review-phone-selection.png')})}
   await page.locator('[data-preset=practice]').click();
   if(width<1024)await page.locator('#tab-preview').click();
   await page.locator('[data-cal-month]').selectOption('2026-10');await page.locator('[data-cal-date="2026-10-21"]').click();await page.evaluate(()=>scrollTo(0,0));
   const preview=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,cells:document.querySelectorAll('.cal-day').length,visibleDays:[...document.querySelectorAll('.cal-day')].filter(n=>n.getClientRects().length).length,toolbar:document.querySelector('.cal-control-bar').getBoundingClientRect().top}));
   assert.equal(preview.overflow,false,`preview ${width}`);assert.equal(preview.cells,42);
   report.viewports.push({width,height,selection,preview});
   if(width===390){await page.screenshot({path:path.join(output,'review-phone-calendar.png')});await page.screenshot({path:path.join(output,'review-phone-calendar-full.png'),fullPage:true});await page.evaluate(()=>scrollTo(0,document.querySelector('.cal-control-bar').getBoundingClientRect().top+scrollY-12));await page.screenshot({path:path.join(output,'review-phone-calendar-close.png')})}
   if(width===1024)await page.screenshot({path:path.join(output,'review-1024.png')});
 }
 await page.setViewportSize({width:390,height:844});await page.locator('#tab-selection').click();
 await test('清空全部；空选禁用；无搜索、恢复默认及撤销',async()=>{await page.locator('#clear-selection').click();await expect(page.locator('#selection-count')).toHaveText('已选 0 项');await expect(page.locator('#clear-selection')).toBeDisabled();assert.equal(await page.locator('#undo-preset,#preset-undo,#search,#reset').count(),0)});
 await test('标志保持原比例，快捷方案图标可区分且分类一致',async()=>{assert.equal(await page.locator('.brand-logo img').getAttribute('width'),'749');assert.equal(await page.locator('.brand-logo img').getAttribute('height'),'797');const guru=await page.locator('[data-preset=guru] svg').first().innerHTML();const pair=await page.locator('[data-preset=tsok] svg').first().innerHTML();assert.notEqual(guru,pair);assert.equal(await page.locator('[data-group-id=tsok] .group-icon svg').innerHTML(),pair);assert.equal(await page.locator('#preview-zone,.cal-legend').count(),0)});
 await page.locator('[data-preset=guru]').click();
 await test('单项提醒面板可打开关闭',async()=>{await page.locator('[data-reminder-event="guru-tsok"]').click();await expect(page.locator('#reminder-dialog')).toBeVisible();await page.locator('[aria-label="关闭提醒设置"]').click();await expect(page.locator('#reminder-dialog')).toBeHidden()});
 assert.deepEqual(report.errors,[]);
 report.status='passed';
 console.log(JSON.stringify(report,null,2));
}catch(error){report.status='failed';report.failure=error.message;throw error}finally{await fs.writeFile(path.join(output,'review-report.json'),JSON.stringify(report,null,2));await browser.close()}
