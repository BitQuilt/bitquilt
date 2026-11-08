/**
 * The products the hosted on-ramp can witness (QX-18 section 2): for each, the redirect URIs it registers, exactly as
 * it registers them; the origins its own client metadata document and keys live on; and the address ranges it
 * publishes for the servers that make its calls. A code sent to a product's callback is redeemed only in a way that
 * binds the redemption to the product: signed with a key from a document on the product's origin, or from an address
 * in the product's published ranges. What a client calls itself decides nothing here.
 *
 * Sources, read 1 November 2026. Anthropic's connector documentation names claude.ai's callback and says it may move
 * to claude.com's; its IP page gives `160.79.104.0/21` as the outbound range for MCP tool calls, "stable" and not to
 * change without notice; the hosted apps identify themselves with a client metadata document Anthropic hosts, as a
 * public client. OpenAI's connector documentation names the stable callback and the per-connector form, the client
 * metadata document at `https://chatgpt.com/oauth/client.json` with its JWKS beside it, and says ChatGPT signs its
 * token requests server-side; its egress ranges are a feed of hundreds of prefixes that changes often, so none is
 * written here and `QUILT_WITNESS_RANGES` may add them.
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

/** The origins a product's own client metadata document, and so its keys, may live on. */
export const PRODUCT_ORIGINS: Readonly<Record<string, readonly string[]>> = {
  'claude.ai': ['https://claude.ai', 'https://claude.com'],
  'chatgpt.com': ['https://chatgpt.com'],
};

/**
 * The address ranges each product publishes for the servers that make its calls, as read on 1 November 2026;
 * `QUILT_WITNESS_RANGES` replaces them.
 */
export const PRODUCT_RANGES: Readonly<Record<string, readonly string[]>> = {
  'claude.ai': ['160.79.104.0/21'],
  'chatgpt.com': [],
};

/** Every product this on-ramp knows, in the order of the callbacks. */
export const PRODUCTS: readonly string[] = [...new Set(PRODUCT_CALLBACKS.map((c) => c.product))];

/** The product whose callback a redirect URI is, compared as a whole string; null for any other. */
export function productOf(redirectUri: string): string | null {
  for (const c of PRODUCT_CALLBACKS)
    if (typeof c.uri === 'string' ? redirectUri === c.uri : c.uri.test(redirectUri)) return c.product;
  return null;
}

/** Whether a client metadata document's URL is on one of the product's own origins. */
export function onProductOrigin(product: string, clientId: string): boolean {
  try {
    return (PRODUCT_ORIGINS[product] ?? []).includes(new URL(clientId).origin);
  } catch {
    return false;
  }
}

/** A product's callbacks as text, for the well-known document and the page. */
export function callbacksOf(product: string): string[] {
  return PRODUCT_CALLBACKS.filter((c) => c.product === product).map((c) =>
    typeof c.uri === 'string' ? c.uri : c.uri.source.replace(/^\^|\$$/g, '').replace(/\\/g, ''),
  );
}
