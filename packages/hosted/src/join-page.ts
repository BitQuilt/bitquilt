/**
 * The page at /join: one button that asks the tracker for an address, and, once it is made, everything the person
 * needs next: the address with a copy button, where it goes in their AI's connectors, the first two sentences to say,
 * the sheet the same address shows in a browser, and how the key comes home. One self-contained document, as the
 * client's page is: nothing is loaded from elsewhere, and what the script puts on the page it sets with `textContent`.
 * The sentences are the phrases the connector offers as prompts (phrases.ts), so the page and the chat say one thing.
 */
import { say } from 'quilt';

const text = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const JOIN_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>An address on this tracker</title>
<style>
:root{color-scheme:light dark}
body{margin:0;font:17px/1.5 system-ui,sans-serif;background:#eef0f3;color:#17213a}
main{max-width:620px;margin:0 auto;padding:40px 16px}
h2{font-size:1.05rem;margin:28px 0 8px}
button{font:inherit;padding:10px 18px;border-radius:6px;border:1.5px solid #2b3f7a;background:#2b3f7a;color:#fff;cursor:pointer}
button.small{padding:6px 12px;white-space:nowrap}
code{font-family:ui-monospace,Menlo,monospace;overflow-wrap:anywhere}
pre{background:#e3e6eb;padding:12px;border-radius:6px;white-space:pre-wrap;word-break:break-all;margin:0;flex:1}
.q{color:#4a546b}
.row{display:flex;gap:10px;align-items:flex-start;margin:8px 0}
.row p{margin:0;flex:1;padding:10px 12px;border-radius:8px;background:#fff}
ol{padding-left:1.2em}
@media (prefers-color-scheme: dark){body{background:#151922;color:#e6e9f0}.row p{background:#1e2330}.q{color:#aab2c5}pre{background:#262c3a}}
</style>
</head>
<body>
<main>
<h1>An address on this tracker</h1>
<p>For a person who runs nothing. This tracker makes a key, keeps it encrypted, and signs for you until you take the key home. Every event it writes for you says so. One click, and your AI can work Quilt from any chat.</p>
<p><button id="go">Make me an address</button></p>
<div id="out" hidden>
<h2>Your address</h2>
<div class="row"><pre id="url"></pre><button class="small" id="copyUrl">Copy</button></div>
<p class="q">Your key's public address is <code id="addr"></code>. The long address above is the key to it: anyone who has it can act as you here, so keep it to yourself.</p>
<h2>Where it goes</h2>
<ol>
<li>In claude.ai, open Settings, then Connectors, choose Add custom connector, paste the address and call it Quilt. The free plan allows one custom connector, and this is it.</li>
<li>Claude Desktop shows the same list under Settings, Connectors. The Claude app on a phone uses the connectors the account has.</li>
<li>Any other chat that takes an MCP address takes this one.</li>
</ol>
<h2>Then, in a new chat, say</h2>
<div class="row"><p id="p1">${text(say('who_am_i'))}</p><button class="small" data-copy="p1">Copy</button></div>
<div class="row"><p id="p2">${text(say('find_something_to_do'))}</p><button class="small" data-copy="p2">Copy</button></div>
<p class="q">Your AI asks you before it writes anything in your name.</p>
<h2>Your sheet</h2>
<p class="q">The same address, opened in a browser, is your sheet: your standing, your coin and what is owed today, what is wanted from you, and the sentences to say. <a id="sheet" href="#">Open your sheet</a> and keep the tab.</p>
<h2>Taking the key home</h2>
<p class="q">The key is yours. On a Mac, the Quilt app's first screen has "I have an address on a tracker": paste the address there and the key moves to your own machine, with the standing and coin it earned. Or open <a id="key" href="#">the key itself</a> once and import it with <code>quilt init --secret</code>, then treat this address as spent.</p>
</div>
<p id="err" class="q" hidden></p>
<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var copy = function (button, value) {
    navigator.clipboard.writeText(value).then(function () { button.textContent = 'Copied'; setTimeout(function () { button.textContent = 'Copy'; }, 1500); });
  };
  $('go').addEventListener('click', function () {
    fetch('/join', { method: 'POST' })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || r.status); return j; }); })
      .then(function (j) {
        $('url').textContent = j.url;
        $('addr').textContent = j.address;
        $('sheet').href = j.url;
        $('key').href = j.url + '/key';
        $('out').hidden = false;
        $('go').hidden = true;
      })
      .catch(function (e) {
        var p = $('err');
        p.textContent = e.message;
        p.hidden = false;
      });
  });
  $('copyUrl').addEventListener('click', function () { copy($('copyUrl'), $('url').textContent); });
  Array.prototype.forEach.call(document.querySelectorAll('button[data-copy]'), function (b) {
    b.addEventListener('click', function () { copy(b, $(b.getAttribute('data-copy')).textContent); });
  });
})();
</script>
</main>
</body>
</html>`;
