/**
 * The authorization page (QX-18): where a person lets a client, claude.ai or ChatGPT or any other, hold a token for
 * their address. It says which client asks, in the client's own words and quoted; where the answer goes, which is what
 * the tracker's mark reads; what the token lets the client do and what it does not; and it takes the address the
 * person holds as their proof. One self-contained document, as the join page and the sheet are: nothing is loaded from
 * elsewhere, and what the script puts on the page it sets with `textContent`. It reads the request at
 * `/oauth/authorize/request` and posts the answer to `/oauth/authorize`, then follows the redirect it is given.
 */
export const AUTHORIZE_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Let a client use your Quilt</title>
<style>
:root{color-scheme:light dark}
body{margin:0;font:17px/1.5 system-ui,sans-serif;background:#eef0f3;color:#17213a}
main{max-width:620px;margin:0 auto;padding:40px 16px}
h1{font-size:1.5rem;margin:0 0 12px}
h2{font-size:1.05rem;margin:28px 0 8px}
.q{color:#4a546b}
.card{padding:12px 14px;border-radius:8px;background:#fff;margin:8px 0}
code{font-family:ui-monospace,Menlo,monospace;overflow-wrap:anywhere}
input{font:inherit;width:100%;box-sizing:border-box;padding:10px 12px;border-radius:6px;border:1.5px solid #9aa3b5;background:#fff;color:inherit}
.row{display:flex;gap:10px;margin-top:12px}
button{font:inherit;padding:10px 18px;border-radius:6px;border:1.5px solid #2b3f7a;background:#2b3f7a;color:#fff;cursor:pointer}
button.plain{background:transparent;color:#2b3f7a}
#err{color:#a1281e}
@media (prefers-color-scheme: dark){body{background:#151922;color:#e6e9f0}.card{background:#1e2330}.q{color:#aab2c5}input{background:#1e2330;border-color:#4a546b}button.plain{color:#aab8e8;border-color:#aab8e8}#err{color:#f08a80}}
</style>
</head>
<body>
<main>
<h1>Let a client use your Quilt</h1>
<p id="loading" class="q">Reading the request.</p>
<div id="ask" hidden>
<div class="card">
<p><span id="who"></span></p>
<p>When you allow it, the answer goes to <code id="uri"></code>, <span id="whose"></span></p>
<p class="q" id="mark"></p>
</div>
<h2>What the token lets it do</h2>
<p class="q">It uses Quilt's tools on this tracker as you, the same tools your long address gives: it reads problems, your standing and your coin, takes a piece and hands a return back in your name, publishes a problem, and pays, moves or redeems your coin, each when you say so in the chat. It cannot fetch your key or open your sheet. The token lasts an hour and the client renews it until it gives the token up; your long address goes on working beside it.</p>
<h2>Your address</h2>
<p class="q">Paste the long address the join page gave you, or its last part. It is the proof that the address is yours; this page is at <code id="host"></code>, and only this tracker reads it.</p>
<input id="address" type="password" autocomplete="off" spellcheck="false" aria-label="Your address on this tracker">
<div class="row"><button id="allow">Allow</button><button id="decline" class="plain">Decline</button></div>
</div>
<p id="err" hidden></p>
<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var query = location.search;
  var fail = function (message) {
    $('loading').hidden = true;
    $('err').textContent = message;
    $('err').hidden = false;
  };
  $('host').textContent = location.host;
  fetch('/oauth/authorize/request' + query)
    .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || r.status); return j; }); })
    .then(function (j) {
      $('who').textContent = j.client.name
        ? 'A client that calls itself \\u201c' + j.client.name + '\\u201d asks to use your Quilt on ' + j.tracker + '. That name is its own word.'
        : 'A client that gave no name asks to use your Quilt on ' + j.tracker + '.';
      $('uri').textContent = j.redirect.uri;
      $('whose').textContent = j.redirect.product
        ? 'which is ' + j.redirect.product + '\\u2019s own callback.'
        : 'at ' + j.redirect.host + ', which is not the callback of a product this tracker knows.';
      $('mark').textContent = j.redirect.product
        ? 'Every event this tracker writes for you through this client will say via: ' + j.redirect.product + ' beside custody: hosted. It says the product made the calls; it is the tracker\\u2019s word, and it does not say who typed the answer.'
        : 'Every event this tracker writes for you through this client will say via: other beside custody: hosted, with the name the client gave. No product is witnessed.';
      $('loading').hidden = true;
      $('ask').hidden = false;
      $('address').focus();
    })
    .catch(function (e) { fail(e.message); });
  var answer = function (allow) {
    var params = {};
    new URLSearchParams(query).forEach(function (v, k) { params[k] = v; });
    params.allow = allow;
    params.address = $('address').value.trim();
    $('err').hidden = true;
    fetch('/oauth/authorize', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j.redirect) location.href = j.redirect;
        else fail(j.error || 'The tracker did not answer.');
      })
      .catch(function (e) { fail(e.message); });
  };
  $('allow').addEventListener('click', function () { answer(true); });
  $('decline').addEventListener('click', function () { answer(false); });
  $('address').addEventListener('keydown', function (e) { if (e.key === 'Enter') answer(true); });
})();
</script>
</main>
</body>
</html>`;
