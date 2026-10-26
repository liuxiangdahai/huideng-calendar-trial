import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {Readable} from 'node:stream';
import {createLocalService} from '../../service/calendar/local.mjs';
const root = path.resolve(process.env.CALENDAR_STATIC_ROOT || 'static');
const types = {'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8',
  '.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8',
  '.ics':'text/calendar; charset=utf-8','.svg':'image/svg+xml','.ico':'image/x-icon',
  '.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'};
const port = Number(process.env.CALENDAR_PORT || 4173);
const origin = `http://127.0.0.1:${port}`;
const service = createLocalService({databasePath:process.env.CALENDAR_DB_PATH || path.resolve('.calendar-preview/subscriptions.sqlite'),origin});
const server = http.createServer(async(req,res)=>{
  try {
    let urlPath = decodeURIComponent(new URL(req.url,origin).pathname);
    if(urlPath.startsWith('/api/') || urlPath.startsWith('/calendar/') || urlPath==='/healthz') {
      const request = new Request(new URL(req.url,origin),{method:req.method,headers:req.headers,
        ...(!['GET','HEAD'].includes(req.method)?{body:Readable.toWeb(req),duplex:'half'}:{})});
      const response = await service.fetch(request);
      res.writeHead(response.status,Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));return;
    }
    if(urlPath==='/calendar-reminders/config.json' && !process.env.CALENDAR_STATIC_ROOT) {
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
      res.end(JSON.stringify({apiBaseUrl:origin}));return;
    }
    if(urlPath==='/') {res.writeHead(302,{Location:'/calendar-reminders/'});res.end();return;}
    if(urlPath.endsWith('/')) urlPath+='index.html';
    const target=path.resolve(root,'.'+urlPath);
    if(!target.startsWith(root+path.sep)) {res.writeHead(403);res.end();return;}
    if(!fs.existsSync(target)||!fs.statSync(target).isFile()) {res.writeHead(404);res.end('Not found');return;}
    res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream','Cache-Control':'no-store'});
    fs.createReadStream(target).pipe(res);
  } catch {if(!res.headersSent)res.writeHead(400);res.end('Bad request');}
});
server.listen(port,'127.0.0.1',()=>console.log(`Local: ${origin}/calendar-reminders/`));
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{
  server.close(()=>{service.close();process.exit(0);});
  server.closeAllConnections();
});
