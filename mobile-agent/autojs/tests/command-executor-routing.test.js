"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const uploaderSource = fs.readFileSync(path.join(__dirname, "..", "core", "uploader.js"), "utf8");

assert.ok(
  uploaderSource.includes('executorType=AGENT'),
  "the inner Agent must poll only the AGENT executor queue"
);

console.log("command-executor-routing.test.js passed");
