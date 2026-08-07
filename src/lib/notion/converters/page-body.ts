/**
 * ページ本文ブロック操作の土台。
 * 長文はプロパティへ格納せず本文へ配置する(docs/notion-schema.md §10)。
 *
 * 対応履歴の管理セクション:
 * - 先頭ブロックは不可視メタデータ段落 `§ss:body_version=N§`
 * - 続けて見出し「対応内容」と本文段落
 * - 末尾は終了マーカー `§ss:body_end§`(後続の手動ブロックを巻き込まない)
 * - 更新は append → verify → 旧管理ブロック削除(未マーク手動ブロックは消さない)
 */

import { createHash } from "node:crypto";

/** 管理セクション先頭マーカー。人間が編集しにくい版番号メタデータ */
export const ACTIVITY_BODY_VERSION_MARKER_RE = /^§ss:body_version=(\d+)§$/;

/** 管理セクション終了マーカー。これ以降は手動ブロックとして残す */
export const ACTIVITY_BODY_END_MARKER = "§ss:body_end§";

export const ACTIVITY_BODY_HEADING = "対応内容";

const NOTION_RICH_TEXT_MAX = 2000;

export type PageBodySection = {
  heading: string;
  paragraphs: string[];
};

export type NotionBlockLike = {
  id: string;
  type: string;
  paragraph?: { rich_text?: Array<{ plain_text?: string }> };
  heading_1?: { rich_text?: Array<{ plain_text?: string }> };
  heading_2?: { rich_text?: Array<{ plain_text?: string }> };
  heading_3?: { rich_text?: Array<{ plain_text?: string }> };
  code?: { rich_text?: Array<{ plain_text?: string }> };
  bulleted_list_item?: { rich_text?: Array<{ plain_text?: string }> };
  numbered_list_item?: { rich_text?: Array<{ plain_text?: string }> };
  quote?: { rich_text?: Array<{ plain_text?: string }> };
};

export type ManagedBodySection = {
  version: number;
  blockIds: string[];
  bodyText: string;
};

export function formatActivityBodyVersionMarker(version: number): string {
  if (!Number.isInteger(version) || version < 1) {
    throw new Error("body_version は1以上の整数である必要があります");
  }
  return `§ss:body_version=${version}§`;
}

export function parseActivityBodyVersionMarker(
  text: string,
): number | null {
  const m = ACTIVITY_BODY_VERSION_MARKER_RE.exec(text.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

export function isActivityBodyEndMarker(text: string): boolean {
  return text.trim() === ACTIVITY_BODY_END_MARKER;
}

export function hashActivityBody(text: string): string {
  return createHash("sha256").update(text ?? "", "utf8").digest("hex");
}

export function buildHeadingSections(
  sections: PageBodySection[],
): Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = [];
  for (const section of sections) {
    blocks.push({
      type: "heading_2",
      heading_2: {
        rich_text: [{ type: "text", text: { content: section.heading } }],
      },
    });
    for (const paragraph of section.paragraphs) {
      for (const chunk of chunkText(paragraph, NOTION_RICH_TEXT_MAX)) {
        blocks.push({
          type: "paragraph",
          paragraph: {
            rich_text: [{ type: "text", text: { content: chunk } }],
          },
        });
      }
    }
  }
  return blocks;
}

/**
 * 対応履歴の管理セクションブロック群を構築する。
 * 先頭は body_version マーカー、末尾は body_end マーカー。
 */
export function buildManagedActivityBodyBlocks(input: {
  body: string;
  bodyVersion: number;
}): Array<Record<string, unknown>> {
  const marker = formatActivityBodyVersionMarker(input.bodyVersion);
  const blocks: Array<Record<string, unknown>> = [
    {
      type: "paragraph",
      paragraph: {
        rich_text: [{ type: "text", text: { content: marker } }],
      },
    },
    {
      type: "heading_2",
      heading_2: {
        rich_text: [
          { type: "text", text: { content: ACTIVITY_BODY_HEADING } },
        ],
      },
    },
  ];

  const paragraphs = splitBodyParagraphs(input.body);
  if (paragraphs.length === 0) {
    blocks.push({
      type: "paragraph",
      paragraph: { rich_text: [] },
    });
  } else {
    for (const paragraph of paragraphs) {
      for (const chunk of chunkText(paragraph, NOTION_RICH_TEXT_MAX)) {
        blocks.push({
          type: "paragraph",
          paragraph: {
            rich_text: [{ type: "text", text: { content: chunk } }],
          },
        });
      }
    }
  }

  blocks.push({
    type: "paragraph",
    paragraph: {
      rich_text: [{ type: "text", text: { content: ACTIVITY_BODY_END_MARKER } }],
    },
  });
  return blocks;
}

/**
 * ページ子ブロックから管理セクションを抽出(version昇順)。
 * 開始マーカー〜終了マーカー(または次の開始マーカー直前)を1セクションとする。
 * 終了マーカー後の未マークブロックは管理対象外。
 */
export function findManagedSections(
  blocks: NotionBlockLike[],
): ManagedBodySection[] {
  const sections: ManagedBodySection[] = [];
  let current: {
    version: number;
    blockIds: string[];
    bodyParts: string[];
    seenHeading: boolean;
  } | null = null;

  const flush = () => {
    if (!current) return;
    sections.push({
      version: current.version,
      blockIds: current.blockIds,
      bodyText: current.bodyParts.join("\n").replace(/\n+$/, ""),
    });
    current = null;
  };

  for (const block of blocks) {
    const plain = blockPlainText(block);
    const version = parseActivityBodyVersionMarker(plain);
    if (version !== null && isMarkerBlock(block)) {
      flush();
      current = {
        version,
        blockIds: [block.id],
        bodyParts: [],
        seenHeading: false,
      };
      continue;
    }
    if (!current) continue;

    if (isActivityBodyEndMarker(plain) && isMarkerBlock(block)) {
      current.blockIds.push(block.id);
      flush();
      continue;
    }

    current.blockIds.push(block.id);
    if (!current.seenHeading && isHeadingBlock(block)) {
      current.seenHeading = true;
      continue;
    }
    if (isHeadingBlock(block) && current.seenHeading) {
      // 管理見出し後の別見出しは本文として扱う(手動編集耐性)
      current.bodyParts.push(plain);
      continue;
    }
    if (plain.length > 0 || block.type === "paragraph") {
      current.bodyParts.push(plain);
    }
  }
  flush();

  return sections.sort((a, b) => a.version - b.version);
}

/**
 * 認識できる管理セクションのうち最高 version を返す。
 * 無ければ null(手動ブロックのみ・未作成など)。
 */
export function extractManagedBody(
  blocks: NotionBlockLike[],
): { body: string; bodyVersion: number; managedBlockIds: string[] } | null {
  const sections = findManagedSections(blocks);
  if (sections.length === 0) return null;
  const latest = sections[sections.length - 1]!;
  return {
    body: latest.bodyText,
    bodyVersion: latest.version,
    managedBlockIds: latest.blockIds,
  };
}

/** 全管理セクションの block id(旧版含む)。削除対象の列挙に使う */
export function collectAllManagedBlockIds(blocks: NotionBlockLike[]): string[] {
  return findManagedSections(blocks).flatMap((s) => s.blockIds);
}

export function summarizeText(text: string, max = 200): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}…`;
}

function splitBodyParagraphs(body: string): string[] {
  const normalized = body.replace(/\r\n/g, "\n");
  if (!normalized.trim()) return [];
  return normalized.split("\n");
}

function chunkText(text: string, max: number): string[] {
  if (text.length === 0) return [""];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += max) {
    chunks.push(text.slice(i, i + max));
  }
  return chunks;
}

function blockPlainText(block: NotionBlockLike): string {
  const rich =
    block.paragraph?.rich_text ??
    block.heading_1?.rich_text ??
    block.heading_2?.rich_text ??
    block.heading_3?.rich_text ??
    block.code?.rich_text ??
    block.bulleted_list_item?.rich_text ??
    block.numbered_list_item?.rich_text ??
    block.quote?.rich_text ??
    [];
  return rich.map((t) => t.plain_text ?? "").join("");
}

function isMarkerBlock(block: NotionBlockLike): boolean {
  return block.type === "paragraph" || block.type === "code";
}

function isHeadingBlock(block: NotionBlockLike): boolean {
  return (
    block.type === "heading_1" ||
    block.type === "heading_2" ||
    block.type === "heading_3"
  );
}

/** クレーム本文の見出し(順序固定) */
export const COMPLAINT_BODY_HEADINGS = [
  "内容",
  "原因",
  "対応内容",
  "再発防止策",
] as const;

export type ComplaintBodyHeading = (typeof COMPLAINT_BODY_HEADINGS)[number];

export type ComplaintBodySectionKey =
  | "content"
  | "cause"
  | "response"
  | "prevention";

export type ComplaintBodySections = {
  content: string | null;
  cause: string | null;
  response: string | null;
  prevention: string | null;
};

const COMPLAINT_HEADING_TO_KEY: Record<
  ComplaintBodyHeading,
  ComplaintBodySectionKey
> = {
  内容: "content",
  原因: "cause",
  対応内容: "response",
  再発防止策: "prevention",
};

function emptyComplaintSections(): ComplaintBodySections {
  return {
    content: null,
    cause: null,
    response: null,
    prevention: null,
  };
}

function normalizeComplaintSectionText(text: string): string | null {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\n+$/, "");
  return normalized.trim() ? normalized : null;
}

/** 管理セクション連結文字列(content-hash / 要約自動生成用) */
export function concatenateComplaintBodySections(
  sections: ComplaintBodySections,
): string {
  return COMPLAINT_BODY_HEADINGS.map((heading) => {
    const key = COMPLAINT_HEADING_TO_KEY[heading];
    return sections[key] ?? "";
  }).join("\n");
}

export function hashComplaintBody(sections: ComplaintBodySections): string {
  return createHash("sha256")
    .update(concatenateComplaintBodySections(sections), "utf8")
    .digest("hex");
}

/**
 * クレームの管理セクションブロック群を構築する。
 * 先頭は body_version マーカー、4見出し+段落、末尾は body_end マーカー。
 */
export function buildManagedComplaintBodyBlocks(input: {
  sections: ComplaintBodySections;
  bodyVersion: number;
}): Array<Record<string, unknown>> {
  const marker = formatActivityBodyVersionMarker(input.bodyVersion);
  const blocks: Array<Record<string, unknown>> = [
    {
      type: "paragraph",
      paragraph: {
        rich_text: [{ type: "text", text: { content: marker } }],
      },
    },
  ];

  for (const heading of COMPLAINT_BODY_HEADINGS) {
    const key = COMPLAINT_HEADING_TO_KEY[heading];
    const text = input.sections[key] ?? "";
    blocks.push({
      type: "heading_2",
      heading_2: {
        rich_text: [{ type: "text", text: { content: heading } }],
      },
    });
    const paragraphs = splitBodyParagraphs(text);
    if (paragraphs.length === 0) {
      blocks.push({
        type: "paragraph",
        paragraph: { rich_text: [] },
      });
    } else {
      for (const paragraph of paragraphs) {
        for (const chunk of chunkText(paragraph, NOTION_RICH_TEXT_MAX)) {
          blocks.push({
            type: "paragraph",
            paragraph: {
              rich_text: [{ type: "text", text: { content: chunk } }],
            },
          });
        }
      }
    }
  }

  blocks.push({
    type: "paragraph",
    paragraph: {
      rich_text: [{ type: "text", text: { content: ACTIVITY_BODY_END_MARKER } }],
    },
  });
  return blocks;
}

export type ManagedComplaintBody = {
  sections: ComplaintBodySections;
  bodyVersion: number;
  managedBlockIds: string[];
  /** 連結本文(ハッシュ比較用) */
  bodyText: string;
};

/**
 * ページ子ブロックからクレーム管理セクション(最高 version)を抽出する。
 * 見出し単位で4セクションへ分解。未認識見出し配下は無視しない(直前セクションへ結合)。
 */
export function extractManagedComplaintBody(
  blocks: NotionBlockLike[],
): ManagedComplaintBody | null {
  type Acc = {
    version: number;
    blockIds: string[];
    sections: ComplaintBodySections;
    currentKey: ComplaintBodySectionKey | null;
    buffers: Record<ComplaintBodySectionKey, string[]>;
  };

  const finished: ManagedComplaintBody[] = [];
  let current: Acc | null = null;

  const flush = () => {
    if (!current) return;
    const sections = emptyComplaintSections();
    for (const key of Object.keys(current.buffers) as ComplaintBodySectionKey[]) {
      sections[key] = normalizeComplaintSectionText(
        current.buffers[key].join("\n"),
      );
    }
    finished.push({
      sections,
      bodyVersion: current.version,
      managedBlockIds: current.blockIds,
      bodyText: concatenateComplaintBodySections(sections),
    });
    current = null;
  };

  for (const block of blocks) {
    const plain = blockPlainText(block);
    const version = parseActivityBodyVersionMarker(plain);
    if (version !== null && isMarkerBlock(block)) {
      flush();
      current = {
        version,
        blockIds: [block.id],
        sections: emptyComplaintSections(),
        currentKey: null,
        buffers: {
          content: [],
          cause: [],
          response: [],
          prevention: [],
        },
      };
      continue;
    }
    if (!current) continue;

    if (isActivityBodyEndMarker(plain) && isMarkerBlock(block)) {
      current.blockIds.push(block.id);
      flush();
      continue;
    }

    current.blockIds.push(block.id);

    if (isHeadingBlock(block)) {
      const heading = plain.trim() as ComplaintBodyHeading;
      if (
        (COMPLAINT_BODY_HEADINGS as readonly string[]).includes(heading)
      ) {
        current.currentKey = COMPLAINT_HEADING_TO_KEY[heading];
        continue;
      }
      // 未知見出しは現在セクション本文として扱う
      if (current.currentKey) {
        current.buffers[current.currentKey].push(plain);
      }
      continue;
    }

    if (current.currentKey && (plain.length > 0 || block.type === "paragraph")) {
      current.buffers[current.currentKey].push(plain);
    }
  }
  flush();

  if (finished.length === 0) return null;
  finished.sort((a, b) => a.bodyVersion - b.bodyVersion);
  return finished[finished.length - 1]!;
}
