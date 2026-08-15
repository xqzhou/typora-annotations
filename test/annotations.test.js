const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync(require.resolve("../typora-annotations.js"), "utf8");
const styles = fs.readFileSync(require.resolve("../typora-annotations.css"), "utf8");
const sandbox = {
  window: { __typoraAnnotationsLoaded: false },
  module: { exports: {} },
  document: { readyState: "loading", addEventListener() {} },
  setTimeout() {},
  console,
};
vm.runInNewContext(source, sandbox);

const {
  findAnchor,
  findCodeAnchor,
  commonPrefixLength,
  commonSuffixLength,
  textPointForOffset,
  commentMarkerPosition,
  centeredScrollTop,
} = sandbox.module.exports;

assert.equal(commonPrefixLength("abcd", "abxy"), 2);
assert.equal(commonSuffixLength("xxcde", "yycde"), 3);

assert.deepEqual(
  { ...findAnchor("first target then target last", { quote: "target", prefix: " then ", suffix: " last" }) },
  { start: 18, end: 24, score: 11 },
);

assert.equal(findAnchor("text changed", { quote: "missing", prefix: "", suffix: "" }), null);
assert.equal(findAnchor("abc", { quote: "", prefix: "", suffix: "" }), null);

assert.deepEqual(
  { ...findCodeAnchor([
    "func first() { return target }",
    "func chosen() { return target }",
  ], {
    scope: "code",
    quote: "target",
    prefix: "return ",
    suffix: " }",
    blockPrefix: "func chosen()",
    blockSuffix: "target }",
  }) },
  { blockIndex: 1, start: 23, end: 29, score: 30 },
);

assert.equal(findCodeAnchor(["target"], { quote: "target", scope: "text" }), null);

const headingNode = { name: "heading" };
const paragraphNode = { name: "paragraph" };
const adjacentSegments = [
  { node: headingNode, start: 0, end: 7 },
  { node: paragraphNode, start: 7, end: 20 },
];

assert.deepEqual(
  { ...textPointForOffset(adjacentSegments, 7, "start") },
  { node: paragraphNode, offset: 0 },
);
assert.deepEqual(
  { ...textPointForOffset(adjacentSegments, 7, "end") },
  { node: headingNode, offset: 7 },
);

assert.deepEqual(
  { ...commentMarkerPosition([
    { right: 100, top: 40, bottom: 60 },
    { right: 180, top: 42, bottom: 58 },
    { right: 80, top: 70, bottom: 90 },
  ], 10, 20) },
  { left: 187, top: 53 },
);

assert.equal(
  centeredScrollTop(400, 600, 2000, 28, { top: 1028, bottom: 1048 }),
  1110,
);
assert.equal(
  centeredScrollTop(0, 600, 2000, 28, { top: -100, bottom: -80 }),
  0,
);
assert.equal(
  centeredScrollTop(1500, 600, 2000, 28, { top: 900, bottom: 920 }),
  1400,
);

assert.match(styles, /#typora-annotation-list\s*\{[^}]*\bgap:\s*8px;/s);
assert.match(styles, /\.ta-card\s*\{[^}]*\bmargin:\s*0;/s);
assert.match(source, /comment\.className = "ta-comment-input"/);
assert.equal((styles.match(/\.ta-card-comment\s*\{/g) || []).length, 1);
assert.match(styles, /\.ta-comment-input\s*\{[^}]*\bresize:\s*vertical;/s);
assert.match(styles, /\.ta-card-quote\s*\{[^}]*font-size:\s*calc\(1em - 3px\)/s);
assert.match(source, /const FOCUS_DURATION = 1800;/);
assert.match(source, /document\.querySelector\("content"\)/);
assert.match(source, /item\.id === state\.focusedId \? " selected" : ""/);
assert.match(styles, /\.ta-comment-marker\.selected\s*\{[^}]*ta-marker-focus/s);
assert.match(styles, /\.ta-fallback-active\s*\{[^}]*ta-source-focus/s);

console.log("annotation anchor tests passed");
