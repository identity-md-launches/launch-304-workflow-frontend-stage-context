import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root=new URL('../../',import.meta.url), dist=new URL('dist/',root);
const server=createServer(async(req,res)=>{
  try{const path=new URL(req.url,'http://localhost').pathname;if(!path.startsWith('/preview/')||path.includes('..'))throw Error();const f=path.slice(9)||'index.html';const data=await readFile(new URL(f,dist));res.setHeader('Content-Type',({html:'text/html',css:'text/css',js:'text/javascript',json:'application/json'})[f.split('.').pop()]||'application/octet-stream');res.end(data);}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:1280,height:1000}});
const evidence={checkedAt:new Date().toISOString(),mode:'Unmocked public-RPC reads in Chromium. No wallet or transactions.',consoleErrors:[],failedRequests:[]};
page.on('pageerror',e=>evidence.consoleErrors.push(e.message));
page.on('requestfailed',r=>evidence.failedRequests.push({url:r.url(),error:r.failure()?.errorText}));
try{
  await page.goto(`http://127.0.0.1:${server.address().port}/preview/`);
  await page.getByRole('button',{name:'Refresh',exact:true}).waitFor({timeout:60000});
  await page.getByText('From onchain events',{exact:false}).waitFor({timeout:60000});
  evidence.status='passed';evidence.week=await page.locator('.week-bar').innerText();evidence.provenance=await page.locator('.provenance').innerText();
  evidence.alerts=await page.getByRole('alert').allTextContents();
  await page.screenshot({path:fileURLToPath(new URL('docs/evidence/desktop-live.png',root)),fullPage:true});
}catch(e){evidence.status='unavailable';evidence.error=e.message;}
finally{await writeFile(new URL('docs/evidence/browser-live.json',root),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence,null,2));await browser.close();await new Promise(r=>server.close(r));}
