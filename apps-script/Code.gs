/* LawVault v5 — Google Apps Script backend (Code.gs).
 *
 * This script is the ONLY writer to the LawVault Google Sheet. The
 * public site reads the Sheet directly (gviz, read-only); the admin
 * panel sends every change here, and this script verifies the admin
 * credentials server-side before writing anything.
 *
 * SECURITY — READ BEFORE DEPLOYING:
 * - Admin credentials live ONLY in Project Settings > Script
 *   properties, under the keys ADMIN_CODE and ADMIN_PASS_HASH.
 *   ADMIN_PASS_HASH is the SHA-256 hex digest of the password.
 *   NEVER write a credential value into this file, into the Sheet,
 *   into the website code, or into chat. See SETUP.md for how to
 *   generate the hash and set the properties.
 * - Deploy as a web app: "Execute as: Me", "Who has access: Anyone".
 *   "Anyone" only means anyone may CALL the endpoint; every write
 *   still requires valid credentials, checked here on the server.
 * - Only whitelisted tabs and columns are writable. Links must use
 *   https://. Every action — including failed logins — is appended
 *   to the activity_log tab.
 *
 * Attach this script to the LawVault Sheet (Extensions > Apps Script
 * from inside the Sheet), then run setupSheets() once. It is safe to
 * run setupSheets() again: it only creates missing tabs and only
 * seeds tabs that are still empty.
 */

var SHEETS = {
  settings: ['key', 'value'],
  daily_notes: ['id', 'title', 'description', 'drive_link', 'subject', 'publish_at', 'expires_at', 'important', 'enabled', 'status', 'created_at', 'updated_at'],
  announcements: ['id', 'title', 'description', 'badge', 'pinned', 'publish_at', 'expires_at', 'enabled', 'status', 'created_at', 'updated_at'],
  semesters: ['id', 'number', 'label', 'configured', 'enabled', 'order'],
  subjects: ['id', 'semester_id', 'name', 'icon', 'unit', 'description', 'drive_link', 'enabled', 'order'],
  case_laws: ['id', 'title', 'citation', 'court', 'year', 'subject', 'facts', 'issues', 'judgment', 'ratio', 'exam_relevance', 'drive_link', 'important', 'status'],
  papers: ['id', 'title', 'year', 'semester_id', 'subject', 'exam_type', 'drive_link', 'status'],
  exam_prep: ['id', 'category', 'title', 'description', 'drive_link', 'enabled', 'order'],
  pending: ['id', 'title', 'description', 'drive_link', 'status', 'reason', 'created_at'],
  contacts: ['id', 'label', 'kind', 'destination', 'enabled', 'order'],
  activity_log: ['timestamp', 'admin', 'action', 'module', 'detail', 'result']
};

/* Required fields per writable tab. A missing/empty required field
   rejects the write with an error; nothing is written. */
var REQUIRED = {
  daily_notes: ['title', 'drive_link'],
  announcements: ['title'],
  semesters: ['number', 'label'],
  subjects: ['semester_id', 'name', 'drive_link'],
  case_laws: ['title'],
  papers: ['title', 'year', 'drive_link'],
  exam_prep: ['category', 'title'],
  pending: ['title'],
  contacts: ['label'],
  settings: ['key']
};

var MAIN_DRIVE_FOLDER = 'https://drive.google.com/drive/folders/1QgNVQx2CeYywm8yoS3xGX-ExmHglIIVz';

/* ------------------------------------------------------------------ */
/* Credentials: Script Properties only. No credential value may ever  */
/* appear in this file.                                               */
/* ------------------------------------------------------------------ */

function sha256Hex(text) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8);
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    var v = (bytes[i] + 256) % 256;
    hex += ('0' + v.toString(16)).slice(-2);
  }
  return hex;
}

function verifyCredentials(code, pass) {
  var props = PropertiesService.getScriptProperties();
  var expectedCode = props.getProperty('ADMIN_CODE');
  var expectedHash = props.getProperty('ADMIN_PASS_HASH');
  if (!expectedCode || !expectedHash) return false;
  if (String(code) !== expectedCode) return false;
  return sha256Hex(pass) === expectedHash;
}

/* ------------------------------------------------------------------ */
/* Sheet helpers                                                      */
/* ------------------------------------------------------------------ */

function getSheet(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  return sheet;
}

function ensureHeaders(name) {
  var sheet = getSheet(name);
  var headers = SHEETS[name];
  var first = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  var empty = first.every(function (v) { return v === '' || v === null; });
  if (empty) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function sheetIsEmpty(name) {
  var sheet = getSheet(name);
  return sheet.getLastRow() <= 1;
}

function seedRows(name, rows) {
  if (!rows.length) return;
  var sheet = getSheet(name);
  sheet.getRange(2, 1, rows.length, SHEETS[name].length).setValues(rows);
}

function findRowIndex(sheet, id) {
  var last = sheet.getLastRow();
  if (last < 2) return -1;
  var ids = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

function rowToObject(headers, values) {
  var obj = {};
  for (var i = 0; i < headers.length; i++) obj[headers[i]] = values[i];
  return obj;
}

function objectToRow(headers, obj) {
  var row = [];
  for (var i = 0; i < headers.length; i++) {
    var v = obj[headers[i]];
    row.push(v === undefined || v === null ? '' : v);
  }
  return row;
}

function newId(prefix) {
  return prefix + '-' + Date.now().toString(36) +
    Math.random().toString(36).slice(2, 6);
}

function nowIso() {
  return new Date().toISOString();
}

function isHttps(value) {
  return /^https:\/\//i.test(String(value).trim());
}

/* ------------------------------------------------------------------ */
/* setupSheets(): create tabs + headers, seed defaults. Idempotent.   */
/* Run once from the Apps Script editor after attaching this script   */
/* to the LawVault Sheet.                                             */
/* ------------------------------------------------------------------ */

function setupSheets() {
  Object.keys(SHEETS).forEach(function (name) { ensureHeaders(name); });

  if (sheetIsEmpty('settings')) {
    seedRows('settings', [
      ['site_title', 'LawVault'],
      ['site_tagline', 'LLB CLASS LIBRARY'],
      ['welcome_title', 'Your LLB Study Space'],
      ['welcome_subtitle', 'Welcome to LawVault — your class notes, case laws, papers and exam resources, organised in one place.'],
      ['footer_tagline', 'Study • Revise • Prepare • Succeed'],
      ['main_drive_folder', MAIN_DRIVE_FOLDER],
      ['default_mode', 'dark'],
      ['default_color', 'emerald'],
      ['festival_auto', 'TRUE'],
      ['exam_date', '']
    ]);
  }

  if (sheetIsEmpty('semesters')) {
    var sems = [];
    for (var n = 1; n <= 7; n++) {
      sems.push(['sem-' + n, n, 'Semester ' + n, n === 1 ? 'TRUE' : 'FALSE', 'TRUE', n]);
    }
    seedRows('semesters', sems);
  }

  if (sheetIsEmpty('subjects')) {
    /* The 5 real Semester 1 notes, with their exact Drive Doc links
       copied from the v4 site content. Do not invent or alter links. */
    seedRows('subjects', [
      ['subj-contract-u2', 'sem-1', 'Law of Contract', '📚', 'Unit 2', 'Capacity & Vitiating Factors', 'https://docs.google.com/document/d/1oDtKBEhHIsRLpSHJ0Fzjaw-gNm3XcaGAgs9Ai44GUoY/edit?usp=drivesdk', 'TRUE', 1],
      ['subj-constitutional-u1', 'sem-1', 'Constitutional Law-I', '🏛️', 'Unit 1', 'History, Features, Preamble, Union & Citizenship', 'https://docs.google.com/document/d/1-lqUiuB7JFcs7rtbbZB8b4WErrZRvcLcBgYII2rTkPo/edit?usp=drivesdk', 'TRUE', 2],
      ['subj-tort-u1', 'sem-1', 'Law of Tort', '⚖️', 'Unit 1', 'Nature, Foundations & General Defences', 'https://docs.google.com/document/d/1RRslQDTYur39p_pIRcZEBtyDcPFaV7O9TtnGExsIiNg/edit?usp=drivesdk', 'TRUE', 3],
      ['subj-crimes-u1', 'sem-1', 'Law of Crimes-I', '📜', 'Unit 1', 'Concept, Mens Rea & General Defences', 'https://docs.google.com/document/d/1pSOeViHRZSM626YRChM6NVvYaFK3iPj-dvxcyeggnys/edit?usp=drivesdk', 'TRUE', 4],
      ['subj-jurisprudence-u1', 'sem-1', 'Jurisprudence', '📖', 'Unit 1', 'Schools of Jurisprudence', 'https://docs.google.com/document/d/1Ouxw2OGiln9yB-cHZYTaniDe7CAOUfITHY_KTunzAaA/edit?usp=drivesdk', 'TRUE', 5]
    ]);
  }

  if (sheetIsEmpty('case_laws')) {
    seedRows('case_laws', [
      ['case-demo-1', 'DEMO — Example Case Entry (Placeholder)', 'Not provided — demo only', 'Not specified — demo only', '', 'Demo', 'This is a placeholder entry only. Replace it with a real case entered by the administrator. No facts, citation, or judgment are claimed here.', 'Not provided — demo only', 'Not provided — demo only', 'Not provided — demo only', 'Demo only — do not use for study or exams.', MAIN_DRIVE_FOLDER, 'FALSE', 'Demo']
    ]);
  }

  if (sheetIsEmpty('papers')) {
    seedRows('papers', [
      ['papers-demo-1', 'DEMO — Example Year Collection (Placeholder)', '', '', 'Demo', 'Not specified — demo only', MAIN_DRIVE_FOLDER, 'Demo']
    ]);
  }

  if (sheetIsEmpty('exam_prep')) {
    var cards = [
      ['Important Questions', 'Configured exam-preparation resource.'],
      ['Short Notes', 'Configured exam-preparation resource.'],
      ['Bare Acts', 'Configured exam-preparation resource.'],
      ['MCQs Practice', 'Configured exam-preparation resource.'],
      ['Revision Notes', 'Configured exam-preparation resource.'],
      ['Study Plan', 'Configured exam-preparation resource.']
    ];
    seedRows('exam_prep', cards.map(function (c, i) {
      return ['exam-' + (i + 1), c[0], c[0], c[1], MAIN_DRIVE_FOLDER, 'TRUE', i + 1];
    }));
  }

  if (sheetIsEmpty('pending')) {
    seedRows('pending', [
      ['pending-demo-1', 'DEMO — Example Pending Entry (Placeholder)', 'Placeholder entry only. This material has not been verified and must not be treated as official or approved.', MAIN_DRIVE_FOLDER, 'Demo', 'Placeholder entry only.', '']
    ]);
  }

  if (sheetIsEmpty('contacts')) {
    var contacts = [
      ['Message Admin', 'message'],
      ['Send Feedback', 'feedback'],
      ['Report Broken Link', 'broken-link'],
      ['Report Incorrect Content', 'incorrect'],
      ['Suggest a Resource', 'suggest'],
      ['Join Class Community', 'community']
    ];
    seedRows('contacts', contacts.map(function (c, i) {
      return ['contact-' + (i + 1), c[0], c[1], '', 'FALSE', i + 1];
    }));
  }

  return 'LawVault sheets are set up.';
}

/* ------------------------------------------------------------------ */
/* Activity log                                                       */
/* ------------------------------------------------------------------ */

function logActivity(admin, action, module, detail, result) {
  try {
    var sheet = ensureHeaders('activity_log');
    sheet.appendRow([nowIso(), admin || '(none)', action, module, detail || '', result || '']);
  } catch (e) { /* logging must never break the write itself */ }
}

/* ------------------------------------------------------------------ */
/* Writes                                                             */
/* ------------------------------------------------------------------ */

function validateRow(tab, obj) {
  var required = REQUIRED[tab] || [];
  for (var i = 0; i < required.length; i++) {
    var v = obj[required[i]];
    if (v === undefined || v === null || String(v).trim() === '') {
      return 'Missing required field: ' + required[i];
    }
  }
  ['drive_link', 'destination'].forEach(function (field) {
    if (obj[field] !== undefined && obj[field] !== null && String(obj[field]).trim() !== '') {
      if (!isHttps(obj[field])) throw new Error('Field ' + field + ' must be an https:// link.');
    }
  });
  return null;
}

function doAdd(tab, obj) {
  var headers = SHEETS[tab];
  var sheet = ensureHeaders(tab);
  var err = validateRow(tab, obj);
  if (err) return { ok: false, error: err };
  if (!obj.id) obj.id = newId(tab.replace(/_/g, '-'));
  if (headers.indexOf('created_at') !== -1 && !obj.created_at) obj.created_at = nowIso();
  if (headers.indexOf('updated_at') !== -1) obj.updated_at = nowIso();
  if (findRowIndex(sheet, obj.id) !== -1) {
    return { ok: false, error: 'An entry with this id already exists: ' + obj.id };
  }
  sheet.appendRow(objectToRow(headers, obj));
  return { ok: true, id: obj.id };
}

function doUpdate(tab, obj) {
  var headers = SHEETS[tab];
  var sheet = ensureHeaders(tab);
  if (!obj.id) return { ok: false, error: 'Missing id.' };
  var rowIndex = findRowIndex(sheet, obj.id);
  if (rowIndex === -1) return { ok: false, error: 'Entry not found: ' + obj.id };
  var current = rowToObject(headers, sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0]);
  var merged = {};
  headers.forEach(function (h) {
    merged[h] = (obj[h] !== undefined && obj[h] !== null) ? obj[h] : current[h];
  });
  var err = validateRow(tab, merged);
  if (err) return { ok: false, error: err };
  if (headers.indexOf('updated_at') !== -1) merged.updated_at = nowIso();
  sheet.getRange(rowIndex, 1, 1, headers.length).setValues([objectToRow(headers, merged)]);
  return { ok: true, id: obj.id };
}

function doDelete(tab, obj) {
  var sheet = ensureHeaders(tab);
  if (!obj.id) return { ok: false, error: 'Missing id.' };
  var rowIndex = findRowIndex(sheet, obj.id);
  if (rowIndex === -1) return { ok: false, error: 'Entry not found: ' + obj.id };
  sheet.deleteRow(rowIndex);
  return { ok: true, id: obj.id };
}

/* Settings are key/value rows: "add" with an existing key updates it. */
function doSetSetting(obj) {
  var sheet = ensureHeaders('settings');
  var key = String(obj.key || '').trim();
  if (!key) return { ok: false, error: 'Missing required field: key' };
  var last = sheet.getLastRow();
  if (last >= 2) {
    var keys = sheet.getRange(2, 1, last - 1, 1).getValues();
    for (var i = 0; i < keys.length; i++) {
      if (String(keys[i][0]) === key) {
        sheet.getRange(i + 2, 2, 1, 1).setValue(obj.value === undefined ? '' : obj.value);
        return { ok: true, id: key };
      }
    }
  }
  sheet.appendRow([key, obj.value === undefined ? '' : obj.value]);
  return { ok: true, id: key };
}

function handleAction(body) {
  var action = String(body.action || '');
  var tab = String(body.tab || '');
  if (action === 'ping') return { ok: true };
  if (!SHEETS[tab] || tab === 'activity_log') {
    return { ok: false, error: 'Unknown or read-only tab: ' + tab };
  }
  var obj = body.row || {};
  try {
    if (action === 'add') {
      if (tab === 'settings') return doSetSetting(obj);
      return doAdd(tab, obj);
    }
    if (action === 'update') {
      if (tab === 'settings') return doSetSetting(obj);
      return doUpdate(tab, obj);
    }
    if (action === 'delete') {
      if (tab === 'settings') return { ok: false, error: 'Settings rows cannot be deleted from the panel.' };
      return doDelete(tab, obj);
    }
    return { ok: false, error: 'Unknown action: ' + action };
  } catch (e) {
    return { ok: false, error: e.message || 'Write failed.' };
  }
}

/* ------------------------------------------------------------------ */
/* Web app entry points                                               */
/* ------------------------------------------------------------------ */

function jsonOutput(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var body = {};
  try {
    var raw = (e.postData && e.postData.contents) || '';
    body = raw ? JSON.parse(raw) : (e.parameter || {});
  } catch (err) {
    return jsonOutput({ ok: false, error: 'Invalid request body.' });
  }
  var admin = body.code ? String(body.code) : '(none)';
  if (!verifyCredentials(body.code, body.pass)) {
    logActivity(admin, String(body.action || 'write'), String(body.tab || ''), 'Authentication failed.', 'failed');
    return jsonOutput({ ok: false, error: 'Invalid administrative code or password.' });
  }
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (err) {
    return jsonOutput({ ok: false, error: 'The Sheet is busy. Please try again.' });
  }
  try {
    var result = handleAction(body);
    logActivity(
      admin,
      String(body.action || ''),
      String(body.tab || ''),
      result.ok
        ? 'id: ' + ((body.row && body.row.id) || (body.row && body.row.key) || '')
        : (result.error || 'failed'),
      result.ok ? 'ok' : 'failed'
    );
    return jsonOutput(result);
  } finally {
    lock.releaseLock();
  }
}

/* GET is used only for the login check (JSONP, so the static admin
   page can read the answer without CORS). Writes always use POST. */
function doGet(e) {
  var params = (e && e.parameter) || {};
  var callback = String(params.callback || '');
  var safeCallback = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(callback) ? callback : '';
  if (params.action === 'ping' && safeCallback) {
    var ok = verifyCredentials(params.code, params.pass);
    logActivity(
      params.code ? String(params.code) : '(none)',
      'ping', '', ok ? 'Login check.' : 'Authentication failed.', ok ? 'ok' : 'failed'
    );
    return ContentService
      .createTextOutput(safeCallback + '(' + JSON.stringify({ ok: ok }) + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput('LawVault admin API is running.');
}
