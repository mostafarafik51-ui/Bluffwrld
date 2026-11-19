// Renders the Bluff ad from the game, frame by frame.
//   node ad/render.js <first frame> <last frame> <out dir> [fps]
// Needs the game served at http://localhost:8000 (python3 -m http.server 8000 in the repo).
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const [first, last, out, fpsArg] = process.argv.slice(2);
const fps = Number(fpsArg || 30);
(async () =>
{
    fs.mkdirSync(out, { recursive : true });
    const browser = await chromium.launch({ args : ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
    const page = await browser.newPage({ viewport : { width : 1080, height : 1920 } });
    page.on("pageerror", (e) => console.log("[page error]", e.message.slice(0, 300)));
    await page.goto("http://localhost:8000/index.html");
    for (let i = 0; i < 90; i++)
    {
        await page.waitForTimeout(2000);
        const ok = await page.evaluate(() => new Promise((r) => { const t = setTimeout(() => r(false), 1500); require(["player", "city"], (p, c) => { clearTimeout(t); r(!!p.initialized && !!c.logo_image && !!c.crescent); }); }));
        if (ok) break;
    }
    await page.evaluate(() => document.fonts.ready.then(() => Promise.all([document.fonts.load("64px 'Permanent Marker'"), document.fonts.load("600 32px 'IBM Plex Mono'")])));
    await page.waitForTimeout(3000);
    await page.addScriptTag({ path : path.join(__dirname, "director.js") });
    await page.waitForFunction(() => window.AD && window.AD.ready, null, { timeout : 30000 });
    for (let f = Number(first); f <= Number(last); f++)
    {
        await page.evaluate(([t, f]) => window.AD.frame(t, f), [f / fps, f]);
        await page.screenshot({ path : path.join(out, "f" + String(f).padStart(4, "0") + ".png") });
    }
    await browser.close();
})();
