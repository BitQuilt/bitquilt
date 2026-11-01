/**
 * The products whose OAuth callbacks the hosted on-ramp knows (QX-18 section 2): each redirect URI exactly as the
 * product registers it, and the product a token obtained through it is marked as. A product's backend receives the
 * code at its callback and exchanges it, so a token whose code went to claude.ai's callback was obtained by claude.ai;
 * a code sent anywhere else marks the token `other`. What a client calls itself decides nothing here.
 *
 * Sources, read 1 November 2026: Anthropic's help article on custom connectors names claude.ai's callback and says it
 * may move to claude.com's; OpenAI's connectors send either the stable `connector_platform_oauth_redirect` or a
 * callback of the connector's own under `/connector/oauth/`, depending on how the server identifies its issuer.
 */

export interface ProductCallback {
  /** The product, as the mark names it: its host. */
  product: string;
  /** The redirect URI, compared whole; or, for a callback with an id of its own, the pattern it is held to. */
  uri: string | RegExp;
}

export const PRODUCT_CALLBACKS: readonly ProductCallback[] = [
  { product: 'claude.ai', uri: 'https://claude.ai/api/mcp/auth_callback' },
  { product: 'claude.ai', uri: 'https://claude.com/api/mcp/auth_callback' },
  { product: 'chatgpt.com', uri: 'https://chatgpt.com/connector_platform_oauth_redirect' },
  { product: 'chatgpt.com', uri: /^https:\/\/chatgpt\.com\/connector\/oauth\/[A-Za-z0-9_-]{1,128}$/ },
];

/** The product whose callback a redirect URI is, compared as a whole string; null for any other. */
export function productOf(redirectUri: string): string | null {
  for (const c of PRODUCT_CALLBACKS) if (typeof c.uri === 'string' ? redirectUri === c.uri : c.uri.test(redirectUri)) return c.product;
  return null;
}
