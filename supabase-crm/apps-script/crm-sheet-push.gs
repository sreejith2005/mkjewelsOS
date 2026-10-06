/**
 * MK Jewels: ONE-WAY sync, Google Sheets -> CRM project (Supabase). Read-only on the Sheets.
 * Owner decision 2026-10-06: the Sheets are the production record; until two-way sync is
 * approved, data flows Sheet -> CRM only. Design: https://claude.ai/artifact/MBHPPoH1pRbPJF9jExCL2D
 *
 * Install in a NEW, separate Apps Script project (script.google.com > New project), not in
 * MK JEWELS CRM SYSTEM, together with appsscript.json from this folder. That manifest gives the
 * project read-only access to Sheets: Google refuses any write, so this script can never change
 * a Sheet. It keeps no state in the Sheets either: it asks the CRM which rows it already has.
 *
 * Script Properties (Project settings > Script properties). Never paste values into chat:
 *   MK_CRM_SHEET_SYNC_URL   https://<crm-project-ref>.supabase.co/functions/v1/crm-sheet-sync
 *   MK_CRM_SHEET_SYNC_KEY   the same value as the CRM project's CRM_SHEET_SYNC_KEY secret
 *   MK_CRM_FILE_ID          the CRM file (CLIENT DATABASE MASTER)            = Code.gs CRM_SPREADSHEET_ID
 *   MK_WALKIN_FILE_ID       the walk-in file (WALKIN DATASET, REFERRALS)     = the effective walk-in source
 *   MK_REFERRALS_FILE_ID    REFERENCES GIVEN BY CLIENT (REFERRALS CALLING MASTER, REFERRALS HISTORY)
 *
 * Owner steps: crmspDryRun (repeat until "dry run complete") -> crmspImport (repeat until
 * "import complete") -> crmspInstall (every 5 minutes). crmspStop removes the trigger.
 * Logs carry counts only, never names or phones.
 */

var CRMSP = {
  // Order matters: clients before the rows that point at them.
  TABS: ['CLIENT DATABASE MASTER', 'FAMILY DATA', 'WALKIN DATASET', 'REFERRALS', 'REFERRALS CALLING MASTER', 'REFERRALS HISTORY'],
  BATCH: 200,
  BUDGET_MS: 4.5 * 60 * 1000,
  TZ: 'Asia/Kolkata',
  WALKIN_MIN_COLS: 136,
  REFERENCE_COL: 129,         // DY, as Code.gs SOURCE_REFERENCE_COL
  LEGACY_REFERENCE_COLS: [123], // DS, as Code.gs SOURCE_LEGACY_REFERENCE_COLS
  REFERENCE_HEADERS: ['REFERENCE NUMBER', 'REFERENCE_NO', 'REFERENCE', 'REF NO', 'REF NUMBER'],
  PROP_RUN: 'CRMSP_RUN_'
};

/* ------------------------------------------------------------------ */
/* Pure helpers (no Google services; tested by crm-sheet-push.test.ts) */
/* ------------------------------------------------------------------ */

/** A cell as the CRM compares it: dates as yyyy-MM-dd (or with HH:mm:ss), text trimmed. */
function crmspCell_(value, formatDate) {
  if (value === null || value === undefined) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value)) return '';
    var full = formatDate(value, 'yyyy-MM-dd HH:mm:ss');
    return /00:00:00$/.test(full) ? full.slice(0, 10) : full;
  }
  if (typeof value === 'number') return isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value).trim().slice(0, 5000);
}

/** Code.gs cleanHeader_. */
function crmspCleanHeader_(value) {
  return String(value || '').trim().replace(/[\r\n]+/g, ' ').replace(/\*/g, '').replace(/\s+/g, ' ').toUpperCase();
}

/** header -> value; a repeated header keeps its first non-empty value (Code.gs rowToHeaderMap_). */
function crmspRowValues_(headers, raw, formatDate) {
  var out = {};
  for (var i = 0; i < headers.length; i++) {
    var h = headers[i];
    if (!h) continue;
    var v = crmspCell_(raw[i], formatDate);
    if (!Object.prototype.hasOwnProperty.call(out, h) || (out[h] === '' && v !== '')) out[h] = v;
  }
  return out;
}

/** The text the fingerprint is taken over: every header in order with its value. */
function crmspHashInput_(headers, values) {
  var seen = {};
  var parts = [];
  for (var i = 0; i < headers.length; i++) {
    var h = headers[i];
    if (!h || seen[h]) continue;
    seen[h] = true;
    parts.push([h, values[h] || '']);
  }
  return JSON.stringify(parts);
}

function crmspHex_(bytes) {
  return bytes.map(function (b) { var v = (b < 0 ? b + 256 : b).toString(16); return v.length === 1 ? '0' + v : v; }).join('');
}

/** Code.gs referralKey_, the key the Sheet itself gives a referral. */
function crmspReferralKey_(name, number, givenBy) {
  function clean(v) { return String(v || '').trim().replace(/\s+/g, ' '); }
  var digits = String(number || '').replace(/\D/g, '');
  var phone = digits ? digits.slice(-10) : '';
  var n = clean(name).toUpperCase().replace(/[^A-Z0-9]/g, '');
  var by = clean(givenBy).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
  return (phone || n || 'REF') + '|' + n + '|' + by;
}

/**
 * Code.gs getReferenceNumberFromWalkinRow_: column DY (129), then DS (123), then a REFERENCE
 * NUMBER header, then an MK reference anywhere in the row, else AUTO-WALKIN-ROW-<row>.
 */
function crmspWalkinReference_(raw, headers, rowNumber, formatDate) {
  function text(v) { return crmspCell_(v, formatDate).toUpperCase(); }
  var dy = text(raw[CRMSP.REFERENCE_COL - 1]);
  if (dy) return dy;
  for (var i = 0; i < CRMSP.LEGACY_REFERENCE_COLS.length; i++) {
    var legacy = text(raw[CRMSP.LEGACY_REFERENCE_COLS[i] - 1]);
    if (legacy) return legacy;
  }
  var values = crmspRowValues_(headers, raw, formatDate);
  for (var h = 0; h < CRMSP.REFERENCE_HEADERS.length; h++) {
    var byHeader = String(values[CRMSP.REFERENCE_HEADERS[h]] || '').trim().toUpperCase();
    if (Object.prototype.hasOwnProperty.call(values, CRMSP.REFERENCE_HEADERS[h])) { if (byHeader) return byHeader; break; }
  }
  for (var c = 0; c < raw.length; c++) {
    var cell = crmspCell_(raw[c], formatDate);
    if (!cell) continue;
    var m = cell.toUpperCase().match(/\bMK[-_ ]?(?:NWK|WK|WALKIN|WALK|CRM)?[-_ ]?[A-Z0-9-]{3,}\b/);
    if (m && m[0]) return m[0].replace(/\s+/g, '-').replace(/_/g, '-');
  }
  return rowNumber ? 'AUTO-WALKIN-ROW-' + rowNumber : '';
}

/** Keys for WALKIN DATASET rows: the first row keeps a reference, later rows get -R<row>. */
function crmspWalkinKeys_(refs, rowNumbers) {
  var seen = {};
  return refs.map(function (ref, i) {
    var r = String(ref || '').trim().toUpperCase();
    if (!r) return '';
    if (seen[r]) return r + '-R' + rowNumbers[i];
    seen[r] = true;
    return r;
  });
}

function crmspAdd_(counts, name, n) { counts[name] = (counts[name] || 0) + (n === undefined ? 1 : n); }

/* ------------------------------------------------------------------ */
/* Google services (reading only)                                      */
/* ------------------------------------------------------------------ */

function crmspFormatDate_(d, pattern) { return Utilities.formatDate(d, CRMSP.TZ, pattern); }

function crmspSha_(text) {
  return crmspHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8));
}

function crmspConfig_() {
  var props = PropertiesService.getScriptProperties();
  var c = {
    url: props.getProperty('MK_CRM_SHEET_SYNC_URL'),
    key: props.getProperty('MK_CRM_SHEET_SYNC_KEY'),
    crmFile: props.getProperty('MK_CRM_FILE_ID'),
    walkinFile: props.getProperty('MK_WALKIN_FILE_ID'),
    referralsFile: props.getProperty('MK_REFERRALS_FILE_ID'),
    props: props
  };
  ['url', 'key', 'crmFile', 'walkinFile', 'referralsFile'].forEach(function (k) {
    if (!c[k]) throw new Error('Set all five script properties first (see the top of this file).');
  });
  return c;
}

/** One call to the CRM. Errors carry the HTTP status and the CRM's code only. */
function crmspPost_(config, body) {
  var response = UrlFetchApp.fetch(config.url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-mk-sheet-sync-key': config.key },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  var json = {};
  try { json = JSON.parse(response.getContentText()); } catch (e) {}
  if (response.getResponseCode() !== 200 || !json.ok) {
    var code = /^[A-Z_]{1,40}$/.test(String(json.code)) ? json.code : 'UNKNOWN';
    throw new Error('CRM sync call failed: HTTP ' + response.getResponseCode() + ' ' + code);
  }
  return json;
}

function crmspSheetFor_(config, tab) {
  function open(id, name) { var sh = SpreadsheetApp.openById(id).getSheetByName(name); return sh || null; }
  switch (tab) {
    case 'CLIENT DATABASE MASTER': return open(config.crmFile, 'CLIENT DATABASE MASTER');
    case 'WALKIN DATASET': return open(config.walkinFile, 'WALKIN DATASET');
    case 'FAMILY DATA': return open(config.walkinFile, 'FAMILY DATA') || open(config.crmFile, 'FAMILY DATA');
    case 'REFERRALS': return open(config.walkinFile, 'REFERRALS');
    case 'REFERRALS CALLING MASTER': return open(config.referralsFile, 'REFERRALS CALLING MASTER');
    case 'REFERRALS HISTORY': return open(config.referralsFile, 'REFERRALS HISTORY');
  }
  return null;
}

/** Reads a tab: every row's values, key and fingerprint. Reads only. */
function crmspReadTab_(config, tab) {
  var sh = crmspSheetFor_(config, tab);
  if (!sh) return null;
  var lastRow = sh.getLastRow();
  var lastCol = Math.max(sh.getLastColumn(), tab === 'WALKIN DATASET' ? CRMSP.WALKIN_MIN_COLS : 1);
  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(crmspCleanHeader_);
  var raws = lastRow >= 2 ? sh.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];
  var rows = [];
  var walkinRefs = [];
  var walkinRows = [];

  raws.forEach(function (raw, i) {
    var rowNumber = i + 2;
    if (!raw.some(function (v) { return String(v === null || v === undefined ? '' : v).trim() !== ''; })) return;
    var values = crmspRowValues_(headers, raw, crmspFormatDate_);
    var key = '';
    if (tab === 'CLIENT DATABASE MASTER' || tab === 'FAMILY DATA') {
      key = String(values['CLIENT ID'] || '').trim().toUpperCase();
    } else if (tab === 'WALKIN DATASET') {
      if (String(values['VISIT FINAL STATUS'] || '').trim().toUpperCase() === 'DRAFT') return;
      walkinRefs.push(crmspWalkinReference_(raw, headers, rowNumber, crmspFormatDate_));
      walkinRows.push(rowNumber);
    } else if (tab === 'REFERRALS') {
      if (!values['REFERRAL NAME'] && !values['REFERRAL NUMBER']) return;
      key = 'RK-' + crmspSha_(crmspReferralKey_(values['REFERRAL NAME'], values['REFERRAL NUMBER'], values['REFERENCE GIVEN BY CLIENT NAME'])).slice(0, 24).toUpperCase();
    } else if (tab === 'REFERRALS CALLING MASTER') {
      if (!values['REFERRAL KEY']) return;
      key = 'RK-' + crmspSha_(String(values['REFERRAL KEY']).trim()).slice(0, 24).toUpperCase();
    } else if (tab === 'REFERRALS HISTORY') {
      if (!values['REFERRAL KEY']) return;
      key = 'RH-' + crmspSha_(String(values['REFERRAL KEY']).trim() + '|' + values['TIMESTAMP'] + '|' + String(values['NEW STATUS'] || '').trim().toUpperCase()).slice(0, 24).toUpperCase();
    }
    rows.push({ values: values, key: key });
  });

  if (tab === 'WALKIN DATASET') {
    var keys = crmspWalkinKeys_(walkinRefs, walkinRows);
    rows.forEach(function (r, i) { r.key = keys[i]; });
  }
  rows.forEach(function (r) { r.hash = crmspSha_(crmspHashInput_(headers, r.values)).slice(0, 32); });
  return rows.filter(function (r) { return r.key; });
}

/* ------------------------------------------------------------------ */
/* Runs                                                                */
/* ------------------------------------------------------------------ */

function crmspRun_(mode) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { console.log('CRM sheet push: another run is going; skipped.'); return; }
  try {
    var config = crmspConfig_();
    var props = config.props;
    var started = Date.now();
    var dryRun = mode === 'dry_run';
    var runProp = CRMSP.PROP_RUN + mode;
    var saved = props.getProperty(runProp);
    // A dry run writes nothing in the CRM, so it remembers where it stopped (tab, row).
    var run = saved ? JSON.parse(saved) : { id: crmspPost_(config, { action: 'run_start', mode: mode }).run_id, tab: 0, offset: 0, counts: {} };

    for (var t = run.tab; t < CRMSP.TABS.length; t++) {
      var tab = CRMSP.TABS[t];
      var rows = crmspReadTab_(config, tab);
      if (!rows) { run.counts[tab + ': tab_missing'] = 1; run.offset = 0; continue; }
      var todo = rows;
      if (!dryRun) {
        var known = crmspPost_(config, { action: 'hashes', tab: tab }).hashes || {};
        todo = rows.filter(function (r) { return known[r.key] !== r.hash; });
      }
      for (var i = dryRun ? run.offset : 0; i < todo.length; i += CRMSP.BATCH) {
        if (Date.now() - started > CRMSP.BUDGET_MS) {
          run.tab = t; run.offset = i;
          props.setProperty(runProp, JSON.stringify(run));
          console.log('CRM sheet push ' + mode + ' paused (time limit); run it again to continue: ' + JSON.stringify(run.counts));
          return;
        }
        var res = crmspPost_(config, {
          action: 'push', run_id: run.id, tab: tab, dry_run: dryRun,
          rows: todo.slice(i, i + CRMSP.BATCH).map(function (r) { return { key: r.key, hash: r.hash, values: r.values }; })
        });
        Object.keys(res.counts || {}).forEach(function (k) { crmspAdd_(run.counts, tab + ': ' + k, res.counts[k]); });
      }
      run.offset = 0;
    }

    var done = crmspPost_(config, { action: 'run_finish', run_id: run.id, status: 'finished' });
    props.deleteProperty(runProp);
    if (done.crm_only !== undefined) run.counts['CRM clients not in the Sheet'] = done.crm_only;
    if (mode === 'live') {
      if (Object.keys(run.counts).length) console.log('CRM sheet push: ' + JSON.stringify(run.counts));
    } else {
      console.log('CRM sheet push ' + (dryRun ? 'dry run' : 'import') + ' complete: ' + JSON.stringify(run.counts));
    }
  } finally {
    lock.releaseLock();
  }
}

/** Step 1: counts only; nothing is written anywhere. Run again until "dry run complete". */
function crmspDryRun() { crmspRun_('dry_run'); }

/** Step 2: the one-time import. Run again until "import complete". Re-running is harmless. */
function crmspImport() { crmspRun_('import'); }

/** The 5-minute trigger: sends rows that are new or changed since the CRM last saw them. */
function crmspSync() {
  if (PropertiesService.getScriptProperties().getProperty(CRMSP.PROP_RUN + 'import')) {
    console.log('CRM sheet push: finish crmspImport() first.');
    return;
  }
  crmspRun_('live');
}

/** Step 3: run crmspSync every 5 minutes. */
function crmspInstall() {
  crmspStop();
  ScriptApp.newTrigger('crmspSync').timeBased().everyMinutes(5).create();
}

/** Removes the 5-minute trigger. */
function crmspStop() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'crmspSync') ScriptApp.deleteTrigger(t);
  });
}
