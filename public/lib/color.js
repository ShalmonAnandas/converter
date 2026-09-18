// Colour parsing, conversion between every common notation, contrast scoring,
// and palette generation.

export const CSS_COLORS = {
  aliceblue: "#f0f8ff", antiquewhite: "#faebd7", aqua: "#00ffff", aquamarine: "#7fffd4", azure: "#f0ffff", beige: "#f5f5dc", bisque: "#ffe4c4", black: "#000000", blanchedalmond: "#ffebcd", blue: "#0000ff", blueviolet: "#8a2be2", brown: "#a52a2a", burlywood: "#deb887", cadetblue: "#5f9ea0", chartreuse: "#7fff00", chocolate: "#d2691e", coral: "#ff7f50", cornflowerblue: "#6495ed", cornsilk: "#fff8dc", crimson: "#dc143c", cyan: "#00ffff", darkblue: "#00008b", darkcyan: "#008b8b", darkgoldenrod: "#b8860b", darkgray: "#a9a9a9", darkgreen: "#006400", darkgrey: "#a9a9a9", darkkhaki: "#bdb76b", darkmagenta: "#8b008b", darkolivegreen: "#556b2f", darkorange: "#ff8c00", darkorchid: "#9932cc", darkred: "#8b0000", darksalmon: "#e9967a", darkseagreen: "#8fbc8f", darkslateblue: "#483d8b", darkslategray: "#2f4f4f", darkturquoise: "#00ced1", darkviolet: "#9400d3", deeppink: "#ff1493", deepskyblue: "#00bfff", dimgray: "#696969", dodgerblue: "#1e90ff", firebrick: "#b22222", floralwhite: "#fffaf0", forestgreen: "#228b22", fuchsia: "#ff00ff", gainsboro: "#dcdcdc", ghostwhite: "#f8f8ff", gold: "#ffd700", goldenrod: "#daa520", gray: "#808080", green: "#008000", greenyellow: "#adff2f", grey: "#808080", honeydew: "#f0fff0", hotpink: "#ff69b4", indianred: "#cd5c5c", indigo: "#4b0082", ivory: "#fffff0", khaki: "#f0e68c", lavender: "#e6e6fa", lavenderblush: "#fff0f5", lawngreen: "#7cfc00", lemonchiffon: "#fffacd", lightblue: "#add8e6", lightcoral: "#f08080", lightcyan: "#e0ffff", lightgoldenrodyellow: "#fafad2", lightgray: "#d3d3d3", lightgreen: "#90ee90", lightpink: "#ffb6c1", lightsalmon: "#ffa07a", lightseagreen: "#20b2aa", lightskyblue: "#87cefa", lightslategray: "#778899", lightsteelblue: "#b0c4de", lightyellow: "#ffffe0", lime: "#00ff00", limegreen: "#32cd32", linen: "#faf0e6", magenta: "#ff00ff", maroon: "#800000", mediumaquamarine: "#66cdaa", mediumblue: "#0000cd", mediumorchid: "#ba55d3", mediumpurple: "#9370db", mediumseagreen: "#3cb371", mediumslateblue: "#7b68ee", mediumspringgreen: "#00fa9a", mediumturquoise: "#48d1cc", mediumvioletred: "#c71585", midnightblue: "#191970", mintcream: "#f5fffa", mistyrose: "#ffe4e1", moccasin: "#ffe4b5", navajowhite: "#ffdead", navy: "#000080", oldlace: "#fdf5e6", olive: "#808000", olivedrab: "#6b8e23", orange: "#ffa500", orangered: "#ff4500", orchid: "#da70d6", palegoldenrod: "#eee8aa", palegreen: "#98fb98", paleturquoise: "#afeeee", palevioletred: "#db7093", papayawhip: "#ffefd5", peachpuff: "#ffdab9", peru: "#cd853f", pink: "#ffc0cb", plum: "#dda0dd", powderblue: "#b0e0e6", purple: "#800080", rebeccapurple: "#663399", red: "#ff0000", rosybrown: "#bc8f8f", royalblue: "#4169e1", saddlebrown: "#8b4513", salmon: "#fa8072", sandybrown: "#f4a460", seagreen: "#2e8b57", seashell: "#fff5ee", sienna: "#a0522d", silver: "#c0c0c0", skyblue: "#87ceeb", slateblue: "#6a5acd", slategray: "#708090", snow: "#fffafa", springgreen: "#00ff7f", steelblue: "#4682b4", tan: "#d2b48c", teal: "#008080", thistle: "#d8bfd8", tomato: "#ff6347", turquoise: "#40e0d0", violet: "#ee82ee", wheat: "#f5deb3", white: "#ffffff", whitesmoke: "#f5f5f5", yellow: "#ffff00", yellowgreen: "#9acd32",
};

const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, value));
const round = (value, places = 2) => Number(value.toFixed(places));

export function parseColor(input) {
  const value = String(input).trim().toLowerCase();
  if (!value) throw new Error("Enter a colour");
  if (value in CSS_COLORS) return { ...parseColor(CSS_COLORS[value]), name: value };

  const hex = /^#?([0-9a-f]{3,8})$/.exec(value);
  if (hex) {
    const digits = hex[1];
    const expand = (part) => Number.parseInt(part.length === 1 ? part + part : part, 16);
    if (digits.length === 3 || digits.length === 4) {
      return {
        r: expand(digits[0]), g: expand(digits[1]), b: expand(digits[2]),
        a: digits.length === 4 ? round(expand(digits[3]) / 255, 3) : 1,
      };
    }
    if (digits.length === 6 || digits.length === 8) {
      return {
        r: expand(digits.slice(0, 2)), g: expand(digits.slice(2, 4)), b: expand(digits.slice(4, 6)),
        a: digits.length === 8 ? round(expand(digits.slice(6, 8)) / 255, 3) : 1,
      };
    }
    throw new Error("A hex colour needs 3, 4, 6, or 8 digits");
  }

  const functional = /^(rgba?|hsla?|hsv|hsb|cmyk|oklch|oklab|lab|lch)\s*\(([^)]*)\)$/.exec(value);
  if (!functional) throw new Error(`"${input}" is not a colour we recognise`);
  const name = functional[1];
  const parts = functional[2].split(/[\s,/]+/).filter(Boolean);
  const componentCount = name === "cmyk" ? 4 : 3;
  if (parts.length < componentCount) throw new Error(`${name}() needs ${componentCount} components`);

  /** Raw number, ignoring a percent sign. */
  const num = (index) => {
    const parsed = Number.parseFloat(parts[index]);
    if (!Number.isFinite(parsed)) throw new Error(`"${parts[index]}" is not a number in ${name}()`);
    return parsed;
  };
  /** A 0–1 fraction, accepting "60%", "0.6", or "60". */
  const frac = (index) => {
    const parsed = num(index);
    return parts[index].endsWith("%") || parsed > 1 ? parsed / 100 : parsed;
  };
  /** A 0–255 channel, accepting "255" or "100%". */
  const byte = (index) => clamp(Math.round(parts[index].endsWith("%") ? (num(index) / 100) * 255 : num(index)), 0, 255);
  const a = parts.length > componentCount ? clamp(parts[componentCount].endsWith("%") ? num(componentCount) / 100 : num(componentCount)) : 1;

  if (name === "rgb" || name === "rgba") return { r: byte(0), g: byte(1), b: byte(2), a };
  if (name === "hsl" || name === "hsla") return { ...hslToRgb(num(0), frac(1), frac(2)), a };
  if (name === "hsv" || name === "hsb") return { ...hsvToRgb(num(0), frac(1), frac(2)), a };
  if (name === "cmyk") return { ...cmykToRgb(frac(0), frac(1), frac(2), frac(3)), a };
  if (name === "oklch") return { ...oklchToRgb(frac(0), num(1), num(2)), a };
  if (name === "oklab") return { ...oklabToRgb(frac(0), num(1), num(2)), a };
  if (name === "lab") return { ...labToRgb(num(0), num(1), num(2)), a };
  if (name === "lch") return { ...lchToRgb(num(0), num(1), num(2)), a };
  throw new Error(`"${name}()" is not supported`);
}

/* ------------------------------------------------------------ conversions */

export function rgbToHsl(r, g, b) {
  const [red, green, blue] = [r / 255, g / 255, b / 255];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const lightness = (max + min) / 2;
  if (delta === 0) return { h: 0, s: 0, l: lightness };
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue;
  if (max === red) hue = ((green - blue) / delta) % 6;
  else if (max === green) hue = (blue - red) / delta + 2;
  else hue = (red - green) / delta + 4;
  hue *= 60;
  if (hue < 0) hue += 360;
  return { h: hue, s: saturation, l: lightness };
}

export function hslToRgb(h, s, l) {
  const hue = ((h % 360) + 360) % 360;
  const saturation = clamp(s);
  const lightness = clamp(l);
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lightness - c / 2;
  const table = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]];
  const [r, g, b] = table[Math.floor(hue / 60) % 6];
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}

export function rgbToHsv(r, g, b) {
  const [red, green, blue] = [r / 255, g / 255, b / 255];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;
  if (delta !== 0) {
    if (max === red) hue = (((green - blue) / delta) % 6) * 60;
    else if (max === green) hue = ((blue - red) / delta + 2) * 60;
    else hue = ((red - green) / delta + 4) * 60;
  }
  if (hue < 0) hue += 360;
  return { h: hue, s: max === 0 ? 0 : delta / max, v: max };
}

export function hsvToRgb(h, s, v) {
  const hue = ((h % 360) + 360) % 360;
  const c = clamp(v) * clamp(s);
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = clamp(v) - c;
  const table = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]];
  const [r, g, b] = table[Math.floor(hue / 60) % 6];
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}

export function rgbToCmyk(r, g, b) {
  const [red, green, blue] = [r / 255, g / 255, b / 255];
  const k = 1 - Math.max(red, green, blue);
  if (k === 1) return { c: 0, m: 0, y: 0, k: 1 };
  return { c: (1 - red - k) / (1 - k), m: (1 - green - k) / (1 - k), y: (1 - blue - k) / (1 - k), k };
}

export function cmykToRgb(c, m, y, k) {
  return {
    r: Math.round(255 * (1 - clamp(c)) * (1 - clamp(k))),
    g: Math.round(255 * (1 - clamp(m)) * (1 - clamp(k))),
    b: Math.round(255 * (1 - clamp(y)) * (1 - clamp(k))),
  };
}

const toLinear = (channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
const fromLinear = (channel) => (channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055);

export function rgbToOklab(r, g, b) {
  const [lr, lg, lb] = [toLinear(r / 255), toLinear(g / 255), toLinear(b / 255)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

export function oklabToRgb(L, A, B) {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const lr = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return {
    r: Math.round(clamp(fromLinear(lr)) * 255),
    g: Math.round(clamp(fromLinear(lg)) * 255),
    b: Math.round(clamp(fromLinear(lb)) * 255),
  };
}

export function rgbToOklch(r, g, b) {
  const { l, a, b: bb } = rgbToOklab(r, g, b);
  const chroma = Math.hypot(a, bb);
  let hue = (Math.atan2(bb, a) * 180) / Math.PI;
  if (hue < 0) hue += 360;
  return { l, c: chroma, h: chroma < 1e-6 ? 0 : hue };
}

export function oklchToRgb(l, c, h) {
  const radians = (h * Math.PI) / 180;
  return oklabToRgb(l, c * Math.cos(radians), c * Math.sin(radians));
}

const WHITE = [95.047, 100, 108.883];

export function rgbToLab(r, g, b) {
  const [lr, lg, lb] = [toLinear(r / 255), toLinear(g / 255), toLinear(b / 255)];
  const x = (lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375) * 100;
  const y = (lr * 0.2126729 + lg * 0.7151522 + lb * 0.072175) * 100;
  const z = (lr * 0.0193339 + lg * 0.119192 + lb * 0.9503041) * 100;
  const f = (value) => (value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116);
  const [fx, fy, fz] = [f(x / WHITE[0]), f(y / WHITE[1]), f(z / WHITE[2])];
  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export function labToRgb(L, A, B) {
  const fy = (L + 16) / 116;
  const fx = fy + A / 500;
  const fz = fy - B / 200;
  const inverse = (value) => (value ** 3 > 0.008856 ? value ** 3 : (value - 16 / 116) / 7.787);
  const x = (inverse(fx) * WHITE[0]) / 100;
  const y = (inverse(fy) * WHITE[1]) / 100;
  const z = (inverse(fz) * WHITE[2]) / 100;
  const lr = x * 3.2404542 + y * -1.5371385 + z * -0.4985314;
  const lg = x * -0.969266 + y * 1.8760108 + z * 0.041556;
  const lb = x * 0.0556434 + y * -0.2040259 + z * 1.0572252;
  return { r: Math.round(clamp(fromLinear(lr)) * 255), g: Math.round(clamp(fromLinear(lg)) * 255), b: Math.round(clamp(fromLinear(lb)) * 255) };
}

export function lchToRgb(l, c, h) {
  const radians = (h * Math.PI) / 180;
  return labToRgb(l, c * Math.cos(radians), c * Math.sin(radians));
}

/* ------------------------------------------------------------ formatting -- */

export function toHex({ r, g, b, a = 1 }, { alpha = false, short = true } = {}) {
  const pair = (value) => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, "0");
  let hex = `#${pair(r)}${pair(g)}${pair(b)}`;
  if (alpha && a < 1) hex += pair(a * 255);
  if (short && /^#(.)\1(.)\2(.)\3$/.test(hex)) hex = `#${hex[1]}${hex[3]}${hex[5]}`;
  return hex;
}

export function relativeLuminance({ r, g, b }) {
  return 0.2126 * toLinear(r / 255) + 0.7152 * toLinear(g / 255) + 0.0722 * toLinear(b / 255);
}

export function contrastRatio(first, second) {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function describeColor(input) {
  const color = parseColor(input);
  const hsl = rgbToHsl(color.r, color.g, color.b);
  const hsv = rgbToHsv(color.r, color.g, color.b);
  const cmyk = rgbToCmyk(color.r, color.g, color.b);
  const oklch = rgbToOklch(color.r, color.g, color.b);
  const lab = rgbToLab(color.r, color.g, color.b);
  const nearest = nearestNamedColor(color);
  const whiteContrast = contrastRatio(color, { r: 255, g: 255, b: 255 });
  const blackContrast = contrastRatio(color, { r: 0, g: 0, b: 0 });
  const rows = [
    ["HEX", toHex(color, { short: false })],
    ["HEX short", toHex(color)],
    ["RGB", `rgb(${color.r} ${color.g} ${color.b}${color.a < 1 ? ` / ${round(color.a, 3)}` : ""})`],
    ["RGB legacy", `rgba(${color.r}, ${color.g}, ${color.b}, ${round(color.a, 3)})`],
    ["HSL", `hsl(${round(hsl.h, 1)} ${round(hsl.s * 100, 1)}% ${round(hsl.l * 100, 1)}%)`],
    ["HSV", `hsv(${round(hsv.h, 1)} ${round(hsv.s * 100, 1)}% ${round(hsv.v * 100, 1)}%)`],
    ["CMYK", `cmyk(${round(cmyk.c * 100, 1)}% ${round(cmyk.m * 100, 1)}% ${round(cmyk.y * 100, 1)}% ${round(cmyk.k * 100, 1)}%)`],
    ["OKLCH", `oklch(${round(oklch.l * 100, 2)}% ${round(oklch.c, 4)} ${round(oklch.h, 2)})`],
    ["CIELAB", `lab(${round(lab.l, 2)} ${round(lab.a, 2)} ${round(lab.b, 2)})`],
    ["Nearest name", `${nearest.name} (${nearest.hex}${nearest.distance === 0 ? ", exact" : `, Δ${round(nearest.distance, 1)}`})`],
    ["Luminance", round(relativeLuminance(color), 4)],
    ["On white", `${round(whiteContrast, 2)}:1 — ${wcagVerdict(whiteContrast)}`],
    ["On black", `${round(blackContrast, 2)}:1 — ${wcagVerdict(blackContrast)}`],
  ];
  const width = Math.max(...rows.map(([label]) => label.length));
  return rows.map(([label, value]) => `${label.padEnd(width)}  ${value}`).join("\n");
}

function wcagVerdict(ratio) {
  if (ratio >= 7) return "AAA for all text";
  if (ratio >= 4.5) return "AA for all text, AAA for large text";
  if (ratio >= 3) return "AA for large text only";
  return "fails WCAG contrast";
}

export function nearestNamedColor(color) {
  let best = { name: "", hex: "", distance: Infinity };
  const target = rgbToLab(color.r, color.g, color.b);
  for (const [name, hex] of Object.entries(CSS_COLORS)) {
    const candidate = parseColor(hex);
    const lab = rgbToLab(candidate.r, candidate.g, candidate.b);
    const distance = Math.hypot(lab.l - target.l, lab.a - target.a, lab.b - target.b);
    if (distance < best.distance) best = { name, hex, distance };
  }
  return best;
}

export function checkContrast(foreground, background) {
  const front = parseColor(foreground);
  const back = parseColor(background);
  const ratio = contrastRatio(front, back);
  const check = (threshold) => (ratio >= threshold ? "PASS" : "FAIL");
  return [
    `Foreground  ${toHex(front, { short: false })}`,
    `Background  ${toHex(back, { short: false })}`,
    `Ratio       ${round(ratio, 2)}:1`,
    "",
    `AA  normal text (4.5:1)   ${check(4.5)}`,
    `AA  large text  (3.0:1)   ${check(3)}`,
    `AA  UI components (3.0:1) ${check(3)}`,
    `AAA normal text (7.0:1)   ${check(7)}`,
    `AAA large text  (4.5:1)   ${check(4.5)}`,
  ].join("\n");
}

export function buildPalette(input, scheme = "shades") {
  const base = parseColor(input);
  const hsl = rgbToHsl(base.r, base.g, base.b);
  const make = (h, s, l) => toHex(hslToRgb(h, s, l), { short: false });
  const schemes = {
    shades: () => Array.from({ length: 11 }, (_, index) => [`${index === 0 ? 50 : index * 100}`, make(hsl.h, hsl.s, 1 - index * 0.09 - 0.03)]),
    tints: () => Array.from({ length: 10 }, (_, index) => [`tint ${index * 10}%`, make(hsl.h, hsl.s, hsl.l + (1 - hsl.l) * (index / 10))]),
    complementary: () => [["base", toHex(base, { short: false })], ["complement", make(hsl.h + 180, hsl.s, hsl.l)]],
    triadic: () => [["base", toHex(base, { short: false })], ["triad 1", make(hsl.h + 120, hsl.s, hsl.l)], ["triad 2", make(hsl.h + 240, hsl.s, hsl.l)]],
    tetradic: () => [["base", toHex(base, { short: false })], ["tetrad 1", make(hsl.h + 90, hsl.s, hsl.l)], ["tetrad 2", make(hsl.h + 180, hsl.s, hsl.l)], ["tetrad 3", make(hsl.h + 270, hsl.s, hsl.l)]],
    analogous: () => [-60, -30, 0, 30, 60].map((offset) => [`${offset >= 0 ? "+" : ""}${offset}°`, make(hsl.h + offset, hsl.s, hsl.l)]),
    "split complementary": () => [["base", toHex(base, { short: false })], ["split 1", make(hsl.h + 150, hsl.s, hsl.l)], ["split 2", make(hsl.h + 210, hsl.s, hsl.l)]],
    monochromatic: () => [0.2, 0.35, 0.5, 0.65, 0.8].map((lightness) => [`L ${Math.round(lightness * 100)}%`, make(hsl.h, hsl.s, lightness)]),
  };
  const build = schemes[scheme];
  if (!build) throw new Error(`Unknown palette scheme "${scheme}"`);
  const entries = build();
  const width = Math.max(...entries.map(([label]) => label.length));
  return entries.map(([label, hex]) => `${label.padEnd(width)}  ${hex}  rgb(${parseColor(hex).r} ${parseColor(hex).g} ${parseColor(hex).b})`).join("\n");
}

export function swatchesFor(text) {
  return [...text.matchAll(/#[0-9a-f]{6}\b/gi)].map((match) => match[0]);
}
