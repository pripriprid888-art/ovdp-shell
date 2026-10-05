function mergeLogEntries(localEntries, remoteEntries, maxStored) {
  const byId = new Map();
  for (const entry of [...localEntries, ...remoteEntries]) {
    if (!entry?.id) continue;
    const existing = byId.get(entry.id);
    if (!existing || String(entry.at || '') > String(existing.at || '')) {
      byId.set(entry.id, entry);
    }
  }
  return [...byId.values()]
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
    .slice(0, maxStored);
}

function parseRemoteLogPayload(text) {
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed?.entries) ? parsed.entries : [];
  } catch {
    return [];
  }
}

module.exports = {
  mergeLogEntries,
  parseRemoteLogPayload,
};
