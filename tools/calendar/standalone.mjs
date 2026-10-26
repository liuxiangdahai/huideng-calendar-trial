import {buildStandalone} from './release-build.mjs';
const result = await buildStandalone({output:process.argv[2]});
console.log(`离线单文件已生成：${result.output}`);
