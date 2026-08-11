import type { HelpFaqItem } from "@/lib/help/types";

/** やりたいことベースの FAQ（社員向け） */
export const HELP_FAQS: HelpFaqItem[] = [
  {
    id: "faq-csv-500",
    category: "sales",
    question: "500社の営業リストをもらいました。どこへ入れますか？",
    answer: [
      "「組織」へ500社登録せず、営業リストを作成してCSVインポートします。",
      "精査前の大量候補は正式組織とは分けて管理します。",
    ],
    keywords: ["CSV", "500", "営業リスト", "どこ"],
    related: ["import-prospect-csv"],
  },
  {
    id: "faq-inquiry-first",
    category: "inquiries",
    question: "Web問い合わせが来ました。最初に何をしますか？",
    answer: [
      "対応 → お問い合わせを開き、担当を決めます（自分を担当にする、または振分け）。",
      "その後、既存組織の有無を確認して紐付けまたは新規作成します。",
    ],
    keywords: ["問い合わせ", "最初", "未確認"],
    related: ["handle-inquiry"],
  },
  {
    id: "faq-inquiry-existing",
    category: "inquiries",
    question: "既存顧客から問い合わせが来ました。どうしますか？",
    answer: [
      "新しい組織を作らず、既存組織候補から紐付けます。",
      "その後、対応履歴として登録し、必要なら返信します。",
    ],
    keywords: ["既存顧客", "紐付け"],
    related: ["inquiry-existing-org"],
  },
  {
    id: "faq-call-30",
    category: "sales",
    question: "今日30件電話したいです。どう操作しますか？",
    answer: [
      "マイデスクの「今日の営業」または架電キューから「架電を開始」します。",
      "電話 → 結果選択 → 「保存して次へ」を繰り返します。自動発信はありません。",
    ],
    keywords: ["電話", "30件", "今日の営業"],
    related: ["call-prospect"],
  },
  {
    id: "faq-absent",
    category: "sales",
    question: "電話したけど担当者がいませんでした。",
    answer: [
      "架電結果「担当者不在」を選びます。",
      "分かれば次回連絡日時も設定してください（推奨）。",
    ],
    keywords: ["担当者不在", "不在"],
    related: ["call-results", "recalls"],
  },
  {
    id: "faq-recall-tomorrow",
    category: "sales",
    question: "明日の15時に再架電したいです。",
    answer: [
      "架電結果を保存するときに「次回連絡」へ明日15:00を入れます。",
      "予定時刻が来ると架電キューやマイデスクの再架電に出ます。",
    ],
    keywords: ["再架電", "明日", "15時"],
    related: ["recalls"],
  },
  {
    id: "faq-materials",
    category: "sales",
    question: "資料送付を頼まれました。",
    answer: [
      "架電結果「資料送付」を選びます。",
      "メールは自動送信されないので、自分で資料を送り、次回フォロー日時も入れてください。",
    ],
    keywords: ["資料送付", "メール"],
    related: ["call-results"],
  },
  {
    id: "faq-appointment",
    category: "sales",
    question: "アポが取れました。勝手に顧客になりますか？",
    answer: [
      "なりません。正式組織への昇格は手動です。",
      "「興味あり」「アポ獲得」のあと「正式組織へ昇格」を実行してください。",
    ],
    keywords: ["アポ", "自動", "昇格"],
    related: ["promote-prospect"],
  },
  {
    id: "faq-dnc",
    category: "sales",
    question: "「もう営業電話しないで」と言われました。",
    answer: [
      "「興味なし」ではなく「営業連絡不要」を選びます。",
      "会社全体で今後の営業架電対象から外れます（別リストでも対象外）。",
    ],
    keywords: ["営業連絡不要", "DNC", "二度と"],
    related: ["do-not-contact"],
  },
  {
    id: "faq-not-interested",
    category: "sales",
    question: "興味がないと言われました（連絡禁止ではない）。",
    answer: [
      "架電結果「興味なし」を選びます。リスト上は対象外になります。",
      "営業連絡不要（DNC）にはしません。",
    ],
    keywords: ["興味なし", "対象外"],
    related: ["call-results", "do-not-contact"],
  },
  {
    id: "faq-after-meeting",
    category: "activities",
    question: "商談後に何を残しますか？",
    answer: [
      "やったことは対応履歴、次にやることは次回アクションです。",
      "具体商談なら案件も更新します。",
    ],
    keywords: ["商談", "対応履歴", "残す"],
    related: ["create-activity", "create-action"],
  },
  {
    id: "faq-next-week",
    category: "activities",
    question: "来週やることを忘れたくありません。",
    answer: [
      "次回アクションに内容と期限を入れてください。",
      "マイデスクの「今日やること」に出てきます。",
    ],
    keywords: ["来週", "忘れ", "次回アクション"],
    related: ["create-action"],
  },
  {
    id: "faq-prospect-vs-org",
    category: "getting-started",
    question: "見込顧客と営業候補の違いは何ですか？",
    answer: [
      "営業候補は、まだ営業リスト上で電話してみる段階の候補です。",
      "見込顧客は、正式な組織として管理するときの関係性です。",
      "アポ後に正式組織へ昇格し、見込顧客として扱うのが典型です。",
    ],
    keywords: ["見込顧客", "営業候補", "違い"],
    related: ["prospect-vs-organization"],
  },
  {
    id: "faq-three-assignees",
    category: "organizations",
    question: "画面の「担当者」とは誰のことですか？",
    answer: [
      "次の3種類があります。",
      "1) 先方担当者（相手会社の人）",
      "2) 自社担当者（うちの社員）",
      "3) 権限の「担当者」（ログイン役割名）",
    ],
    keywords: ["担当者", "誰", "意味"],
    related: ["three-assignees"],
  },
  {
    id: "faq-invoice",
    category: "contracts",
    question: "請求書はどこで作りますか？",
    answer: [
      "請求書の作成・発行・管理は freee で行います。",
      "SalesSystemでは契約情報（期間・金額・請求条件メモなど）までを管理します。",
    ],
    keywords: ["請求書", "freee", "契約"],
    related: ["create-contract", "out-of-scope"],
  },
  {
    id: "faq-already-registered",
    category: "search",
    question: "会社が既に登録済みか分かりません。",
    answer: [
      "新規作成の前にヘッダの全体検索で会社名を調べてください。",
      "結果は「組織」と「営業候補」に分かれて表示されます。",
    ],
    keywords: ["検索", "既存", "重複"],
    related: ["search-company"],
  },
  {
    id: "faq-media",
    category: "organizations",
    question: "出版社から取材依頼が来ました。",
    answer: [
      "お問い合わせで受け、組織を「メディア」関係性で作成または紐付けます。",
      "対応内容は対応履歴へ残します。通常はすぐ案件化しません。",
    ],
    keywords: ["メディア", "取材", "出版社"],
    related: ["handle-inquiry", "create-organization"],
  },
  {
    id: "faq-municipality",
    category: "organizations",
    question: "自治体から実証相談が来ました。",
    answer: [
      "組織を「自治体」関係性で登録し、対応履歴を残します。",
      "条件が具体化したら案件化を検討します。",
    ],
    keywords: ["自治体", "実証"],
    related: ["create-organization", "create-deal"],
  },
  {
    id: "faq-university",
    category: "organizations",
    question: "大学の研究室と付き合いがあります。",
    answer: [
      "組織を「学校・研究機関」関係性で登録します。",
      "先方担当者（教授・担当者）も追加しておくと便利です。",
    ],
    keywords: ["大学", "研究", "学校"],
    related: ["create-organization"],
  },
  {
    id: "faq-multi-relationship",
    category: "organizations",
    question: "1社が顧客でもありパートナーでもあります。",
    answer: [
      "組織を二重に作らず、同じ組織に関係性を複数付けます。",
    ],
    keywords: ["複数", "関係性", "パートナー"],
    related: ["create-organization"],
  },
  {
    id: "faq-new-contact",
    category: "organizations",
    question: "会社は登録済みですが、新しい窓口が増えました。",
    answer: [
      "組織詳細から先方担当者を追加します。",
    ],
    keywords: ["窓口", "担当者追加"],
    related: ["create-contact"],
  },
  {
    id: "faq-retired-contact",
    category: "organizations",
    question: "先方担当者が退職しました。",
    answer: [
      "担当者を無効化します。履歴保全のため消し切りません。",
      "後任がいれば新たに追加します。",
    ],
    keywords: ["退職", "無効化"],
    related: ["create-contact"],
  },
  {
    id: "faq-spam",
    category: "inquiries",
    question: "営業メールやspamの問い合わせです。",
    answer: [
      "状態を「対応不要」にし、理由を残します。",
    ],
    keywords: ["spam", "対応不要", "営業メール"],
    related: ["handle-inquiry"],
  },
  {
    id: "faq-assign-inquiry",
    category: "inquiries",
    question: "問い合わせを同僚に振りたいです。",
    answer: [
      "お問い合わせの担当セレクトで相手を選びます。",
      "閲覧者権限では振分けできません。",
    ],
    keywords: ["振分", "担当変更"],
    related: ["handle-inquiry", "permissions-overview"],
  },
  {
    id: "faq-gmail-vs-inquiry",
    category: "inquiries",
    question: "普通のGmailも全部取り込まれますか？",
    answer: [
      "いいえ。Webフォーム由来など、取込対象として判定されたものだけがお問い合わせに入ります。",
    ],
    keywords: ["Gmail", "全部", "取込"],
    related: ["handle-inquiry"],
  },
  {
    id: "faq-inquiry-prospect-auto",
    category: "inquiries",
    question: "問い合わせは自動で営業候補になりますか？",
    answer: [
      "なりません。お問い合わせと営業候補の自動統合はありません。",
      "基本は組織への紐付け・作成で進めます。",
    ],
    keywords: ["自動", "営業候補", "統合"],
    related: ["out-of-scope", "handle-inquiry"],
  },
  {
    id: "faq-equal-assign",
    category: "sales",
    question: "300社を3人へ均等に割り当てたいです。",
    answer: [
      "営業リスト詳細の一括割当で3人を選び、「均等割当」を実行します。",
      "対象は表示中の行なので、ページや絞り込みに注意してください。",
    ],
    keywords: ["均等", "割当", "300"],
    related: ["assign-prospects"],
  },
  {
    id: "faq-kanagawa",
    category: "sales",
    question: "神奈川県だけAさんへ割り当てたいです。",
    answer: [
      "リスト詳細で都道府県を神奈川に絞り、表示された行をAさんへ単一担当で割当します。",
    ],
    keywords: ["神奈川", "都道府県", "割当"],
    related: ["assign-prospects"],
  },
  {
    id: "faq-duplicate-csv",
    category: "sales",
    question: "同じCSVを二重に入れてしまいました。",
    answer: [
      "同じ内容はスキップや再利用されることがありますが、過信は禁物です。",
      "リスト件数と重複候補を確認してください。",
    ],
    keywords: ["二重", "CSV", "スキップ"],
    related: ["import-prospect-csv"],
  },
  {
    id: "faq-archive-during-prospect-import",
    category: "sales",
    question: "CSV取込中の営業リストをアーカイブできますか？",
    answer: [
      "できません。取込が完了または失敗するまで待ってからアーカイブしてください。",
      "長時間「取込中」のまま変わらない場合は、管理者へ確認を依頼してください。",
    ],
    keywords: ["CSV", "取込中", "アーカイブ", "営業リスト"],
    related: ["import-prospect-csv"],
  },
  {
    id: "faq-same-name",
    category: "sales",
    question: "同じ会社名ですが別会社かもしれません。",
    answer: [
      "社名だけでは自動的に同一扱いしません。",
      "電話・Web・住所を見比べ、昇格時も既存組織候補を慎重に確認してください。",
    ],
    keywords: ["同名", "別会社", "重複"],
    related: ["promote-prospect", "search-company"],
  },
  {
    id: "faq-no-answer",
    category: "sales",
    question: "電話がつながりませんでした。",
    answer: [
      "架電結果「不通」を選び、必要なら次回連絡を入れて「保存して次へ」します。",
    ],
    keywords: ["不通", "つながらない"],
    related: ["call-results"],
  },
  {
    id: "faq-gatekeeper",
    category: "sales",
    question: "受付で止まりました。",
    answer: [
      "架電結果「受付止まり」を選び、可能なら次回連絡を入れます。",
      "担当者名が聞けたら担当者候補へ追加できます。",
    ],
    keywords: ["受付", "受付止まり"],
    related: ["call-results"],
  },
  {
    id: "faq-callback",
    category: "sales",
    question: "折返しを頼まれました。",
    answer: [
      "架電結果「折返し希望」を選び、次回連絡日時を必ず入れて保存します。",
      "日時なしでは保存できません。",
    ],
    keywords: ["折返し", "必須"],
    related: ["recalls", "call-results"],
  },
  {
    id: "faq-wrong-number",
    category: "sales",
    question: "電話番号が間違っていました。",
    answer: [
      "架電結果「番号違い」を選びます。番号要確認の表示になります。",
    ],
    keywords: ["番号違い", "電話番号"],
    related: ["call-results"],
  },
  {
    id: "faq-future-queue",
    category: "sales",
    question: "未来の再架電予定がキューに出ません。",
    answer: [
      "仕様です。既定の対象には、期限到来または予定なしのものが並びます。",
      "未来予定も含めて見る場合はフィルタを変更してください。",
    ],
    keywords: ["未来", "キュー", "出ない"],
    related: ["recalls"],
  },
  {
    id: "faq-shortcut",
    category: "sales",
    question: "架電画面のショートカットはありますか？",
    answer: [
      "数字キー1〜7で主な結果を選べます。",
      "Ctrl/Cmd + Enter で「保存して次へ」です。",
    ],
    keywords: ["ショートカット", "Ctrl", "数字"],
    related: ["call-prospect"],
  },
  {
    id: "faq-auto-dial",
    category: "sales",
    question: "自動で電話はかかりますか？",
    answer: [
      "かかりません。表示された番号へ手で電話し、結果だけ保存します。",
    ],
    keywords: ["自動発信", "Twilio"],
    related: ["out-of-scope", "call-prospect"],
  },
  {
    id: "faq-activity-note",
    category: "activities",
    question: "対応履歴の「当時入力した次回予定（履歴メモ）」はToDoですか？",
    answer: [
      "いいえ。対応した時点で入力した予定を残す履歴メモです。",
      "実際のToDoは「次回アクション」として登録してください。",
    ],
    keywords: ["入力記録", "誤解", "ToDo"],
    related: ["activity-vs-action"],
  },
  {
    id: "faq-complete-action",
    category: "activities",
    question: "次回アクションが終わったらどうしますか？",
    answer: [
      "「完了」ボタンを押します。マイデスクや詳細から操作できます。",
    ],
    keywords: ["完了", "アクション"],
    related: ["create-action"],
  },
  {
    id: "faq-delete-activity",
    category: "activities",
    question: "対応履歴を削除できますか？",
    answer: [
      "できません。削除機能は全権限で提供していません。",
      "必要なら編集で内容を修正します。",
    ],
    keywords: ["削除", "対応履歴"],
    related: ["create-activity"],
  },
  {
    id: "faq-when-deal",
    category: "deals",
    question: "いつ案件を作りますか？",
    answer: [
      "導入条件・価格・台数など具体的な商談が始まったタイミングがおすすめです。",
      "問い合わせが来ただけ、電話で興味あり、だけではまだ早いことが多いです。",
    ],
    keywords: ["案件", "いつ", "商談"],
    related: ["create-deal"],
  },
  {
    id: "faq-complaint-vs-activity",
    category: "contracts",
    question: "クレームと対応履歴の使い分けは？",
    answer: [
      "軽い確認は対応履歴、重要度や期限管理が必要な重大トラブルはクレームです。",
    ],
    keywords: ["クレーム", "使い分け"],
    related: ["create-complaint"],
  },
  {
    id: "faq-viewer",
    category: "permissions",
    question: "閲覧者は何ができますか？",
    answer: [
      "登録情報の閲覧と検索・マイデスクの参照が中心です。",
      "登録・編集・問い合わせ振分け・架電結果保存はできません。",
    ],
    keywords: ["閲覧者", "権限"],
    related: ["permissions-overview"],
  },
  {
    id: "faq-ops-role",
    category: "permissions",
    question: "運用責任者と担当者の違いは？",
    answer: [
      "どちらも日常業務はできます。",
      "運用責任者は加えて、営業リスト作成・CSV取込・一括割当など運用まわりができます。",
    ],
    keywords: ["運用責任者", "担当者", "違い"],
    related: ["permissions-overview"],
  },
  {
    id: "faq-admin-csv",
    category: "admin",
    question: "管理のCSV取込と営業リストCSVの違いは？",
    answer: [
      "管理のCSV取込は正式データの移行用です。",
      "営業リストのCSVは、まだ精査前の営業候補を入れるためのものです。",
    ],
    keywords: ["CSV取込", "違い", "移行"],
    related: ["admin-imports", "import-prospect-csv"],
  },
  {
    id: "faq-mydesk-start",
    category: "getting-started",
    question: "朝いちばんに何を見ればよいですか？",
    answer: [
      "マイデスクです。今日やること、今日の営業、新着お問い合わせを確認します。",
    ],
    keywords: ["朝", "マイデスク"],
    related: ["mydesk", "quick-start"],
  },
  {
    id: "faq-interested-promote",
    category: "sales",
    question: "興味ありのあと、すぐ昇格すべきですか？",
    answer: [
      "システム上は任意です。おすすめは、誰と・いつ・何を話すかが固まったら昇格することです。",
      "単なる資料請求なら、次回連絡を入れて様子見でも構いません。",
    ],
    keywords: ["興味あり", "昇格", "おすすめ"],
    related: ["promote-prospect"],
  },
  {
    id: "faq-link-existing-promote",
    category: "sales",
    question: "昇格時に既存組織候補が出ました。",
    answer: [
      "同一会社なら「この組織へ紐付け」を選びます。",
      "別会社なら新規作成します。ドメイン・電話・メール一致は信頼度が高めです。",
    ],
    keywords: ["既存組織", "紐付け", "昇格"],
    related: ["promote-prospect"],
  },
  {
    id: "faq-bulk-activity",
    category: "activities",
    question: "複数の組織へ同じ対応内容を残したいです。",
    answer: [
      "対応履歴の一括登録を使います（担当者権限でも利用可）。",
      "既存データの一括更新とは別機能です。",
    ],
    keywords: ["一括", "対応履歴"],
    related: ["create-activity"],
  },
  {
    id: "faq-contract-fields",
    category: "contracts",
    question: "契約では何を管理できますか？",
    answer: [
      "契約名・期間・金額・支払状況・自動更新・契約書URL・請求条件などです。",
      "請求書そのものの発行は freee です。",
    ],
    keywords: ["契約", "項目"],
    related: ["create-contract"],
  },
  {
    id: "faq-help-center",
    category: "getting-started",
    question: "このヘルプの詳しい版はどこにありますか？",
    answer: [
      "アプリ内のヘルプに加え、リポジトリの docs/user-guide/ にクイックスタート・正式マニュアル・FAQ・用語集があります。",
    ],
    keywords: ["マニュアル", "docs", "ガイド"],
    related: ["quick-start"],
  },
  {
    id: "faq-dnc-unlock",
    category: "sales",
    question: "営業連絡不要を解除できますか？",
    answer: [
      "営業候補詳細からDNC解除できます。方針変更時のみ、慎重に行ってください。",
    ],
    keywords: ["DNC", "解除"],
    related: ["do-not-contact"],
  },
  {
    id: "faq-exhibition",
    category: "sales",
    question: "展示会でもらった名簿はどうしますか？",
    answer: [
      "用途別の営業リストを作り、CSVなどで取り込みます。正式組織へ直接入れません。",
    ],
    keywords: ["展示会", "名簿"],
    related: ["import-prospect-csv"],
  },
  {
    id: "faq-scraping",
    category: "sales",
    question: "スクレイピングした3000社を入れたいです。",
    answer: [
      "営業リストを作成してCSVインポートします。組織へ直接登録しないでください。",
    ],
    keywords: ["スクレイピング", "3000"],
    related: ["import-prospect-csv"],
  },
];

export function getHelpFaq(id: string): HelpFaqItem | undefined {
  return HELP_FAQS.find((f) => f.id === id);
}

export function listHelpFaqs(includeAdmin = false): HelpFaqItem[] {
  return HELP_FAQS.filter((f) => includeAdmin || f.category !== "admin");
}
