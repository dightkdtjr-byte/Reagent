'use strict';
// 백업 묶음(zip) 읽기·쓰기. 외부 모듈 없이 zip 형식의 최소 부분만 다룬다.
// 쓰기: 저장(무압축, PDF는 이미 압축돼 있음). 읽기: 무압축과 deflate 둘 다 푼다.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const MAX_ENTRIES = 5000;
const MAX_TOTAL = 2 * 1024 * 1024 * 1024;

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function dosTime(d) {
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() >> 1) & 31);
  const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return {time, date};
}
function safeName(name) {
  const n = String(name || '').replace(/\\/g, '/');
  if (!n || n.length > 300 || n.startsWith('/') || /^[a-zA-Z]:/.test(n) || n.split('/').some(p => p === '..' || p === '' ) || /[\x00-\x1f]/.test(n)) return '';
  return n;
}
// entries: [{name, data:Buffer}]
function writeZip(file, entries, now = new Date()) {
  if (!Array.isArray(entries) || entries.length > MAX_ENTRIES) throw new Error('묶음에 넣을 파일이 너무 많습니다.');
  const {time, date} = dosTime(now);
  const parts = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const name = safeName(e.name); if (!name) throw new Error('묶음 파일 이름이 올바르지 않습니다: ' + e.name);
    const nameBuf = Buffer.from(name, 'utf8'), data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data), 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    parts.push(local, nameBuf, data);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x0800, 8); cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(time, 12); cd.writeUInt16LE(date, 14); cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28); cd.writeUInt16LE(0, 30); cd.writeUInt16LE(0, 32); cd.writeUInt16LE(0, 34); cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38); cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += local.length + nameBuf.length + data.length;
    if (offset > MAX_TOTAL) throw new Error('묶음이 너무 큽니다 (2 GB 초과).');
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10); eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(0, 20);
  const out = Buffer.concat([...parts, cdBuf, eocd]);
  const temp = file + '.tmp-' + process.pid;
  fs.writeFileSync(temp, out, {flag: 'wx'});
  try { fs.renameSync(temp, file); } catch (e) { try { fs.unlinkSync(temp); } catch {} throw e; }
  return {entries: entries.length, bytes: out.length};
}
// zip 파일을 읽어 [{name, data}]로 돌려준다. 손상·경로 이탈·과대 항목은 오류.
function readZip(file) {
  const buf = fs.readFileSync(file);
  if (buf.length > MAX_TOTAL) throw new Error('묶음 파일이 너무 큽니다.');
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) { if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; } }
  if (eocd < 0) throw new Error('zip 형식이 아닙니다.');
  const count = buf.readUInt16LE(eocd + 10), cdSize = buf.readUInt32LE(eocd + 12), cdOffset = buf.readUInt32LE(eocd + 16);
  if (count > MAX_ENTRIES || cdOffset + cdSize > buf.length) throw new Error('zip 목록이 손상되었습니다.');
  const out = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip 목록이 손상되었습니다.');
    const method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), loff = buf.readUInt32LE(p + 42);
    const rawName = buf.subarray(p + 46, p + 46 + nlen).toString('utf8');
    p += 46 + nlen + xlen + clen;
    if (rawName.endsWith('/')) continue;
    const name = safeName(rawName); if (!name) throw new Error('zip 안의 파일 경로가 올바르지 않습니다: ' + rawName);
    if (loff + 30 > buf.length || buf.readUInt32LE(loff) !== 0x04034b50) throw new Error('zip 항목이 손상되었습니다: ' + name);
    const lnlen = buf.readUInt16LE(loff + 26), lxlen = buf.readUInt16LE(loff + 28);
    const start = loff + 30 + lnlen + lxlen;
    if (start + csize > buf.length) throw new Error('zip 항목이 손상되었습니다: ' + name);
    const comp = buf.subarray(start, start + csize);
    let data;
    if (method === 0) data = Buffer.from(comp);
    else if (method === 8) data = zlib.inflateRawSync(comp, {maxOutputLength: Math.min(usize + 1, 512 * 1024 * 1024)});
    else throw new Error('지원하지 않는 압축 방식입니다: ' + name);
    if (data.length !== usize || crc32(data) !== crc) throw new Error('zip 항목 내용이 손상되었습니다: ' + name);
    out.push({name, data});
  }
  return out;
}
module.exports = {writeZip, readZip, crc32, safeName};
