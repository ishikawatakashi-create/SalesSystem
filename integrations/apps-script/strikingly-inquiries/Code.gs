/**
 * SalesSystem Phase 11 — Strikingly 問い合わせ取込 (Apps Script)
 *
 * 重要:
 * - Script Properties に secret を置く（このファイルへ直書きしない）
 * - Gmail の既読化・削除・label 変更・archive は一切しない（read-only 動作）
 * - 問い合わせ本文・メールアドレス・電話・secret を Logger に出さない
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
 * Gmail 専用 label のメッセージを取得し SalesSystem へ POST。
 * installable time-driven trigger から呼ばれる。
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

  // label 存在確認後のみ検索。全メール走査はしない。
  var query =
    'label:"' + props.label.replace(/"/g, "") + '" ' + SEARCH_WINDOW;
  var threads = GmailApp.search(query, 0, 50);

  var processed = 0;
  var success = 0;
  var duplicate = 0;
  var failed = 0;

  for (var i = 0; i < threads.length; i++) {
    var messages = threads[i].getMessages();
    for (var j = 0; j < messages.length; j++) {
      var msg = messages[j];
      processed++;
      var payload = {
        source: "strikingly_email",
        gmail_message_id: msg.getId(),
        gmail_thread_id: msg.getThread().getId(),
        received_at: msg.getDate().toISOString(),
        from: msg.getFrom() || null,
        reply_to: msg.getReplyTo() || null,
        subject: msg.getSubject() || null,
        plain_body: msg.getPlainBody() || null,
      };

      try {
        var res = postJson_(payload);
        if (res.code >= 200 && res.code < 300) {
          if (res.body.indexOf('"duplicate"') !== -1) {
            duplicate++;
          } else {
            success++;
          }
        } else if (res.code === 400) {
          // validation — 無限再送回避のためカウントのみ（次回も送るが server dedupe）
          failed++;
        } else {
          // 429/5xx — 次回 trigger で再送
          failed++;
        }
      } catch (e) {
        failed++;
      }
    }
  }

  // 個人情報なしの集計ログのみ
  Logger.log(
    "processed=" +
      processed +
      " success=" +
      success +
      " duplicate=" +
      duplicate +
      " failed=" +
      failed,
  );

  // poll ごとに heartbeat（本文なし）
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

  Logger.log(
    JSON.stringify({
      endpoint_set: !!props.endpoint,
      endpoint_looks_https:
        props.endpoint.indexOf("https://") === 0,
      secret_set: !!props.secret,
      secret_length_ok: props.secret.length >= 16,
      label_name: props.label,
      label_exists: !!label,
      trigger_exists: hasTrigger,
      search_window: SEARCH_WINDOW,
    }),
  );
}
