import "server-only";

function optional(name: string): string | null {
  const v = process.env[name]?.trim();
  return v ? v : null;
}

/** Gmail OAuth / Pub/Sub 用 env（値はログしない） */
export function gmailOAuthClientId(): string | null {
  return optional("GMAIL_OAUTH_CLIENT_ID");
}

export function gmailOAuthClientSecret(): string | null {
  return optional("GMAIL_OAUTH_CLIENT_SECRET");
}

export function gmailOAuthRedirectUri(): string | null {
  return (
    optional("GMAIL_OAUTH_REDIRECT_URI") ||
    (process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/api/integrations/gmail/oauth/callback`
      : null)
  );
}

export function gcpProjectId(): string | null {
  return optional("GCP_PROJECT_ID");
}

export function gmailPubSubTopic(): string | null {
  return optional("GMAIL_PUBSUB_TOPIC");
}

export function gmailPubSubAudience(): string | null {
  return optional("GMAIL_PUBSUB_AUDIENCE");
}

export function gmailPubSubServiceAccount(): string | null {
  return optional("GMAIL_PUBSUB_SERVICE_ACCOUNT");
}

/** OAuth 接続に必要な env */
export function gmailOAuthEnvConfigured(): boolean {
  return Boolean(
    gmailOAuthClientId() &&
      gmailOAuthClientSecret() &&
      gmailOAuthRedirectUri(),
  );
}

/** Pub/Sub push + watch に必要な env */
export function gmailPubSubEnvConfigured(): boolean {
  return Boolean(
    gcpProjectId() &&
      gmailPubSubTopic() &&
      gmailPubSubAudience() &&
      gmailPubSubServiceAccount(),
  );
}

export function gmailEnvConfigured(): boolean {
  return gmailOAuthEnvConfigured() && gmailPubSubEnvConfigured();
}

/** admin UI 向け: 値を出さず設定有無だけ */
export function gmailEnvPresence(): Record<string, boolean> {
  return {
    GMAIL_OAUTH_CLIENT_ID: Boolean(gmailOAuthClientId()),
    GMAIL_OAUTH_CLIENT_SECRET: Boolean(gmailOAuthClientSecret()),
    GMAIL_OAUTH_REDIRECT_URI: Boolean(gmailOAuthRedirectUri()),
    GCP_PROJECT_ID: Boolean(gcpProjectId()),
    GMAIL_PUBSUB_TOPIC: Boolean(gmailPubSubTopic()),
    GMAIL_PUBSUB_AUDIENCE: Boolean(gmailPubSubAudience()),
    GMAIL_PUBSUB_SERVICE_ACCOUNT: Boolean(gmailPubSubServiceAccount()),
  };
}
