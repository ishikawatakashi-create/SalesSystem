import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { randomUUID } from "crypto";

const IMPORT_BUCKET = "imports";
const DEFAULT_EXPIRY_DAYS = 30;

export type CreateImportUploadUrlInput = {
  userId: string;
  importJobId: string;
  fileName: string;
  fileSize: number;
  entityType: string;
  sourceSystem?: string;
};

export type CreateImportUploadUrlResult = {
  importJobId: string;
  signedUploadUrl: string;
  storagePath: string;
  expiresAt: Date;
};

/**
 * インポートジョブを作成し、署名付きアップロードURLを生成
 * 
 * @param input - ユーザーID、インポートジョブID、ファイル名、ファイルサイズ
 * @returns インポートジョブIDと署名付きアップロードURL
 * 
 * WARNING: ファイルコンテンツをログに記録しないこと
 */
export async function createImportUploadUrl(
  input: CreateImportUploadUrlInput,
): Promise<CreateImportUploadUrlResult> {
  const admin = createAdminClient();
  const { userId, importJobId, fileName, fileSize, entityType, sourceSystem } =
    input;

  // Storage path: {userId}/{importJobId}/{random}.csv
  const randomId = randomUUID();
  const storagePath = `${userId}/${importJobId}/${randomId}.csv`;
  const expiresAt = new Date(
    Date.now() + DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  );

  // Create import_jobs row with status 'uploaded'
  const { error: insertError } = await admin.from("import_jobs").insert({
    id: importJobId,
    file_name: fileName,
    storage_path: storagePath,
    file_size: fileSize,
    expires_at: expiresAt.toISOString(),
    status: "uploaded",
    created_by: userId,
    entity_type: entityType,
    source_system: sourceSystem ?? "csv",
    import_mode: "create",
  });

  if (insertError) {
    throw new Error(
      `Failed to create import_jobs record: ${insertError.message}`,
    );
  }

  // Generate signed upload URL (1 hour expiry)
  const { data: uploadData, error: uploadError } = await admin.storage
    .from(IMPORT_BUCKET)
    .createSignedUploadUrl(storagePath);

  if (uploadError || !uploadData) {
    throw new Error(
      `Failed to generate signed upload URL: ${uploadError?.message ?? "unknown error"}`,
    );
  }

  return {
    importJobId,
    signedUploadUrl: uploadData.signedUrl,
    storagePath,
    expiresAt,
  };
}

/**
 * インポートオブジェクトをダウンロード
 * 
 * @param storagePath - ストレージパス
 * @returns ファイルのBuffer
 * 
 * WARNING: ファイルコンテンツをログに記録しないこと
 */
export async function downloadImportObject(
  storagePath: string,
): Promise<Buffer> {
  const admin = createAdminClient();

  const { data, error } = await admin.storage
    .from(IMPORT_BUCKET)
    .download(storagePath);

  if (error || !data) {
    throw new Error(
      `Failed to download import object: ${error?.message ?? "unknown error"}`,
    );
  }

  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * インポートオブジェクトの署名付きダウンロードURLを生成
 * 
 * 注意: 作成者または管理者のみがアクセスできることを呼び出し側で確認すること
 * 
 * @param storagePath - ストレージパス
 * @param expiresSec - 有効期限（秒）、デフォルトは60秒
 * @returns 署名付きダウンロードURL
 */
export async function createImportDownloadUrl(
  storagePath: string,
  expiresSec = 60,
): Promise<string> {
  const admin = createAdminClient();

  const { data, error } = await admin.storage
    .from(IMPORT_BUCKET)
    .createSignedUrl(storagePath, expiresSec);

  if (error || !data) {
    throw new Error(
      `Failed to create signed download URL: ${error?.message ?? "unknown error"}`,
    );
  }

  return data.signedUrl;
}

/**
 * 期限切れインポートオブジェクトを削除
 * 
 * @param storagePath - ストレージパス
 * @returns 削除成功の場合true
 */
export async function deleteExpiredImportObject(
  storagePath: string,
): Promise<boolean> {
  const admin = createAdminClient();

  const { error } = await admin.storage
    .from(IMPORT_BUCKET)
    .remove([storagePath]);

  if (error) {
    throw new Error(
      `Failed to delete expired import object: ${error.message}`,
    );
  }

  return true;
}
