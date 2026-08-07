/**
 * SalesSystem Phase 11 — Strikingly 問い合わせ取込 (Apps Script)
 *
 * 重要:
 * - Script Properties に secret を置く（このファイルへ直書きしない）
 * - Gmail の既読化・削除・label 変更・archive は一切しない（read-only 動作）
 * - 問い合わせ本文・メールアドレス・電話・secret を Logger に出さない
 * - backfill は自動開始しない。人間が backfillStrikinglyInquiries() を実行したときだけ
 *
 * 必要な Script Properties:
 * - SALES_SYSTEM_ENDPOINT  … https://.../api/integrations/inquiries/apps-script
 * - SALES_SYSTEM_INGEST_SECRET … SalesSystem の INQUIRY_APPS_SCRIPT_SECRET と同じ値
 * - GMAIL_LABEL（任意）… 既定 "SalesSystem/お問い合わせ"
 */

var DEFAULT_LABEL = "SalesSystem/お問い合わせ";
var SEARCH_WINDOW = "newer_than:2d";
var TRIGGER_HANDLER = "syncStrikinglyInquiries";
var TRIGGER_MINUTES = 5;
var BACKFILL_PROP = "BACKFILL_PROGRESS";
/** 1 実行あたりの最大処理 message 数（Apps Script 実行時間制限対策） */
var BACKFILL_CHUNK_MESSAGES = 40;
/** GmailApp.search の 1 ページ thread 数 */
var BACKFILL_THREAD_PAGE = 20;

function getProps_() {
  var p = PropertiesService.getScriptProperties();
  return {
    endpoint: (p.getProperty("SALES_SYSTEM_ENDPOINT") || "").trim(),
    secret: (p.getProperty("SALES_SYSTEM_INGEST_SECRET") || "").trim(),
    label: (p.getProperty("GMAIL_LABEL") || DEFAULT_LABEL).trim(),
  };
}

function toHex_(bytes) {
  return bytes
    .map(function (b) {
      var v = b < 0 ? b + 256 : b;
      return ("0" + v.toString(16)).slice(-2);
    })
    .join("");
}

function signRequest_(timestamp, rawBody, secret) {
  var sig = Utilities.computeHmacSha256Signature(
    timestamp + "." + rawBody,
    secret,
  );
  return toHex_(sig);
}

function postJson_(payload) {
  var props = getProps_();
  if (!props.endpoint || !props.secret) {
    throw new Error("missing_script_properties");
  }
  var rawBody = JSON.stringify(payload);
  var timestamp = String(Date.now());
  var signature = signRequest_(timestamp, rawBody, props.secret);
  var res = UrlFetchApp.fetch(props.endpoint, {
    method: "post",
    contentType: "application/json",
    payload: rawBody,
    headers: {
      "X-SalesSystem-Timestamp": timestamp,
      "X-SalesSystem-Signature": signature,
    },
    muteHttpExceptions: true,
  });
  return {
    code: res.getResponseCode(),
    body: res.getContentText() || "",
  };
}

/**
 * Apps Script 側の軽い候補判定（最終判定は server parser）。
 * From 単独へ過度依存しない。
 */
function isStrikinglyCandidate_(subject, from, body) {
  var s = String(subject || "");
  var f = String(from || "");
  var b = String(body || "");
  var blob = (s + "\n" + f + "\n" + b).toLowerCase();
  if (blob.indexOf("あなたのサイトにコメントしました") !== -1) return true;
  if (blob.indexOf("サイトにコメントしました") !== -1) return true;
  if (blob.indexOf("strikingly") !== -1) return true;
  if (/new\s+(contact\s+)?form\s+submission/i.test(s)) return true;
  if (/新しい.*フォーム|お問い合わせ.*通知|form submission/i.test(s)) {
    return true;
  }
  if (/you received a new submission|フォームから送信/i.test(b)) return true;
  return false;
}

function buildInquiryPayload_(msg, historical) {
  return {
    source: "strikingly_email",
    gmail_message_id: msg.getId(),
    gmail_thread_id: msg.getThread().getId(),
    received_at: msg.getDate().toISOString(),
    from: msg.getFrom() || null,
    reply_to: msg.getReplyTo() || null,
    subject: msg.getSubject() || null,
    plain_body: msg.getPlainBody() || null,
    historical_import: !!historical,
  };
}

function classifyResponse_(code, body) {
  if (code >= 200 && code < 300) {
    if (body.indexOf('"skipped"') !== -1) return "skipped";
    if (body.indexOf('"duplicate"') !== -1) return "duplicate";
    return "accepted";
  }
  if (code === 400) return "failed_validation";
  return "failed_retryable";
}

/**
 * Gmail 専用 label の直近メッセージを取得し SalesSystem へ POST。
 * installable time-driven trigger から呼ばれる（通常運用）。
 */
function syncStrikinglyInquiries() {
  var props = getProps_();
  if (!props.endpoint || !props.secret) {
    Logger.log("status=config_error reason=missing_properties");
    return;
  }

  var label = GmailApp.getUserLabelByName(props.label);
  if (!label) {
    Logger.log("status=stopped reason=label_missing");
    return;
  }

  var query =
    'label:"' + props.label.replace(/"/g, "") + '" ' + SEARCH_WINDOW;
  var threads = GmailApp.search(query, 0, 50);

  var processed = 0;
  var success = 0;
  var duplicate = 0;
  var skipped = 0;
  var failed = 0;

  for (var i = 0; i < threads.length; i++) {
    var messages = threads[i].getMessages();
    for (var j = 0; j < messages.length; j++) {
      var msg = messages[j];
      processed++;
      var subject = msg.getSubject() || "";
      var from = msg.getFrom() || "";
      var body = msg.getPlainBody() || "";
      if (!isStrikinglyCandidate_(subject, from, body)) {
        skipped++;
        continue;
      }

      try {
        var res = postJson_(buildInquiryPayload_(msg, false));
        var kind = classifyResponse_(res.code, res.body);
        if (kind === "accepted") success++;
        else if (kind === "duplicate") duplicate++;
        else if (kind === "skipped") skipped++;
        else failed++;
      } catch (e) {
        failed++;
      }
    }
  }

  Logger.log(
    "mode=poll processed=" +
      processed +
      " success=" +
      success +
      " duplicate=" +
      duplicate +
      " skipped=" +
      skipped +
      " failed=" +
      failed,
  );

  try {
    postJson_({ type: "heartbeat", timestamp: new Date().toISOString() });
  } catch (e2) {
    Logger.log("heartbeat=failed");
  }
}

/** 1日1回でも可。手動実行用 */
function sendHeartbeat() {
  var res = postJson_({
    type: "heartbeat",
    timestamp: new Date().toISOString(),
  });
  Logger.log("heartbeat_http=" + res.code);
}

/**
 * 5分ごとの installable trigger を登録。
 * 同名 handler の既存 trigger は削除してから作り直す。
 * backfill は登録しない。
 */
function setupTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === TRIGGER_HANDLER) {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger(TRIGGER_HANDLER)
    .timeBased()
    .everyMinutes(TRIGGER_MINUTES)
    .create();
  Logger.log("trigger=created everyMinutes=" + TRIGGER_MINUTES);
}

function defaultBackfillProgress_() {
  return {
    status: "running",
    thread_offset: 0,
    processed: 0,
    accepted: 0,
    duplicate: 0,
    skipped: 0,
    failed: 0,
    completed: false,
  };
}

function loadBackfillProgress_() {
  var raw = PropertiesService.getScriptProperties().getProperty(BACKFILL_PROP);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function saveBackfillProgress_(progress) {
  PropertiesService.getScriptProperties().setProperty(
    BACKFILL_PROP,
    JSON.stringify(progress),
  );
}

/**
 * 過去問い合わせ backfill（手動実行のみ。自動開始しない）。
 * 1 回の実行で BACKFILL_CHUNK_MESSAGES 件まで処理し、続きは次回実行で再開。
 */
function backfillStrikinglyInquiries() {
  var props = getProps_();
  if (!props.endpoint || !props.secret) {
    Logger.log("backfill=config_error reason=missing_properties");
    return;
  }

  var label = GmailApp.getUserLabelByName(props.label);
  if (!label) {
    Logger.log("backfill=stopped reason=label_missing");
    return;
  }

  var progress = loadBackfillProgress_() || defaultBackfillProgress_();
  if (progress.completed || progress.status === "completed") {
    Logger.log(
      "backfill=already_completed processed=" +
        progress.processed +
        " accepted=" +
        progress.accepted +
        " duplicate=" +
        progress.duplicate +
        " skipped=" +
        progress.skipped +
        " failed=" +
        progress.failed,
    );
    return;
  }

  progress.status = "running";
  progress.completed = false;

  var query = 'label:"' + props.label.replace(/"/g, "") + '"';
  var threads = GmailApp.search(
    query,
    progress.thread_offset || 0,
    BACKFILL_THREAD_PAGE,
  );

  if (!threads.length) {
    progress.status = "completed";
    progress.completed = true;
    saveBackfillProgress_(progress);
    Logger.log(
      "backfill=completed processed=" +
        progress.processed +
        " accepted=" +
        progress.accepted +
        " duplicate=" +
        progress.duplicate +
        " skipped=" +
        progress.skipped +
        " failed=" +
        progress.failed,
    );
    return;
  }

  var messagesThisRun = 0;
  var stopEarly = false;
  var threadsFullyHandled = 0;

  for (var i = 0; i < threads.length; i++) {
    if (stopEarly) break;
    var messages = threads[i].getMessages();
    var threadOk = true;
    for (var j = 0; j < messages.length; j++) {
      if (messagesThisRun >= BACKFILL_CHUNK_MESSAGES) {
        stopEarly = true;
        threadOk = false;
        break;
      }
      var msg = messages[j];
      messagesThisRun++;
      progress.processed = (progress.processed || 0) + 1;

      var subject = msg.getSubject() || "";
      var from = msg.getFrom() || "";
      var body = msg.getPlainBody() || "";
      if (!isStrikinglyCandidate_(subject, from, body)) {
        progress.skipped = (progress.skipped || 0) + 1;
        continue;
      }

      try {
        var res = postJson_(buildInquiryPayload_(msg, true));
        var kind = classifyResponse_(res.code, res.body);
        if (kind === "accepted") {
          progress.accepted = (progress.accepted || 0) + 1;
        } else if (kind === "duplicate") {
          progress.duplicate = (progress.duplicate || 0) + 1;
        } else if (kind === "skipped") {
          progress.skipped = (progress.skipped || 0) + 1;
        } else if (kind === "failed_retryable") {
          // 429/5xx: この thread から次回再試行（offset を進めない）
          progress.failed = (progress.failed || 0) + 1;
          threadOk = false;
          stopEarly = true;
          break;
        } else {
          progress.failed = (progress.failed || 0) + 1;
        }
      } catch (e) {
        progress.failed = (progress.failed || 0) + 1;
        threadOk = false;
        stopEarly = true;
        break;
      }
    }
    if (threadOk) {
      threadsFullyHandled++;
    } else {
      break;
    }
  }

  progress.thread_offset =
    (progress.thread_offset || 0) + threadsFullyHandled;

  if (!stopEarly && threads.length < BACKFILL_THREAD_PAGE) {
    progress.status = "completed";
    progress.completed = true;
  } else {
    progress.status = "running";
    progress.completed = false;
  }

  saveBackfillProgress_(progress);

  Logger.log(
    "backfill=" +
      progress.status +
      " chunk_messages=" +
      messagesThisRun +
      " thread_offset=" +
      progress.thread_offset +
      " processed=" +
      progress.processed +
      " accepted=" +
      progress.accepted +
      " duplicate=" +
      progress.duplicate +
      " skipped=" +
      progress.skipped +
      " failed=" +
      progress.failed +
      " completed=" +
      progress.completed,
  );
}

/** progress 確認（PII なし） */
function getBackfillStatus() {
  var progress = loadBackfillProgress_();
  if (!progress) {
    Logger.log('backfill_status={"status":"idle","completed":false}');
    return;
  }
  Logger.log(
    "backfill_status=" +
      JSON.stringify({
        status: progress.status,
        processed: progress.processed || 0,
        accepted: progress.accepted || 0,
        duplicate: progress.duplicate || 0,
        skipped: progress.skipped || 0,
        failed: progress.failed || 0,
        completed: !!progress.completed,
        thread_offset: progress.thread_offset || 0,
      }),
  );
}

/** 完了後に再 backfill する場合のみ。通常は不要 */
function resetBackfillProgress() {
  PropertiesService.getScriptProperties().deleteProperty(BACKFILL_PROP);
  Logger.log("backfill=reset");
}

/**
 * 設定確認（secret 値は表示しない）
 */
function checkConfiguration() {
  var props = getProps_();
  var label = props.label
    ? GmailApp.getUserLabelByName(props.label)
    : null;
  var hasTrigger = false;
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === TRIGGER_HANDLER) {
      hasTrigger = true;
      break;
    }
  }
  var bf = loadBackfillProgress_();

  Logger.log(
    JSON.stringify({
      endpoint_set: !!props.endpoint,
      endpoint_looks_https: props.endpoint.indexOf("https://") === 0,
      secret_set: !!props.secret,
      secret_length_ok: props.secret.length >= 16,
      label_name: props.label,
      label_exists: !!label,
      trigger_exists: hasTrigger,
      search_window: SEARCH_WINDOW,
      backfill_status: bf
        ? {
            status: bf.status,
            processed: bf.processed || 0,
            accepted: bf.accepted || 0,
            duplicate: bf.duplicate || 0,
            skipped: bf.skipped || 0,
            failed: bf.failed || 0,
            completed: !!bf.completed,
          }
        : { status: "idle", completed: false },
    }),
  );
}
