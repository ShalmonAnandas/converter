import test from "node:test";
import assert from "node:assert/strict";
import * as text from "../public/lib/text.js";
import * as crypt from "../public/lib/crypto.js";
import * as ids from "../public/lib/ids.js";
import * as color from "../public/lib/color.js";
import * as net from "../public/lib/net.js";
import * as maths from "../public/lib/mathx.js";
import * as when from "../public/lib/datetime.js";
import * as markup from "../public/lib/markup.js";
import * as reference from "../public/lib/reference.js";

/* ---------------------------------------------------------------- text -- */

test("case conversion covers every common convention", () => {
  const all = text.allCases("helloWorld example-text").text;
  assert.match(all, /camel\s+helloWorldExampleText/);
  assert.match(all, /snake\s+hello_world_example_text/);
  assert.match(all, /kebab\s+hello-world-example-text/);
  assert.equal(text.convertCase("hello world", "pascal"), "HelloWorld");
  assert.throws(() => text.convertCase("x", "nope"), /Unknown case style/);
});

test("slugify folds accents and honours a length limit", () => {
  assert.equal(text.slugify("Héllo Wörld! — 2026 edition"), "hello-world-2026-edition");
  assert.equal(text.slugify("one two three four", { maxLength: 11 }), "one-two");
  assert.equal(text.slugify("A B", { separator: "_" }), "a_b");
});

test("diff lists additions and removals and scores similarity", () => {
  const report = text.diffText("a\nb\nc", "a\nx\nc\nd");
  assert.match(report, /2 added · 1 removed/);
  assert.match(report, /^- b$/m);
  assert.match(report, /^\+ x$/m);
  assert.equal(text.diffText("same", "same"), "The two inputs are identical.");
  assert.ok(text.similarityRatio("kitten", "sitting") > 0.5);
});

test("line operations sort, deduplicate, and count", () => {
  assert.equal(text.transformLines("b\na\nb", "remove duplicates"), "b\na");
  assert.equal(text.transformLines("b\na", "sort ascending"), "a\nb");
  assert.match(text.transformLines("a\na\nb", "count occurrences"), /2 {2}a/);
  assert.equal(text.transformLines("  a  \n b", "trim whitespace"), "a\nb");
});

test("regex tester reports positions and capture groups", () => {
  const report = text.testRegex("(\\w+)@(\\w+)", "g", "a@b and c@d");
  assert.match(report, /2 matches/);
  assert.match(report, /\$1 = "a"/);
  assert.equal(text.testRegex("zzz", "g", "abc"), "No matches.");
  assert.throws(() => text.testRegex("(", "g", "x"), /Invalid regular expression/);
});

test("find and replace counts substitutions and supports capture groups", () => {
  assert.deepEqual(text.findReplace("a-b-c", "-", "+"), { output: "a+b+c", count: 2 });
  assert.deepEqual(text.findReplace("ab", "(a)(b)", "$2$1", { regex: true }), { output: "ba", count: 1 });
});

test("Morse and NATO encode and decode", () => {
  assert.equal(text.toMorse("SOS"), "... --- ...");
  assert.equal(text.fromMorse("... --- ... / .... ."), "sos he");
  assert.equal(text.toNatoAlphabet("AB1"), "Alfa Bravo One");
  assert.throws(() => text.fromMorse("...--..-.-.-.-.-"), /not a Morse code sequence/);
  assert.equal(text.numeronym("internationalization"), "i18n");
});

test("classic ciphers are reversible", () => {
  assert.equal(text.caesarCipher(text.caesarCipher("Hello", 13), 13), "Hello");
  assert.equal(text.atbashCipher(text.atbashCipher("Hello")), "Hello");
  assert.equal(text.vigenereCipher("Attack at dawn", "lemon"), "Lxfopv ef rnhr");
  assert.equal(text.vigenereCipher("Lxfopv ef rnhr", "lemon", true), "Attack at dawn");
  assert.throws(() => text.vigenereCipher("x", "123"), /at least one letter/);
});

test("text statistics count words, sentences, and frequencies", () => {
  const report = text.textStatistics("The quick brown fox. The lazy dog!").text;
  assert.match(report, /Words\s+7/);
  assert.match(report, /Sentences\s+2/);
  assert.match(report, /the\s+2/);
});

/* -------------------------------------------------------------- crypto -- */

test("hashes match the published test vectors", async () => {
  assert.equal(await crypt.generateHash("abc", "MD5"), "900150983cd24fb0d6963f7d28e17f72");
  assert.equal(await crypt.generateHash("", "MD5"), "d41d8cd98f00b204e9800998ecf8427e");
  assert.equal(await crypt.generateHash("The quick brown fox jumps over the lazy dog", "MD5"), "9e107d9d372bb6826bd81d3542a419d6");
  assert.equal(await crypt.generateHash("abc", "SHA-1"), "a9993e364706816aba3e25717850c26c9cd0d89d");
  assert.equal(await crypt.generateHash("abc", "SHA-256"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(await crypt.generateHash("abc", "CRC-32"), "352441c2");
  await assert.rejects(() => crypt.generateHash("x", "SHA-3"), /Unsupported hash algorithm/);
});

test("HMAC matches the reference vector", async () => {
  assert.equal(
    await crypt.generateHmac("The quick brown fox jumps over the lazy dog", "key", "SHA-256"),
    "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8",
  );
});

test("AES-GCM round trips and fails closed on a wrong passphrase", async () => {
  const sealed = await crypt.encryptText("secret message", "hunter2", { iterations: 1000 });
  assert.equal(await crypt.decryptText(sealed, "hunter2"), "secret message");
  await assert.rejects(() => crypt.decryptText(sealed, "wrong"), /Decryption failed/);
  await assert.rejects(() => crypt.decryptText("bm90LW91cnM=", "hunter2"), /too short|not produced/);
});

test("JWT signing, verification, and inspection agree", async () => {
  const token = await crypt.signJwt(JSON.stringify({ sub: "1", exp: 1900000000 }), "topsecret");
  assert.match(await crypt.verifyJwt(token, "topsecret"), /Signature VALID for HS256/);
  assert.match(await crypt.verifyJwt(token, "wrong"), /Signature INVALID/);
  const report = crypt.inspectJwt(token);
  assert.equal(report.algorithm, "HS256");
  assert.equal(report.payload.sub, "1");
  assert.match(report.warning, /not been verified/);
  assert.throws(() => crypt.inspectJwt("not.a"), /header, payload, and signature/);
});

test("TOTP matches RFC 6238 for the SHA-1 test key", async () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  assert.equal((await crypt.generateTotp(secret, { at: 59_000 })).code, "287082");
  assert.equal((await crypt.generateTotp(secret, { at: 1_111_111_109_000 })).code, "081804");
});

test("password generation honours the requested sets and length", () => {
  const passwords = crypt.generatePassword({ length: 24, count: 3, sets: ["lowercase", "digits"], excludeAmbiguous: true }).split("\n");
  assert.equal(passwords.length, 3);
  for (const password of passwords) {
    assert.equal(password.length, 24);
    assert.match(password, /^[a-z0-9]+$/);
    assert.doesNotMatch(password, /[l10]/);
  }
  assert.throws(() => crypt.generatePassword({ sets: [] }), /at least one character set/);
  assert.throws(() => crypt.generatePassword({ length: 2 }), /at least 4 characters/);
});

test("password analysis separates weak from strong", () => {
  assert.match(crypt.analyzePassword("password123").text, /Verdict\s+Very weak/);
  assert.match(crypt.analyzePassword("password123").text, /common-password list/);
  assert.match(crypt.analyzePassword("7#kQz!mVr2$Lp9Xw&Tb").text, /Verdict\s+Very strong/);
});

/* ----------------------------------------------------------------- ids -- */

test("name-based UUIDs match the published examples", async () => {
  assert.equal(await ids.uuidV5("DNS", "example.com"), "cfbff0d1-9375-5685-968c-48ce8b15ae17");
  assert.equal(await ids.uuidV3("DNS", "example.com"), "9073926b-929f-31c2-abc9-fad77ae3e8eb");
  await assert.rejects(() => ids.uuidV5("BAD", "x"), /Choose a namespace/);
});

test("generated UUIDs carry the right version and variant", () => {
  for (const [make, version] of [[ids.uuidV4, 4], [ids.uuidV7, 7], [ids.uuidV1, 1]]) {
    const value = make();
    assert.ok(ids.validateUuid(value), value);
    assert.equal(Number(value[14]), version);
    assert.match(value[19], /[89ab]/);
  }
  assert.match(ids.inspectUuid(ids.uuidV7()).text, /Version {4}7 — Unix epoch time ordered/);
  assert.match(ids.inspectUuid("00000000-0000-0000-0000-000000000000").text, /Nil UUID/);
});

test("ULIDs sort by time and decode their timestamp", () => {
  const value = ids.ulid(1_700_000_000_000);
  assert.equal(value.length, 26);
  assert.match(ids.inspectUlid(value).text, /2023-11-14T22:13:20\.000Z/);
  assert.throws(() => ids.inspectUlid("too-short").text, /26 Crockford Base32 characters/);
});

test("MAC addresses are generated locally administered and decoded correctly", () => {
  const address = ids.macAddress({ prefix: "00:1A:2B" });
  assert.match(address, /^00:1A:2B/);
  const report = ids.inspectMac("00:1A:2B:3C:4D:5E").text;
  assert.match(report, /Cisco\s+001a\.2b3c\.4d5e/);
  assert.match(report, /Universally administered/);
  assert.match(report, /EUI-64\s+02:1a:2b:ff:fe:3c:4d:5e/);
  assert.throws(() => ids.inspectMac("zz"), /six bytes/);
});

/* --------------------------------------------------------------- color -- */

test("colour parsing accepts every common notation", () => {
  const expected = { r: 59, g: 130, b: 246 };
  for (const notation of ["#3b82f6", "#3B82F6", "rgb(59 130 246)", "rgb(59, 130, 246)", "hsv(217.2 76% 96.5%)", "lab(55.63 17.54 -64.42)", "oklch(62.3% 0.188 259.8)"]) {
    const parsed = color.parseColor(notation);
    assert.deepEqual({ r: parsed.r, g: parsed.g, b: parsed.b }, expected, notation);
  }
  assert.equal(color.toHex(color.parseColor("rebeccapurple")), "#639");
  assert.equal(color.parseColor("rgba(0,0,0,0.5)").a, 0.5);
  assert.throws(() => color.parseColor("nope(1)"), /not a colour we recognise/);
  assert.throws(() => color.parseColor("#12345"), /3, 4, 6, or 8 digits/);
});

test("contrast matches the WCAG boundary values", () => {
  assert.equal(color.contrastRatio(color.parseColor("#000"), color.parseColor("#fff")).toFixed(0), "21");
  assert.match(color.checkContrast("#767676", "#ffffff").text, /Ratio\s+4\.54:1/);
  assert.match(color.checkContrast("#767676", "#ffffff").text, /AA normal text\s+PASS/);
  assert.match(color.checkContrast("#999999", "#ffffff").text, /AA normal text\s+FAIL/);
});

test("palettes produce the expected number of swatches", () => {
  assert.equal(color.buildPalette("#3b82f6", "triadic").rows.length, 3);
  assert.equal(color.buildPalette("#3b82f6", "shades").rows.length, 11);
  assert.match(color.buildPalette("#3b82f6", "triadic").text, /^base\s+#3b82f6/);
  assert.throws(() => color.buildPalette("#3b82f6", "nope"), /Unknown palette scheme/);
});

/* ------------------------------------------------------------- network -- */

test("subnet calculations are correct for a /26", () => {
  const report = net.subnetReport("192.168.1.130/26").text;
  assert.match(report, /Network\s+192\.168\.1\.128\/26/);
  assert.match(report, /Broadcast\s+192\.168\.1\.191/);
  assert.match(report, /First host\s+192\.168\.1\.129/);
  assert.match(report, /Usable hosts\s+62/);
  assert.match(report, /Scope\s+Private \(RFC 1918\)/);
  assert.throws(() => net.subnetReport("192.168.1.1/33").text, /between 0 and 32/);
});

test("IPv4 notation is detected rather than guessed", () => {
  for (const notation of ["192.168.1.1", "3232235777", "0xC0A80101", "11000000.10101000.00000001.00000001"]) {
    assert.match(net.convertIpv4(notation).text, /Dotted decimal {2}192\.168\.1\.1/, notation);
  }
  assert.match(net.convertIpv4("10.0.0.1").text, /Dotted decimal {2}10\.0\.0\.1/);
  assert.throws(() => net.convertIpv4("300.1.1.1"), /larger than 255/);
});

test("IP ranges expand and summarise", () => {
  assert.match(net.expandRange("192.168.1.0/30"), /4 addresses[\s\S]*192\.168\.1\.3/);
  assert.match(net.summarizeRange("192.168.1.1 - 192.168.1.10"), /192\.168\.1\.8\/31/);
  assert.throws(() => net.expandRange("10.0.0.0/8"), /narrow it to/);
});

test("IPv6 expansion and compression follow RFC 5952", () => {
  assert.match(net.expandIpv6("2001:db8::1").text, /Expanded\s+2001:0db8:0000:0000:0000:0000:0000:0001/);
  assert.match(net.expandIpv6("::ffff:192.168.1.1").text, /Compressed\s+::ffff:c0a8:101/);
  assert.throws(() => net.expandIpv6("1::2::3").text, /only contain one/);
});

test("URL parsing lists every component and repeated parameters", () => {
  const report = net.parseUrl("https://user@example.com:8443/a/b%20c?x=1&y=2&x=3#frag").text;
  assert.match(report, /Hostname\s+example\.com/);
  assert.match(report, /Port\s+8443/);
  assert.match(report, /Query parameters \(3\)/);
  assert.match(report, /^1\s+b c$/m);
  assert.throws(() => net.parseUrl("not a url").text, /not an absolute URL/);
});

test("user agents resolve to a browser and platform", () => {
  const report = net.parseUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36").text;
  assert.match(report, /Browser\s+Chrome 120\.0\.0\.0/);
  assert.match(report, /Engine\s+Blink/);
  assert.match(report, /macOS 10\.15\.7/);
  assert.match(net.parseUserAgent("Googlebot/2.1 (+http://www.google.com/bot.html)").text, /Bot or crawler/);
});

/* --------------------------------------------------------------- maths -- */

test("the expression evaluator handles precedence, functions, and errors", () => {
  const cases = [["1+2*3", 7], ["(1+2)*3", 9], ["2^3^2", 512], ["-3^2", -9], ["2**10", 1024], ["10%3", 1], ["sqrt(16)+abs(-2)", 6], ["max(1,5,3)", 5], ["5!", 120], ["log(1000)", 3], ["hypot(3,4)", 5], ["gcd(12,18)", 6], ["0xff+0b101", 260], ["3--3", 6]];
  for (const [expression, expected] of cases) assert.equal(maths.evaluateExpression(expression), expected, expression);
  assert.ok(Math.abs(maths.evaluateExpression("sin(rad(90))") - 1) < 1e-12);
  for (const [bad, pattern] of [["1+", /missing an operand/], ["(1+2", /unclosed parenthesis/], ["1)+2", /without a matching opening/], ["foo(1)", /not a known function/], ["1/0", /Division by zero/], ["", /Enter an expression/]]) {
    assert.throws(() => maths.evaluateExpression(bad), pattern, bad);
  }
});

test("base conversion covers 2 to 36 with big integers", () => {
  assert.equal(maths.convertBase("255", 10, 16), "ff");
  assert.equal(maths.convertBase("ff", 16, 2), "11111111");
  assert.equal(maths.convertBase("123456789012345678901234567890", 10, 16), "18ee90ff6c373e0ee4e3f0ad2");
  assert.match(maths.baseReport("255", 10).text, /Hex \(16\)\s+FF/);
  assert.throws(() => maths.convertBase("9", 8, 10), /not a valid digit in base 8/);
});

test("Roman numerals convert both ways and reject non-canonical forms", () => {
  assert.equal(maths.convertRoman("1994"), "MCMXCIV");
  assert.equal(maths.convertRoman("MCMXCIV"), "1994");
  assert.throws(() => maths.convertRoman("IIII"), /not a canonical Roman numeral/);
  assert.throws(() => maths.toRoman(4000), /1 to 3999/);
});

test("unit conversion is exact for binary and decimal data sizes", () => {
  assert.equal(maths.convertUnit(1, "data size", "gibibyte", "byte"), 1073741824);
  assert.equal(maths.convertUnit(1, "data size", "gigabyte", "megabyte"), 1000);
  assert.equal(maths.convertUnit(100, "temperature", "celsius", "fahrenheit"), 212);
  assert.equal(maths.convertUnit(1, "length", "mile", "meter"), 1609.344);
  assert.throws(() => maths.convertUnit(1, "length", "parsec", "kilogram"), /Pick units from the length category/);
});

test("chmod translates octal and symbolic modes", () => {
  assert.match(maths.chmodReport("755").text, /Symbolic\s+rwxr-xr-x/);
  assert.match(maths.chmodReport("rwxr-xr-x").text, /Octal\s+755/);
  assert.match(maths.chmodReport("rwsr-xr-t").text, /Special bits\s+5 {2}setuid, sticky bit/);
  assert.throws(() => maths.chmodReport("999"), /Enter a mode/);
});

/* ---------------------------------------------------------------- time -- */

test("moments report every representation", () => {
  const report = when.describeMoment("1789721653", "seconds", "UTC").text;
  assert.match(report, /ISO 8601 \(UTC\)\s+2026-09-18T08:54:13\.000Z/);
  assert.match(report, /Day of week\s+Friday/);
  assert.match(report, /ISO week\s+2026-W38/);
  assert.match(report, /Quarter\s+Q3/);
  assert.match(when.describeMoment("0", "seconds").text, /1970-01-01T00:00:00\.000Z/);
  assert.throws(() => when.parseMoment("never"), /not a date we can read/);
});

test("durations parse from every common notation", () => {
  assert.equal(when.parseDuration("90", "seconds"), 90_000);
  assert.equal(when.parseDuration("1h30m"), 5_400_000);
  assert.equal(when.parseDuration("01:30:00"), 5_400_000);
  assert.equal(when.parseDuration("PT1H30M"), 5_400_000);
  assert.match(when.convertDuration("1h30m").text, /minutes\s+90/);
  assert.match(when.convertDuration("1h30m").text, /ISO 8601\s+PT1H30M/);
  assert.throws(() => when.parseDuration("soon"), /not a duration we can read/);
});

test("cron expressions are explained and projected forward", () => {
  const from = new Date("2026-09-18T00:00:00Z");
  const weekdays = when.describeCron("0 9 * * 1-5", { from, runs: 3 }).text;
  assert.match(weekdays, /Friday\s+2026-09-18T09:00:00Z/);
  assert.match(weekdays, /Monday\s+2026-09-21T09:00:00Z/);
  assert.match(when.describeCron("@daily", { from, runs: 1 }).text, /2026-09-19T00:00:00Z/);
  assert.match(when.describeCron("0 0 29 2 *", { from, runs: 1 }).text, /2028-02-29T00:00:00Z/);
  assert.throws(() => when.parseCron("a b c"), /five fields/);
  assert.throws(() => when.parseCron("60 * * * *"), /out of range for the minute field/);
});

/* -------------------------------------------------------------- markup -- */

test("Markdown renders structure and escapes active HTML", () => {
  const html = markup.markdownToHtml("# Title\n\n**safe** <script>alert(1)</script>\n\n- one\n- two\n  - nested\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n```js\nlet x = 1 < 2;\n```");
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<strong>safe<\/strong>/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /<li>Two<\/li>|<li>two\s*<ul>/i);
  assert.match(html, /<table>/);
  assert.match(html, /<code class="language-js">let x = 1 &lt; 2;<\/code>/);
});

test("Markdown refuses javascript: links", () => {
  assert.match(markup.markdownToHtml("[click](javascript:alert(1))"), /href="#"/);
});

test("HTML converts back to Markdown", () => {
  const markdown = markup.htmlToMarkdown("<h2>Title</h2><p>Some <b>bold</b> and <a href='/x'>a link</a>.</p><ul><li>one</li><li>two</li></ul>");
  assert.match(markdown, /^## Title$/m);
  assert.match(markdown, /\*\*bold\*\*/);
  assert.match(markdown, /\[a link\]\(\/x\)/);
  assert.match(markdown, /^- one$/m);
});

test("HTML formatting, minification, and tag stripping behave", () => {
  const formatted = markup.formatHtml('<div class="a"><p>Hello <b>world</b></p><img src="x.png"></div>');
  assert.match(formatted, /^ {2}<p>Hello <b>world<\/b><\/p>$/m);
  assert.match(formatted, /<img src="x\.png">/);
  assert.equal(markup.minifyHtml("<p>a</p>  <!-- gone --><p>b</p>"), "<p>a</p> <p>b</p>");
  assert.equal(markup.stripTags("<h1>Title</h1><p>Body</p><script>bad()</script>"), "Title\nBody");
});

test("CSS formatting keeps selectors intact and minification is aggressive", () => {
  const formatted = markup.formatCss(":root{--a:1px}.card,.panel{color:red;background:blue}");
  assert.match(formatted, /^:root \{$/m);
  assert.match(formatted, /^ {2}--a: 1px;$/m);
  assert.match(formatted, /^\.card,\n\.panel \{$/m);
  assert.equal(markup.minifyCss(".card {\n  color: red;\n  /* note */\n}"), ".card{color:red}");
});

test("SQL formatting breaks clauses and preserves literals", () => {
  const formatted = markup.formatSql("select a, b from t where x = 1 and y like '%a, b%' order by a desc");
  assert.match(formatted, /^SELECT a,$/m);
  assert.match(formatted, /^FROM t$/m);
  assert.match(formatted, /^ {2}AND y LIKE '%a, b%'$/m);
  assert.match(markup.formatSql("select count(id) from t"), /COUNT\(id\)/);
  assert.match(markup.formatSql("insert into t (a, b) values (1, 2)"), /INSERT INTO t \(a, b\)/);
  assert.throws(() => markup.formatSql("  "), /Enter a SQL statement/);
});

test("escaping targets produce valid literals", () => {
  assert.equal(markup.escapeForLanguage("it's", "sql literal"), "'it''s'");
  assert.equal(markup.escapeForLanguage("a\nb", "javascript string"), '"a\\nb"');
  assert.equal(markup.escapeForLanguage("a.b", "regular expression"), "a\\.b");
  assert.equal(markup.escapeForLanguage("a,b", "csv field"), '"a,b"');
  assert.equal(markup.unescapeFromLanguage('"a\\nb"', "javascript string"), "a\nb");
  assert.throws(() => markup.escapeForLanguage("x", "cobol"), /Unknown target/);
});

test("HTML entities escape and resolve", () => {
  assert.equal(markup.escapeHtml("<a & b>"), "&lt;a &amp; b&gt;");
  assert.equal(markup.unescapeHtml("&lt;a&gt; &amp; &mdash; &#8212; &#x2014;"), "<a> & — — —");
  assert.match(markup.escapeHtml("café", { mode: "non-ascii" }), /caf&#233;/);
});

test("SVG optimisation strips cruft and rounds numbers", () => {
  const optimised = markup.optimizeSvg('<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="24" height="24"><title>x</title><!-- c --><path d="M1.00000 2.500001 L3 4"/></svg>');
  assert.doesNotMatch(optimised, /version=|<title>|<!--/);
  assert.match(optimised, /d="M1 2\.5 L3 4"/);
  assert.match(markup.svgToDataUri('<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#f00"/></svg>'), /^data:image\/svg\+xml,%3Csvg/);
});

test("meta tags cover primary, Open Graph, and Twitter", () => {
  const tags = markup.metaTags({ title: "T & T", description: "D", url: "https://x.test", image: "https://x.test/a.png" });
  assert.match(tags, /<title>T &amp; T<\/title>/);
  assert.match(tags, /property="og:image" content="https:\/\/x\.test\/a\.png"/);
  assert.match(tags, /name="twitter:card" content="summary_large_image"/);
  assert.throws(() => markup.metaTags({}), /page title is required/);
});

/* ----------------------------------------------------------- reference -- */

test("reference lookups find codes and types", () => {
  assert.match(reference.lookupMime("webp").text, /image\/webp/);
  assert.match(reference.lookupMime("zzz").text, /Nothing matches/);
  assert.match(reference.lookupStatus("429").text, /Too Many Requests/);
  assert.match(reference.lookupStatus("teapot").text, /418/);
  assert.match(reference.lookupKeyCode("13").text, /Name\s+Enter/);
  assert.match(reference.lookupKeyCode("65").text, /event\.code\s+KeyA/);
  assert.match(reference.lookupPort("5432").text, /PostgreSQL/);
});
