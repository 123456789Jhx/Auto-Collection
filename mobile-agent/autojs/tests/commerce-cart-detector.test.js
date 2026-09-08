"use strict";

var assert = require("node:assert/strict");
var test = require("node:test");
var detector = require("../features/new-comment/commerce-cart-detector.js");

function fixture(similarity) {
  return {
    clip: function () { return { clipped: true }; },
    matchTemplate: function () {
      return { matches: [{ similarity: similarity }] };
    }
  };
}

test("detects the commerce cart when template similarity reaches 50 percent", function () {
  var result = detector.matchCommerceCart(fixture(0.5), { screen: true }, { template: true }, {
    left: 550, top: 1988, width: 110, height: 90
  }, 0.5);
  assert.equal(result.detected, true);
  assert.equal(result.similarity, 0.5);
});

test("does not detect the commerce cart below the similarity threshold", function () {
  var result = detector.matchCommerceCart(fixture(0.49), { screen: true }, { template: true }, {
    left: 550, top: 1988, width: 110, height: 90
  }, 0.5);
  assert.equal(result.detected, false);
  assert.equal(result.similarity, 0.49);
});
