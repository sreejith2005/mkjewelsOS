/**
 * MK Jewels walk-in form -> CRM project (Supabase) push and Sheet backfill.
 *
 * Paste this file into the walk-in form's Apps Script project (spreadsheet "01 WALKIN DATA",
 * the project that holds FORM CODE.GS) as a new script file. It uses that project's own
 * helpers and constants: SPREADSHEET_ID, RESPONSES_SHEET, getWalkinHeadersForEdit_,
 * convertWalkinRowToFormData_.
 *
 * Script Properties (Project settings > Script properties). Never paste their values into
 * chat, email or Git:
 *   MK_CRM_INGEST_URL      https://<crm-project-ref>.supabase.co/functions/v1/crm-walkin-ingest
 *   MK_CRM_INGEST_API_KEY  the same value as the CRM project's CRM_LEGACY_WALKIN_INGEST_API_KEY
 *
 * Owner guide: docs/CRM_SHEETS_INGEST_CUTOVER.md.
 */

/**
 * Live push. Call it in submitForm(), in the NEW-entry path, after sh.appendRow(row) and
 * after formDataObj.reference_number is set (see the guide). It never throws, so the Sheet
 * keeps working when the CRM is unreachable. The CRM saves a reference number once: sending
 * the same entry again is answered ALREADY_INGESTED and saves nothing.
 */
function pushWalkinToCrm_(formDataObj) {
  try {
    const props = PropertiesService.getScriptProperties();
    const url = props.getProperty('MK_CRM_INGEST_URL');
    const key = props.getProperty('MK_CRM_INGEST_API_KEY');
    if (!url || !key) return { skipped: true };
    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-mk-legacy-api-key': key },
      // Proof uploads stay in Drive (saveUploads_); the endpoint refuses files.
      payload: JSON.stringify({ formDataObj: formDataObj, filesPayload: [] }),
      muteHttpExceptions: true,
    });
    const status = response.getResponseCode();
    // Log the status and code only: the body can carry ids, never log form values.
    if (status !== 201 && status !== 200) console.error('CRM ingest HTTP ' + status + ' ' + crmCode_(response));
    return { status: status };
  } catch (error) {
    console.error('CRM ingest failed: ' + (error && error.name ? error.name : 'error'));
    return { failed: true };
  }
}

/**
 * Backfill: sends every WALKIN DATASET row submitted on or after MK_CRM_BACKFILL_SINCE
 * (default 2026-08-17, the CRM project's newest visit) through the same endpoint.
 *
 * - Repeatable and idempotent: rows already in the CRM (from this backfill, the live push or
 *   the original import) are answered ALREADY_INGESTED and are not saved again.
 * - Resumable: Apps Script stops a run after 6 minutes, so this run stops itself after about
 *   5, remembers the next row, and the next run continues there. Run it (or a 10-minute
 *   time trigger) until the log says "done".
 * - Rows without a REFERENCE NUMBER are skipped and counted: they cannot be de-duplicated.
 * - Logs counts only.
 * To start over from the first row: resetCrmBackfill().
 */
function backfillWalkinsToCrm() {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('MK_CRM_INGEST_URL');
  const key = props.getProperty('MK_CRM_INGEST_API_KEY');
  if (!url || !key) throw new Error('Set MK_CRM_INGEST_URL and MK_CRM_INGEST_API_KEY first.');
  const since = new Date(props.getProperty('MK_CRM_BACKFILL_SINCE') || '2026-08-17T00:00:00+05:30');

  const sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(RESPONSES_SHEET);
  const lastCol = sh.getLastColumn();
  const lastRow = sh.getLastRow();
  const headers = getWalkinHeadersForEdit_(sh, lastCol);
  const refIdx = headers.indexOf('REFERENCE NUMBER');
  const tsIdx = headers.indexOf('TIMESTAMP');
  if (refIdx < 0 || tsIdx < 0) throw new Error('WALKIN DATASET headers changed: REFERENCE NUMBER or TIMESTAMP not found.');

  // The two key columns are read once; full rows only for rows that are sent.
  const timestamps = sh.getRange(1, tsIdx + 1, lastRow, 1).getValues();
  const references = sh.getRange(1, refIdx + 1, lastRow, 1).getValues();

  const counts = JSON.parse(props.getProperty('MK_CRM_BACKFILL_COUNTS') || '{}');
  const bump = function (name) { counts[name] = (counts[name] || 0) + 1; };
  let row = Number(props.getProperty('MK_CRM_BACKFILL_NEXT_ROW') || 2);
  const started = Date.now();

  while (row <= lastRow) {
    if (Date.now() - started > 5 * 60 * 1000) {
      props.setProperty('MK_CRM_BACKFILL_NEXT_ROW', String(row));
      props.setProperty('MK_CRM_BACKFILL_COUNTS', JSON.stringify(counts));
      console.log('CRM backfill paused at row ' + row + ' of ' + lastRow + ': ' + JSON.stringify(counts));
      return;
    }
    const stamp = timestamps[row - 1][0];
    const submitted = stamp instanceof Date ? stamp : new Date(stamp);
    const reference = String(references[row - 1][0] || '').trim();
    if (isNaN(submitted.getTime()) || submitted < since) { bump('before_since_or_header'); row += 1; continue; }
    if (!reference || reference.toUpperCase() === 'REFERENCE NUMBER') { bump('skipped_no_reference'); row += 1; continue; }
    const values = sh.getRange(row, 1, 1, lastCol).getValues()[0];

    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      // Its own rate-limit budget, so a running backfill never blocks live walk-ins.
      headers: { 'x-mk-legacy-api-key': key, 'x-mk-ingest-mode': 'backfill' },
      payload: JSON.stringify({ formDataObj: convertWalkinRowToFormData_(headers, values), filesPayload: [] }),
      muteHttpExceptions: true,
    });
    const status = response.getResponseCode();
    if (status === 429) { Utilities.sleep(61 * 1000); continue; } // retry the same row
    if (status === 201) bump('ingested');
    else if (status === 200) bump('already_ingested');
    else bump('failed_' + status + '_' + crmCode_(response).toLowerCase());
    row += 1;
    Utilities.sleep(2100); // 30 requests per minute
  }

  props.setProperty('MK_CRM_BACKFILL_NEXT_ROW', String(row));
  props.setProperty('MK_CRM_BACKFILL_COUNTS', JSON.stringify(counts));
  console.log('CRM backfill done through row ' + lastRow + ': ' + JSON.stringify(counts));
}

function resetCrmBackfill() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty('MK_CRM_BACKFILL_NEXT_ROW');
  props.deleteProperty('MK_CRM_BACKFILL_COUNTS');
}

function crmCode_(response) {
  try {
    const code = JSON.parse(response.getContentText()).code;
    return /^[A-Z_]{1,40}$/.test(String(code)) ? String(code) : 'UNKNOWN';
  } catch (error) {
    return 'UNKNOWN';
  }
}
