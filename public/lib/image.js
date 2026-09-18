// Canvas-backed image conversion. These functions only run in a browser; the
// registry gates them behind file input so they are never reached in Node.

import { formatBytes, bytesToBase64 } from "./bytes.js";

const SUPPORTED = { png: "image/png", jpeg: "image/jpeg", jpg: "image/jpeg", webp: "image/webp" };

async function loadBitmap(blob) {
  if (typeof createImageBitmap === "function") {
    try { return await createImageBitmap(blob); }
    catch { /* fall through to the <img> path for SVG and odd encoders */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("The browser could not decode that image"));
      element.src = url;
    });
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function drawToCanvas(source, width, height, background) {
  const canvas = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(width, height) : Object.assign(document.createElement("canvas"), { width, height });
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  if (background) {
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);
  }
  context.drawImage(source, 0, 0, width, height);
  return canvas;
}

async function canvasToBlob(canvas, type, quality) {
  if (typeof canvas.convertToBlob === "function") return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(`This browser cannot encode ${type}`))), type, quality);
  });
}

export function targetDimensions(width, height, { maxWidth = 0, maxHeight = 0, scale = 100 } = {}) {
  let targetWidth = Math.round((width * scale) / 100);
  let targetHeight = Math.round((height * scale) / 100);
  if (maxWidth > 0 && targetWidth > maxWidth) {
    targetHeight = Math.round((targetHeight * maxWidth) / targetWidth);
    targetWidth = maxWidth;
  }
  if (maxHeight > 0 && targetHeight > maxHeight) {
    targetWidth = Math.round((targetWidth * maxHeight) / targetHeight);
    targetHeight = maxHeight;
  }
  return { width: Math.max(1, targetWidth), height: Math.max(1, targetHeight) };
}

export async function convertImage(file, { format = "png", quality = 90, maxWidth = 0, maxHeight = 0, scale = 100, background = "" } = {}) {
  const type = SUPPORTED[format];
  if (!type) throw new Error(`"${format}" is not a supported output format`);
  const bitmap = await loadBitmap(file);
  const sourceWidth = bitmap.width || bitmap.naturalWidth;
  const sourceHeight = bitmap.height || bitmap.naturalHeight;
  if (!sourceWidth || !sourceHeight) throw new Error("The image has no readable dimensions");
  const target = targetDimensions(sourceWidth, sourceHeight, { maxWidth, maxHeight, scale });
  const fill = background || (type === "image/jpeg" ? "#ffffff" : "");
  const canvas = drawToCanvas(bitmap, target.width, target.height, fill);
  const blob = await canvasToBlob(canvas, type, Math.min(1, Math.max(0.01, quality / 100)));
  if (typeof bitmap.close === "function") bitmap.close();
  const report = [
    `Source        ${file.name || "image"} · ${sourceWidth} × ${sourceHeight} · ${formatBytes(file.size)}`,
    `Output        ${format.toUpperCase()} · ${target.width} × ${target.height} · ${formatBytes(blob.size)}`,
    `Change        ${blob.size === file.size ? "no change" : `${blob.size < file.size ? "-" : "+"}${Math.abs(((blob.size - file.size) / file.size) * 100).toFixed(1)}%`}`,
    type === "image/png" ? "Quality       lossless" : `Quality       ${quality}%`,
    "",
    "Use Download to save the converted image.",
  ].join("\n");
  return { blob, report, width: target.width, height: target.height };
}

export async function imageToDataUri(file, { format = "", quality = 90, maxWidth = 0 } = {}) {
  let blob = file;
  if (format) ({ blob } = await convertImage(file, { format, quality, maxWidth }));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const uri = `data:${blob.type || "application/octet-stream"};base64,${bytesToBase64(bytes)}`;
  return {
    uri,
    report: [
      `Type          ${blob.type || "unknown"}`,
      `Raw size      ${formatBytes(bytes.length)}`,
      `Encoded size  ${formatBytes(uri.length)} (+${(((uri.length - bytes.length) / bytes.length) * 100).toFixed(0)}%)`,
      "",
      uri.length > 200000 ? "This URI is large — inline images above ~100 KB usually belong in a separate request." : "Small enough to inline in CSS or HTML.",
      "",
      uri,
    ].join("\n"),
  };
}

export async function describeImage(file) {
  const bitmap = await loadBitmap(file);
  const width = bitmap.width || bitmap.naturalWidth;
  const height = bitmap.height || bitmap.naturalHeight;
  const divisor = gcd(width, height);
  if (typeof bitmap.close === "function") bitmap.close();
  return [
    `File          ${file.name || "image"}`,
    `Media type    ${file.type || "unknown"}`,
    `Dimensions    ${width} × ${height} px`,
    `Aspect ratio  ${width / divisor}:${height / divisor}`,
    `Megapixels    ${((width * height) / 1e6).toFixed(2)} MP`,
    `File size     ${formatBytes(file.size)}`,
    `Bytes/pixel   ${(file.size / (width * height)).toFixed(3)}`,
  ].join("\n");
}

function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
}
