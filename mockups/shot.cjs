const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  for (const f of process.argv.slice(2)) {
    const p = await b.newPage({ viewport: { width: 1380, height: 900 }, deviceScaleFactor: 1.5 });
    await p.goto('file://' + __dirname + '/' + f + '.html');
    await p.screenshot({ path: __dirname + '/' + f + '.png', fullPage: true });
  }
  await b.close();
})();
