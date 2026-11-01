const assert = require("node:assert/strict");
const svg = require("../typora-annotations-svg.js");

const text = (value, path, id = "") => ({ tag: "text", text: value, path, id, geometry: [["x", "20"]] });
const original = text("Production", "2");
assert.equal(svg.findTarget([text("Production", "8")], original, false), 0, "unique text survives reordering");
assert.equal(svg.findTarget([text("Production", "2"), text("Production", "3")], original, false), -1,
  "ambiguous text after edits must not attach to the first occurrence");
assert.equal(svg.findTarget([text("Production", "2"), text("Production", "3")], original, true), 0,
  "unchanged images can disambiguate identical labels by element path");
assert.equal(svg.findTarget([text("Renamed", "8", "production")], text("Production", "2", "production"), false), 0);
assert.equal(svg.findTarget([text("A", "2", "same"), text("B", "3", "same")], text("A", "2", "same"), false), -1);
assert.equal(svg.findTarget([{ tag: "rect", id: "", text: "", path: "4", geometry: [["x", "40"]] }],
  { tag: "rect", text: "", path: "2", geometry: [["x", "20"]] }, false), -1);
assert.equal(svg.validBounds({ x: 0, y: 0, width: 20, height: 10 }), true);
assert.equal(svg.validBounds({ x: NaN, y: 0, width: 20, height: 10 }), false);
assert.equal(svg.validBounds({ x: 0, y: 0, width: -20, height: 10 }), false);
assert(svg.validBounds(svg.visibleRect({ left: 10, top: 20, width: 70, height: 0 })),
  "horizontal arrow paths need a visible, clickable annotation rectangle");
assert.deepEqual(svg.transformRect({ x: 10, y: 20, width: 30, height: 40 },
  { a: 2, b: 0, c: 0, d: 2, e: 100, f: 50 }),
  { x: 120, y: 90, left: 120, top: 90, width: 60, height: 80, right: 180, bottom: 170 });
assert.deepEqual(svg.transformRect({ x: 0, y: 0, width: 20, height: 10 },
  { a: 0, b: 1, c: -1, d: 0, e: 30, f: 0 }),
  { x: 20, y: 0, left: 20, top: 0, width: 10, height: 20, right: 30, bottom: 20 });
assert.equal(svg.safeDeclarations("fill:red;stroke:url(https://example.org/x);position:fixed;font-size:14px"),
  "fill:red;font-size:14px");
assert.equal(svg.safeDeclarations("fill:url(#gradient);stroke:expression(alert(1))"), "fill:url(#gradient)");
assert.equal(svg.safeStyles("@import 'evil'; .x {fill:red}"), "");
console.log("SVG anchor, geometry and passive style tests passed");
assert.equal(svg.fontRole("Menlo, monospace", "", "value"), "code");
assert.equal(svg.fontRole("Arial", "m", "value"), "code");
assert.equal(svg.fontRole("Arial", "", "svc-prod"), "code");
assert.equal(svg.fontRole("Arial", "", "alice@acme.com.uat"), "code");
assert.equal(svg.fontRole("Arial", "", "Production tenant"), "text");
assert(svg.TYPOGRAPHY.text.includes("Avenir Next"));
assert(svg.TYPOGRAPHY.code.includes("Source Code Pro"));
