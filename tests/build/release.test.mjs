import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveBuildOptions,isPublicFile} from '../../tools/calendar/release-build.mjs';
test('remote builds require HTTPS origins and an exact commit; offline mode never inherits API configuration',()=>{
 const version='a'.repeat(40);
 const valid={mode:'trial',apiBaseUrl:'https://calendar.workers.dev',siteOrigin:'https://calendar.pages.dev',version};
 assert.equal(resolveBuildOptions(valid,{}).remote,true);
 for(const apiBaseUrl of ['http://calendar.workers.dev','https://user:secret@calendar.workers.dev','https://calendar.workers.dev/path','https://localhost'])assert.throws(()=>resolveBuildOptions({...valid,apiBaseUrl},{}));
 assert.throws(()=>resolveBuildOptions({...valid,version:'unknown'},{}));
 assert.throws(()=>resolveBuildOptions({...valid,output:'../'},{}));
 assert.equal(resolveBuildOptions({mode:'offline'},{CALENDAR_API_BASE_URL:valid.apiBaseUrl}).apiBaseUrl,'');
});
test('Pages publishes only approved public assets and cannot expose backend, config secrets or databases',()=>{
 for(const file of ['index.html','version.json','calendar-reminders/index.html','calendar-reminders/app-ABC123.js','calendar-reminders/assets/huideng-logo.png','calendar-reminders/licenses/zangli-LICENSE.txt'])assert.equal(isPublicFile(file),true,file);
 for(const file of ['worker/worker.mjs','.env','deployment.local.json','calendar-reminders/assets/.env','calendar-reminders/service.sqlite','calendar-reminders/app.mjs'])assert.equal(isPublicFile(file),false,file);
});
