import {waitForRelease} from './verify-release-core.mjs';
const [api,site,version,kind='gateway']=process.argv.slice(2);
const result=await waitForRelease({api,site,version,kind},{onRetry:state=>console.log(JSON.stringify(state))});
console.log(JSON.stringify(result));
