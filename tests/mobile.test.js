import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const gameUrl=new URL("../index.html",import.meta.url).href;
const store="glimmgrund.mooswiege.v4";

test("Touch play on both entrances, on WebGL and the software renderer", {timeout:180000}, async()=>{
  const browser=await chromium.launch({args:["--enable-unsafe-swiftshader"]});
  try {
    for (const [width,gate,software] of [[390,"moss",false],[360,"copper",true]]) {
      const context=await browser.newContext({viewport:{width,height:744},deviceScaleFactor:1.5,isMobile:true,hasTouch:true,locale:"de-DE"});
      if(software) await context.addInitScript(()=>{
        const get=HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext=function(type,...args) {return type.includes("webgl")?null:get.call(this,type,...args);};
      });
      const page=await context.newPage(),errors=[];
      page.on("pageerror",error=>errors.push(error.message));
      page.on("requestfailed",request=>errors.push(request.url().slice(0,100)));
      await page.clock.install({time:new Date("2026-01-01T00:00:00Z")});
      await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
      await page.goto(gameUrl);await page.clock.runFor(64);
      async function tap(selector) {
        const button=page.locator(selector).first(), box=await button.boundingBox();
        assert.ok(box,selector+" is visible");
        await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);
        await page.evaluate(key=>navigator.locks?.request(key,()=>{}),store);
      }
      const save=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),store);
      assert.equal(await page.locator("#goal-label").innerText(),"Markiere zwei Felsen für Pip");
      for (const sign of await page.locator("[data-sign]").all()) {
        const box=await sign.boundingBox();assert.ok(box && box.x>=0 && box.x+box.width<=width);
      }
      const other=gate==="moss"?"copper":"moss";
      await tap('[data-sign="'+gate+'"]');await tap('[data-sign="'+other+'"]');
      await tap('[data-target-kind="dig"][data-key="1,4"]');
      assert.equal((await save()).shift.orders.length,3);assert.equal((await save()).guided,true);
      await page.clock.runFor(21800);assert.equal(await page.locator('[data-target-kind="cell"]').count(),3);
      assert.ok(Number(await page.locator("#food").innerText())>24);
      await tap("#peace");await tap('[data-action="invite"]');await page.clock.runFor(2000);
      assert.equal(await page.locator('[data-target-kind="visit"]').getAttribute("data-activity"),"arriving");
      assert.equal((await save()).visit.gate,gate);
      await tap("#escort-now");await page.clock.runFor(11200);
      assert.equal(await page.locator('[data-target-kind="person"][data-key="2"]').getAttribute("data-activity"),"escort");
      assert.equal(await page.locator("#keeper-tag").innerText(),"Brumm");
      await tap("#pause");const paused=await save();
      await page.clock.runFor(3000);await page.reload();await page.clock.runFor(64);
      assert.deepEqual((await save()).visit,paused.visit);
      await tap("#pause");await page.clock.runFor(21000);
      assert.equal((await save()).visits,1);assert.equal(await page.locator("#keeper-tag").isVisible(),false);
      assert.equal((await save()).trails.safe[0],gate);
      await tap('[data-action="fit"]');await page.clock.runFor(64);
      await tap('[data-tool="build"]');await tap('[data-blueprint="ward"]');
      const plot=software?'#ward-marks [data-key="4,-2"]':'[data-target-kind="cell"][data-key="4,-2"]';
      await tap(plot);
      assert.equal((await save()).tiles["4,-2"],"ward","Tapping the low floor or its bonus mark builds the watch at the selected gate");
      assert.deepEqual(errors,[]);
      await context.close();
    }
  } finally {await browser.close();}
});
