import { build } from "esbuild";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const read = (path,encoding) => readFile(new URL(path,root),encoding);
const art = {};
for (const name of (await readdir(new URL("assets/art/",root))).sort()) {
  if (name.endsWith(".webp")) art[name.slice(0,-5)] = "data:image/webp;base64," + await read("assets/art/"+name,"base64");
}
let css = await read("src/game.css","utf8");
for (const match of [...css.matchAll(/url\(\.\.\/(assets\/fonts\/[\w-]+\.ttf)\)/g)]) {
  css=css.replace(match[0],"url(data:font/ttf;base64,"+await read(match[1],"base64")+")");
}
const result=await build({
  absWorkingDir:fileURLToPath(root),entryPoints:["src/game.js"],bundle:true,write:false,
  format:"iife",platform:"browser",target:"es2020",charset:"utf8",legalComments:"inline"
});
const template=await read("src/index.template.html","utf8");
const output=template.replace("/* GAME_STYLE */",()=>css.trim()).replace("GAME_ART",()=>JSON.stringify(art))
  .replace("/* GAME_CODE */",()=>result.outputFiles[0].text.replace(/<\/script/gi,"<\\/script"));
await writeFile(new URL("index.html",root),output.replace(/\r\n/g,"\n"));
