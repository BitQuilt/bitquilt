/**
 * The Content-Security-Policy of each page the on-ramp serves whole: the join page, the authorization page (QX-18) and
 * the sheet. Each is one self-contained document, as AGENTS.md rule 6 asks of a page, so its policy loads nothing from
 * anywhere, runs the page's own inline script and style by their hashes and nothing else, calls back to this tracker
 * alone, posts no form, sets no base, and lets no other page frame it. The hashes are read from the document itself,
 * so an edit to a page's script carries its own hash with it. The square page has no script and keeps its own policy
 * in hosted.ts.
 */
import { createHash } from 'node:crypto';

/** The hash source of each inline element of one kind in a document: the SHA-256 of its text, as a browser hashes it. */
function hashesOf(html: string, tag: 'script' | 'style'): string[] {
  const texts = [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gi'))].map((m) => m[1]!);
  return [...new Set(texts.map((t) => `'sha256-${createHash('sha256').update(t, 'utf8').digest('base64')}'`))];
}

/** The policy for one page: its own script and style by hash, its reads from this tracker, and nothing else. */
export function pagePolicy(html: string): string {
  const by = (tag: 'script' | 'style'): string => hashesOf(html, tag).join(' ') || "'none'";
  return [
    "default-src 'none'",
    `script-src ${by('script')}`,
    `style-src ${by('style')}`,
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}
