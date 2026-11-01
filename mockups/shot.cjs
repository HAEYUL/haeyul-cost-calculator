const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  for (const [f, w] of [['manager', 1340], ['admin', 1340]]) {
    const p = await b.newPage({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1.5 });
    await p.goto('file://' + __dirname + '/' + f + '.html');
    await p.screenshot({ path: __dirname + '/' + f + '.png', fullPage: true });
  }
  await b.close();
})();
