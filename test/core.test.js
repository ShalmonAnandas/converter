import test from "node:test";
import assert from "node:assert/strict";
import { formatBytes, jsonTransform, jsonError, encodeBase64, decodeBase64, normalizeBase64, validateBase64, parseDataUri, convertTimestamp } from "../public/core.js";

test("formats and recursively sorts JSON without reordering arrays",()=>{assert.equal(jsonTransform('{"z":1,"a":{"b":2,"a":1},"list":[2,1]}',"sort","2"),'{\n  "a": {\n    "a": 1,\n    "b": 2\n  },\n  "list": [\n    2,\n    1\n  ],\n  "z": 1\n}')});
test("reports JSON line and column",()=>{const input='{\n  "a": 1,\n}';let error;try{JSON.parse(input)}catch(caught){error=caught}assert.match(jsonError(error,input),/line 3, column 1/)});
test("round trips UTF-8 Base64",()=>{const value="Hello, 世界 👋";assert.equal(decodeBase64(encodeBase64(value)),value)});
test("normalizes Base64URL and padding",()=>{assert.equal(normalizeBase64("SGVsbG8_",false),"SGVsbG8/");assert.equal(normalizeBase64("SGVsbG8",false),"SGVsbG8=")});
test("normalization rejects data it cannot repair safely",()=>{assert.throws(()=>normalizeBase64("!!!!"),/outside the Base64 alphabet/);assert.throws(()=>normalizeBase64("a"),/remainder of one/)});
test("validates alphabet, whitespace, padding, and impossible lengths",()=>{assert.deepEqual(validateBase64("SGVsbG8="),{valid:true,reason:"Valid Base64",variant:"standard"});assert.equal(validateBase64("SG Vs").reason,"Whitespace is not allowed in strict mode");assert.equal(validateBase64("abcde").valid,false);assert.equal(validateBase64("abc=def").valid,false)});
test("rejects mixed Base64 alphabets and invalid padding",()=>{assert.equal(validateBase64("ab+_",{}).reason,"Standard and URL-safe alphabets are mixed");assert.throws(()=>decodeBase64("SGVsbG8=="),/Padding/)});
test("parses Base64 and percent-encoded data URIs",()=>{assert.deepEqual(parseDataUri("data:text/plain;charset=utf-8;base64,SGVsbG8="),{mediaType:"text/plain",parameters:["charset=utf-8"],isBase64:true,payload:"Hello"});assert.equal(parseDataUri("data:,Hello%20world").payload,"Hello world")});
test("converts seconds and milliseconds",()=>{assert.equal(convertTimestamp("0","seconds"),"1970-01-01T00:00:00.000Z");assert.equal(convertTimestamp("1000","milliseconds"),"1970-01-01T00:00:01.000Z")});
test("formats byte quantities",()=>{assert.equal(formatBytes(0),"0 B");assert.equal(formatBytes(1536),"1.50 KB")});
