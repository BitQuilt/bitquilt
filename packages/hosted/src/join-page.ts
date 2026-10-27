/**
 * The page at /join: one button that asks the tracker for an address, and the address shown once it is made. One
 * self-contained document, as the client's page is: nothing is loaded from elsewhere, and what the script puts on the
 * page it sets with `textContent`. The page is a string the on-ramp serves as it is.
 */
export const JOIN_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>An address on this tracker</title>
<style>
body{margin:0;font:17px/1.5 system-ui,sans-serif;background:#eef0f3;color:#17213a}
main{max-width:620px;margin:0 auto;padding:40px 16px}
button{font:inherit;padding:10px 18px;border-radius:6px;border:1.5px solid #2b3f7a;background:#2b3f7a;color:#fff;cursor:pointer}
code{font-family:ui-monospace,Menlo,monospace;overflow-wrap:anywhere}
pre{background:#e3e6eb;padding:12px;border-radius:6px;white-space:pre-wrap;word-break:break-all}
.q{color:#4a546b}
</style>
</head>
<body>
<main>
<h1>An address on this tracker</h1>
<p>For a person who cannot run Quilt. This tracker makes a key, keeps it encrypted, and signs for you until you take the key home. Every event it writes for you says so.</p>
<p><button id="go">Make me an address</button></p>
<div id="out" hidden>
<p>Your address, to paste into your AI's connectors:</p>
<pre id="url"></pre>
<p>Your key's public address: <code id="addr"></code></p>
<p class="q">The address above is the key to your key. Anyone who has it can act as you here. To take the key home, open the address with <code>/key</code> after it, once, and import the secret into Quilt.</p>
</div>
<p id="err" class="q" hidden></p>
<script>
document.getElementById('go').addEventListener('click', function () {
  fetch('/join', { method: 'POST' })
    .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || r.status); return j; }); })
    .then(function (j) {
      document.getElementById('url').textContent = j.url;
      document.getElementById('addr').textContent = j.address;
      document.getElementById('out').hidden = false;
    })
    .catch(function (e) {
      var p = document.getElementById('err');
      p.textContent = e.message;
      p.hidden = false;
    });
});
</script>
</main>
</body>
</html>`;
