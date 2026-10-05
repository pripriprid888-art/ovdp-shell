const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { app } = require('electron');
const { mergeLogEntries, parseRemoteLogPayload } = require('./log-merge');

const BUCKET = 'ovdp-history';
const DEVICE_ID_FILE = 'log-sync-device-id.json';

let uploadTimer = null;
let uploadInFlight = null;

function isLogRemoteConfigured() {
  return Boolean(
    process.env.AWS_ACCESS_KEY_ID
    && process.env.AWS_SECRET_ACCESS_KEY
    && process.env.AWS_ENDPOINT_URL_S3
    && process.env.AWS_REGION
  );
}

function getS3Client() {
  return new S3Client({
    region: process.env.AWS_REGION,
    endpoint: process.env.AWS_ENDPOINT_URL_S3,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
  });
}

function getDeviceIdPath() {
  return path.join(app.getPath('userData'), DEVICE_ID_FILE);
}

function getDeviceId() {
  const filePath = getDeviceIdPath();
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (parsed?.deviceId) return String(parsed.deviceId);
  } catch {
    // create below
  }
  const deviceId = crypto.randomUUID();
  fs.writeFileSync(filePath, JSON.stringify({ deviceId, createdAt: new Date().toISOString() }, null, 2), 'utf8');
  return deviceId;
}

function objectKey(deviceId) {
  return `devices/${deviceId}/action-log.json`;
}

async function streamToString(body) {
  if (!body) return '';
  if (typeof body.transformToString === 'function') {
    return body.transformToString('utf8');
  }
  const chunks = [];
  for await (const chunk of body) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function fetchRemoteEntries() {
  if (!isLogRemoteConfigured()) return [];
  const deviceId = getDeviceId();
  const client = getS3Client();
  try {
    const res = await client.send(new GetObjectCommand({
      Bucket: BUCKET,
      Key: objectKey(deviceId),
    }));
    const text = await streamToString(res.Body);
    return parseRemoteLogPayload(text);
  } catch (err) {
    const code = err?.name || err?.Code;
    if (code === 'NoSuchKey' || code === 'NotFound') return [];
    throw err;
  }
}

async function uploadSnapshot(payload) {
  if (!isLogRemoteConfigured()) return false;
  const deviceId = getDeviceId();
  const client = getS3Client();
  const body = JSON.stringify(payload);
  await client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: objectKey(deviceId),
    Body: body,
    ContentType: 'application/json',
  }));
  return true;
}

async function syncFromRemote(localEntries, maxStored) {
  if (!isLogRemoteConfigured()) return localEntries;
  const remoteEntries = await fetchRemoteEntries();
  if (!remoteEntries.length) return localEntries;
  return mergeLogEntries(localEntries, remoteEntries, maxStored);
}

function scheduleUpload(getPayload, delayMs = 2000) {
  if (!isLogRemoteConfigured()) return;
  if (uploadTimer) clearTimeout(uploadTimer);
  uploadTimer = setTimeout(() => {
    uploadTimer = null;
    const payload = getPayload();
    uploadInFlight = uploadSnapshot(payload)
      .catch(() => {})
      .finally(() => {
        uploadInFlight = null;
      });
  }, delayMs);
}

async function flushUpload(getPayload) {
  if (uploadTimer) {
    clearTimeout(uploadTimer);
    uploadTimer = null;
  }
  if (uploadInFlight) {
    try {
      await uploadInFlight;
    } catch {
      // ignore
    }
  }
  if (!isLogRemoteConfigured()) return;
  await uploadSnapshot(getPayload());
}

module.exports = {
  BUCKET,
  isLogRemoteConfigured,
  syncFromRemote,
  scheduleUpload,
  flushUpload,
  uploadSnapshot,
  fetchRemoteEntries,
  getDeviceId,
};
