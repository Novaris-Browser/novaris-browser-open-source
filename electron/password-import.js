const MAX_CSV_BYTES = 5 * 1024 * 1024;
const MAX_RECORDS = 2000;

function parseCsv(input) {
  const text = Buffer.isBuffer(input) ? input.toString('utf8') : String(input || '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    if (row.some((value) => value.trim())) rows.push(row);
  }
  return rows;
}

function normalizeHeader(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function safeUrl(value) {
  const raw = String(value || '').trim();
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : '';
  } catch {
    return '';
  }
}

function parsePasswordCsv(input) {
  const text = Buffer.isBuffer(input) ? input.toString('utf8') : String(input || '');
  if (text.length > MAX_CSV_BYTES) throw new Error('That password export is too large.');
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const headers = rows[0].map(normalizeHeader);
  const find = (...names) => headers.findIndex((header) => names.includes(header));
  const urlIndex = find('url', 'website', 'webaddress', 'loginuri', 'origin');
  const usernameIndex = find('username', 'user', 'loginusername', 'email', 'emailaddress');
  const passwordIndex = find('password', 'pass', 'loginpassword');
  const titleIndex = find('name', 'title', 'sitename', 'account');
  if (passwordIndex < 0 || (urlIndex < 0 && titleIndex < 0)) throw new Error('The CSV must contain a password column and a website or name column.');
  const records = [];
  for (const row of rows.slice(1, MAX_RECORDS + 1)) {
    const password = String(row[passwordIndex] || '').slice(0, 1024);
    const url = urlIndex >= 0 ? safeUrl(row[urlIndex]) : '';
    const title = titleIndex >= 0 ? String(row[titleIndex] || '').trim().slice(0, 160) : '';
    const username = usernameIndex >= 0 ? String(row[usernameIndex] || '').trim().slice(0, 320) : '';
    if (!password || !url || !username) continue;
    records.push({ url, title: title || (url ? new URL(url).hostname : 'Imported login'), username, password });
  }
  return records;
}

module.exports = { MAX_CSV_BYTES, MAX_RECORDS, parsePasswordCsv, parseCsv };
