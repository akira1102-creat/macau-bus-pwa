/* global Buffer, URL */

import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const outputDirectory = new URL('../public/icons/', import.meta.url);
mkdirSync(outputDirectory, { recursive: true });

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  typeBuffer.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return result;
}

function roundedRectangle(pixels, size, x, y, width, height, radius, color) {
  for (let py = Math.max(0, y); py < Math.min(size, y + height); py += 1) {
    for (let px = Math.max(0, x); px < Math.min(size, x + width); px += 1) {
      const dx = Math.max(x + radius - px, 0, px - (x + width - radius - 1));
      const dy = Math.max(y + radius - py, 0, py - (y + height - radius - 1));
      if (dx * dx + dy * dy <= radius * radius) {
        const offset = (py * size + px) * 4;
        pixels[offset] = color[0];
        pixels[offset + 1] = color[1];
        pixels[offset + 2] = color[2];
        pixels[offset + 3] = 255;
      }
    }
  }
}

function rectangle(pixels, size, x, y, width, height, color) {
  for (let py = Math.max(0, y); py < Math.min(size, y + height); py += 1) {
    for (let px = Math.max(0, x); px < Math.min(size, x + width); px += 1) {
      const offset = (py * size + px) * 4;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
      pixels[offset + 3] = 255;
    }
  }
}

function circle(pixels, size, centerX, centerY, radius, color) {
  for (let py = Math.max(0, centerY - radius); py <= Math.min(size - 1, centerY + radius); py += 1) {
    for (let px = Math.max(0, centerX - radius); px <= Math.min(size - 1, centerX + radius); px += 1) {
      const dx = px - centerX;
      const dy = py - centerY;
      if (dx * dx + dy * dy <= radius * radius) {
        const offset = (py * size + px) * 4;
        pixels[offset] = color[0];
        pixels[offset + 1] = color[1];
        pixels[offset + 2] = color[2];
        pixels[offset + 3] = 255;
      }
    }
  }
}

function iconPng(size, maskable) {
  const pixels = Buffer.alloc(size * size * 4, 255);
  const jade = [13, 124, 114];
  const white = [255, 255, 255];
  const ink = [18, 48, 48];
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels[offset] = jade[0];
    pixels[offset + 1] = jade[1];
    pixels[offset + 2] = jade[2];
  }

  const scale = size / 512;
  const value = (number) => Math.round(number * scale);
  const bodyX = maskable ? 112 : 88;
  const bodyY = maskable ? 134 : 124;
  const bodyWidth = maskable ? 288 : 336;
  const bodyHeight = maskable ? 246 : 264;
  roundedRectangle(pixels, size, value(bodyX), value(bodyY), value(bodyWidth), value(bodyHeight), value(54), white);
  roundedRectangle(pixels, size, value(bodyX + 35), value(bodyY + 35), value(88), value(76), value(16), jade);
  roundedRectangle(pixels, size, value(bodyX + bodyWidth - 123), value(bodyY + 35), value(88), value(76), value(16), jade);
  rectangle(pixels, size, value(bodyX + 35), value(bodyY + 142), value(bodyWidth - 70), value(14), jade);
  circle(pixels, size, value(bodyX + 78), value(bodyY + bodyHeight - 4), value(28), ink);
  circle(pixels, size, value(bodyX + bodyWidth - 78), value(bodyY + bodyHeight - 4), value(28), ink);
  return pngBuffer(size, pixels);
}

function pngBuffer(size, pixels) {
  const rows = [];
  const rowLength = size * 4;
  for (let y = 0; y < size; y += 1) {
    rows.push(Buffer.concat([Buffer.from([0]), pixels.subarray(y * rowLength, (y + 1) * rowLength)]));
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from('\x89PNG\r\n\x1a\n', 'binary'),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

writeFileSync(new URL('icon-192.png', outputDirectory), iconPng(192, false));
writeFileSync(new URL('icon-512.png', outputDirectory), iconPng(512, false));
writeFileSync(new URL('icon-maskable-512.png', outputDirectory), iconPng(512, true));
