/**
 * Supabaseテーブルの型定義(認証スパイク範囲)。
 * Phase 1のスキーマ確定後は `supabase gen types` による自動生成へ移行する。
 */

export type AppRole = "admin" | "a" | "b" | "viewer";

export type ProvisioningStatus =
  | "pending"
  | "auth_created"
  | "profile_created"
  | "completed"
  | "failed";

export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";

// 注: supabase-jsの型制約(Record<string, unknown>)を満たすため、
// interfaceではなくtypeエイリアスで定義すること。
export type AppUserRow = {
  id: string;
  email: string;
  display_name: string;
  role: AppRole;
  department_role: string | null;
  is_active: boolean;
  provisioning_status: ProvisioningStatus;
  provisioning_error: string | null;
  notion_staff_page_id: string | null;
  invitation_id: string | null;
  created_at: string;
  updated_at: string;
};

export type UserInvitationRow = {
  id: string;
  email: string;
  normalized_email: string;
  display_name: string;
  role: AppRole;
  status: InvitationStatus;
  invited_by: string | null;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

export type Database = {
  public: {
    Tables: {
      app_users: {
        Row: AppUserRow;
        Insert: Partial<AppUserRow> &
          Pick<AppUserRow, "id" | "email" | "display_name" | "role">;
        Update: Partial<AppUserRow>;
        Relationships: [];
      };
      user_invitations: {
        Row: UserInvitationRow;
        Insert: Partial<UserInvitationRow> &
          Pick<
            UserInvitationRow,
            "email" | "normalized_email" | "display_name" | "role"
          >;
        Update: Partial<UserInvitationRow>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      current_app_role: {
        Args: Record<string, never>;
        Returns: AppRole | null;
      };
    };
    Enums: {
      app_role: AppRole;
      provisioning_status: ProvisioningStatus;
      invitation_status: InvitationStatus;
    };
    CompositeTypes: Record<string, never>;
  };
};
