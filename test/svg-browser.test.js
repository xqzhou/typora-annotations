// Run with Playwright installed; TYPORA_PLAYWRIGHT_PATH can point to its package.
// Every helper request is mocked, so this never touches user annotation data.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(process.env.TYPORA_PLAYWRIGHT_PATH || "playwright");

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "typora-svg-ui-"));
  const project = path.resolve(__dirname, "..");
  const svgPath = path.join(temp, "diagram.svg");
  const documentPath = path.join(temp, "notes.md");
  let version = "v1";
  let items = [];
  let source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 300">' +
    '<style>.label{font:14px sans-serif;fill:#333} body{display:none}</style>' +
    '<rect x="0" y="0" width="600" height="300" fill="white"/>' +
    '<rect id="node" x="50" y="50" width="180" height="100" rx="10" fill="#fef3c7" stroke="#d97706"/>' +
    '<text x="70" y="100" class="label">Production</text>' +
    '<text x="330" y="100" class="label">Sandbox</text>' +
    '<text x="330" y="160" font-family="Menlo" font-size="12">svc-prod</text>' +
    '<path d="M240 100 L310 100" stroke="black"/>' +
    '<script>window.svgScriptRan=true</script>' +
    '<foreignObject width="600" height="300"><div xmlns="http://www.w3.org/1999/xhtml">untrusted</div></foreignObject>' +
    '<use href="https://example.org/external.svg#thing"/>' +
    '</svg>';
  fs.writeFileSync(svgPath, source);
  fs.writeFileSync(documentPath, '![Test diagram](diagram.svg)');
  const htmlPath = path.join(temp, "fixture.html");
  fs.writeFileSync(htmlPath, `<!doctype html><meta charset="utf-8">
    <link rel="stylesheet" href="${pathToFileURL(path.join(project, "typora-annotations.css"))}">
    <style>body{margin:0;font:16px sans-serif}content{display:block;position:fixed;inset:0;overflow:auto}
    #write{max-width:800px;margin:auto;padding:60px 20px}img{width:100%;height:auto}p{margin:35px 0}</style>
    <content><div id="write" contenteditable="true"><p>Test prose before the diagram</p>
    <img alt="Test diagram" src="${pathToFileURL(svgPath)}"><p style="height:1000px">More prose</p></div></content>
    <script>window.File={bundle:{filePath:${JSON.stringify(documentPath)}}}</script>
    <script src="${pathToFileURL(path.join(project, "typora-annotations-svg.js"))}"></script>
    <script src="${pathToFileURL(path.join(project, "typora-annotations.js"))}"></script>`);
  const browser = await chromium.launch({ headless: true, ...(process.env.TYPORA_CHROME_PATH
    ? { executablePath: process.env.TYPORA_CHROME_PATH } : { channel: "chrome" }) });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("http://127.0.0.1:17373/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const headers = { "Access-Control-Allow-Origin": "null", "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET, PUT, OPTIONS" };
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
      if (url.pathname === "/v1/svg") return route.fulfill({ json: { imagePath: svgPath, imageSource: "diagram.svg",
        fingerprint: version, svg: source }, headers });
      if (request.method() === "PUT") items = request.postDataJSON().annotations;
      return route.fulfill({ json: { annotations: items, documentId: "fixture", storageExists: true,
        annotationFile: path.join(temp, "fixture.annotations.json") }, headers });
    });
    await page.goto(pathToFileURL(htmlPath).href);
    await page.waitForFunction(() => window.__typoraAnnotations?.storageMode === "json");
    await page.getByRole("button", { name: "批注此图", exact: true }).click();
    await page.getByRole("button", { name: "框选", exact: true }).waitFor({ state: "visible" });
    const passive = page.locator(".ta-svg-surface svg");
    assert.equal(await passive.locator("script, foreignObject").count(), 0);
    assert.equal(await passive.locator("use").getAttribute("href"), null);
    assert.equal(await page.evaluate(() => !!window.svgScriptRan), false);
    assert.notEqual(await page.locator("body").evaluate((body) => getComputedStyle(body).display), "none");

    // A newly generated SVG gets the display fonts automatically, before entering annotation mode.
    source = source.replace(/<foreignObject[\s\S]*?<\/foreignObject>/, "")
      .replace('<rect x="0" y="0" width="600" height="300" fill="white"/>', "");
    fs.writeFileSync(svgPath, source);
    await page.reload();
    await passive.waitFor({ state: "visible" });
    await page.waitForFunction(() => document.querySelector('.ta-svg-surface')?.shadowRoot?.querySelector('svg')?.style.opacity === "1");
    assert.equal(await page.locator(".ta-svg-host").evaluate((el) => getComputedStyle(el).backgroundColor), "rgb(255, 255, 255)",
      "themed transparent SVGs must mask the original glyphs to prevent double text");
    assert((await passive.locator("text").filter({ hasText: "Production" }).evaluate((el) => getComputedStyle(el).fontFamily)).includes("Avenir Next"));
    const codeFont = await passive.locator("text").filter({ hasText: "svc-prod" }).evaluate((el) => getComputedStyle(el).fontFamily);
    assert(codeFont.includes("Source Code Pro"));
    const beforeSource = fs.readFileSync(svgPath, "utf8");
    await page.getByRole("button", { name: "批注此图", exact: true }).click();
    await page.getByRole("button", { name: "完成", exact: true }).waitFor({ state: "visible" });

    async function point(text) {
      const box = await passive.locator("text").filter({ hasText: text }).boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.getByRole("toolbar", { name: "添加批注" }).waitFor({ state: "visible" });
    }
    async function comment(text) {
      await page.getByRole("button", { name: "评论", exact: true }).click();
      await page.getByRole("dialog", { name: "添加评论" }).getByRole("textbox").fill(text);
      await page.getByRole("button", { name: "添加", exact: true }).click();
    }
    await point("Production");
    await comment("Explain production permissions");
    await page.waitForFunction(() => window.__typoraAnnotations.items.length === 1);
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await page.waitForTimeout(220); // Wait for the editor's sidebar transition.
    await page.getByRole("button", { name: "框选", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.ta-svg-tools button[data-mode="region"][aria-pressed="true"]'));
    const canvas = await passive.boundingBox();
    await page.mouse.move(canvas.x + canvas.width * .05, canvas.y + canvas.height * .1);
    await page.mouse.down();
    await page.mouse.move(canvas.x + canvas.width * .45, canvas.y + canvas.height * .6);
    await page.mouse.up();
    await page.getByRole("toolbar", { name: "添加批注" }).waitFor({ state: "visible" });
    await comment("Review this whole module");
    await page.waitForFunction(() => window.__typoraAnnotations.items.length === 2);
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByRole("button", { name: "完成", exact: true }).click();
    await page.waitForTimeout(240);
    const saved = await page.evaluate(() => window.__typoraAnnotations.items);
    assert.equal(saved[0].anchor.target.tag, "text");
    assert.equal(saved[0].anchor.quote, "Production");
    assert.equal(saved[1].anchor.target, null);
    assert(saved[1].anchor.bounds.width > 200 && saved[1].anchor.bounds.width < 260);
    assert(saved[1].anchor.quote.includes("Production"));
    assert.equal(await page.locator(".ta-svg-annotation").count(), 2);
    await page.waitForFunction(() => window.__typoraAnnotations.items.length === 2);
    assert.equal(items.length, 2, "mock JSON persistence received both annotations");
    assert.equal(fs.readFileSync(svgPath, "utf8"), beforeSource, "the display theme must not rewrite source SVG");

    // A new document session must recover saved SVG anchors without selecting the image.
    await page.reload();
    await page.waitForFunction(() => window.__typoraAnnotations?.items.length === 2);
    await page.locator(".ta-svg-annotation").nth(1).waitFor({ state: "visible" });
    await page.setViewportSize({ width: 900, height: 750 });
    await page.waitForTimeout(120);
    const targetBox = await passive.locator("text").filter({ hasText: "Production" }).boundingBox();
    const annotationBox = await page.locator(".ta-svg-annotation").first().boundingBox();
    assert(Math.abs(targetBox.x - annotationBox.x) < 2 && Math.abs(targetBox.width - annotationBox.width) < 2,
      "element highlight follows image resizing");

    await page.locator("content").evaluate((el) => { el.scrollTop = 500; });
    await page.getByRole("button", { name: "打开批注列表" }).click();
    await page.locator(".ta-card").filter({ hasText: "图中元素" }).getByRole("button", { name: "评论：Production，定位到原文" }).click();
    await page.waitForTimeout(500);
    const located = await page.locator("#write img").boundingBox();
    assert(located.y < 500 && located.y + located.height > 0, "sidebar locates the SVG after scrolling");

    // When the file changes, unique text can be found again; a region must go stale.
    version = "v2";
    source = source.replace('x="70"', 'x="90"');
    fs.writeFileSync(svgPath, source);
    await page.reload();
    await page.waitForFunction(() => window.__typoraAnnotations?.items.length === 2);
    await page.locator(".ta-svg-annotation").waitFor({ state: "visible" });
    assert.equal(await page.locator(".ta-svg-annotation").count(), 1);
    await page.getByRole("button", { name: "打开批注列表" }).click();
    assert.equal(await page.locator(".ta-card.unresolved").count(), 1);
    assert.equal(await page.getByText("图中对象已变化或暂时无法读取", { exact: true }).count(), 1);
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await page.waitForTimeout(220);
    await page.getByRole("button", { name: "批注此图", exact: true }).click();
    await page.getByRole("button", { name: "完成", exact: true }).waitFor({ state: "visible" });
    const arrow = await passive.locator("path").boundingBox();
    await page.mouse.click(arrow.x + arrow.width / 2, arrow.y);
    await page.getByRole("toolbar", { name: "添加批注" }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "高亮", exact: true }).click();
    await page.waitForFunction(() => window.__typoraAnnotations.items.length === 3);
    assert.equal((await page.evaluate(() => window.__typoraAnnotations.items))[2].anchor.target.tag, "path");
    await page.getByRole("button", { name: "完成", exact: true }).click();
    await page.getByRole("button", { name: "打开批注列表" }).click();
    await page.waitForTimeout(220);
    assert.deepEqual(errors, []);
    if (process.env.TYPORA_SVG_SCREENSHOT) await page.screenshot({ path: process.env.TYPORA_SVG_SCREENSHOT });
    console.log("SVG browser tests passed: selection, comments, region, reload, scaling, focus, changed image and passive SVG");

    if (process.env.TYPORA_SVG_SAMPLE_DOCUMENT) {
      const sample = process.env.TYPORA_SVG_SAMPLE_DOCUMENT;
      const markdown = fs.readFileSync(sample, "utf8");
      const fixtures = Array.from(markdown.matchAll(/!\[([^\]]*)\]\(([^)]+\.svg)\)/g)).map((match) => {
        const imagePath = path.resolve(path.dirname(sample), match[2]);
        return { alt: match[1], imagePath, imageSource: match[2], svg: fs.readFileSync(imagePath, "utf8") };
      });
      assert(fixtures.length > 0);
      const escape = (value) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
      const fixtureHtml = fs.readFileSync(htmlPath, "utf8").replace(
        /<content>[\s\S]*?<\/content>/,
        '<content><div id="write">' + fixtures.map((fixture) =>
          `<p>${escape(fixture.alt)}</p><img alt="${escape(fixture.alt)}" src="${pathToFileURL(fixture.imagePath)}">`).join("") +
        '</div></content>');
      fs.writeFileSync(htmlPath, fixtureHtml);
      items = [];
      await page.unroute("http://127.0.0.1:17373/**");
      await page.route("http://127.0.0.1:17373/**", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const headers = { "Access-Control-Allow-Origin": "null", "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Allow-Methods": "GET, PUT, OPTIONS" };
        if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
        if (url.pathname === "/v1/svg") {
          const imagePath = new URL(url.searchParams.get("src")).pathname;
          const fixture = fixtures.find((item) => item.imagePath === decodeURIComponent(imagePath));
          return route.fulfill({ json: { ...fixture, fingerprint: fixture.imageSource }, headers });
        }
        if (request.method() === "PUT") items = request.postDataJSON().annotations;
        return route.fulfill({ json: { annotations: items, documentId: "samples", storageExists: true }, headers });
      });
      await page.goto(pathToFileURL(htmlPath).href);
      await page.waitForFunction(() => window.__typoraAnnotations?.storageMode === "json");
      for (let index = 0; index < fixtures.length; index += 1) {
        await page.locator("#write img").nth(index).scrollIntoViewIfNeeded();
        const host = page.locator(".ta-svg-host").nth(index);
        await host.locator("svg text").first().waitFor({ state: "visible" });
        assert((await host.locator("svg text").first().evaluate((el) => getComputedStyle(el).fontFamily)).includes("Avenir Next"));
        await host.getByRole("button", { name: "批注此图", exact: true }).click();
        await host.getByRole("button", { name: "完成", exact: true }).waitFor({ state: "visible" });
        const text = host.locator("svg text").first();
        const quote = (await text.textContent()).replace(/\s+/g, " ").trim();
        const box = await text.boundingBox();
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.getByRole("toolbar", { name: "添加批注" }).waitFor({ state: "visible" });
        await page.getByRole("button", { name: "高亮", exact: true }).click();
        await page.waitForFunction((count) => window.__typoraAnnotations.items.length === count, index + 1);
        const anchor = (await page.evaluate(() => window.__typoraAnnotations.items))[index].anchor;
        assert.equal(anchor.quote, quote);
        assert.equal(anchor.imageSource, fixtures[index].imageSource);
        await host.getByRole("button", { name: "完成", exact: true }).click();
      }
      assert.equal(fs.readFileSync(sample, "utf8"), markdown);
      for (const fixture of fixtures) assert.equal(fs.readFileSync(fixture.imagePath, "utf8"), fixture.svg);
      assert.deepEqual(errors, []);
      console.log(`Real document smoke tests passed: ${fixtures.length} SVG diagrams; all source files unchanged`);
    }
  } finally {
    await browser.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
