/**
 * The page a browser gets at a hosted address (the same URL the AI's connector uses): the person's sheet, as the menu
 * bar draws one for a key held at home. Standing, coin and what is owed today; what is wanted from them, each as the
 * sentence to say; the phrases to start with; and the way to take the key home. One self-contained document, as the
 * client's page is: nothing loaded from elsewhere, everything the script puts on the page set with `textContent`.
 * It reads `<address>/sheet` every fifteen seconds while open.
 */
export const SHEET_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Your Quilt</title>
<style>
:root{color-scheme:light dark}
body{margin:0;font:17px/1.5 system-ui,sans-serif;background:#eef0f3;color:#17213a}
main{max-width:680px;margin:0 auto;padding:32px 16px 48px}
h1{font-size:1.5rem;margin:0 0 4px}
h2{font-size:1.05rem;margin:28px 0 8px}
.q{color:#4a546b}
.big{font-size:2rem;font-weight:600;font-variant-numeric:tabular-nums}
.lit{color:#1d7a3a}
.row{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:8px;background:#fff;margin:6px 0}
.row p{margin:0;flex:1}
.row small{display:block;color:#4a546b}
button{font:inherit;padding:6px 12px;border-radius:6px;border:1.5px solid #2b3f7a;background:#2b3f7a;color:#fff;cursor:pointer;white-space:nowrap}
button.plain{background:transparent;color:#2b3f7a}
code{font-family:ui-monospace,Menlo,monospace;overflow-wrap:anywhere}
pre{background:#e3e6eb;padding:12px;border-radius:6px;white-space:pre-wrap;word-break:break-all}
ol{padding-left:1.2em}
@media (prefers-color-scheme: dark){body{background:#151922;color:#e6e9f0}.row{background:#1e2330}.q,.row small{color:#aab2c5}pre{background:#262c3a}button.plain{color:#9fb4ff;border-color:#9fb4ff}.lit{color:#5fd38a}}
</style>
</head>
<body>
<main>
<h1>Your Quilt</h1>
<p class="q" id="who">Reading your sheet…</p>
<div id="standing"></div>
<div id="coin"></div>
<div id="state"></div>
<div id="groups"></div>
<h2>Take your key home</h2>
<p class="q">This tracker holds your key and signs for you, and every event it writes for you says so. The key is yours. The Mac app's first screen has "I have an address on a tracker": paste this page's address there and the key moves to your own machine, with the standing and coin it earned. Or open <a id="keyLink" href="#">the key itself</a> once and import it with <code>quilt init --secret</code>, then treat this address as spent.</p>
<p class="q">Anyone who has this address can act as you here. Keep it to yourself.</p>
</main>
<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var el = function (tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  var dataUrl = location.pathname.replace(/\\/+$/, '') + '/sheet';
  $('keyLink').href = location.pathname.replace(/\\/+$/, '') + '/key';
  var copyRow = function (phrase) {
    var row = el('div', 'row');
    var p = el('p');
    p.appendChild(el('span', null, phrase.say));
    var small = el('small', null, phrase.problem ? phrase.problem.title : phrase.about);
    p.appendChild(small);
    row.appendChild(p);
    var b = el('button', null, 'Copy');
    b.addEventListener('click', function () {
      navigator.clipboard.writeText(phrase.say).then(function () { b.textContent = 'Copied'; setTimeout(function () { b.textContent = 'Copy'; }, 1500); });
    });
    row.appendChild(b);
    return row;
  };
  var clock = function (iso) { var d = new Date(iso); return isNaN(d.getTime()) ? iso : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
  var last = null;
  var render = function (s) {
    $('who').textContent = (s.name ? s.name + ', ' : '') + s.address;
    var st = $('standing'); st.textContent = '';
    if (s.standing) {
      st.appendChild(el('div', null, 'Standing ' + s.standing.standing + ', earned by work and not for sale' + (s.standing.locked ? ' (' + s.standing.locked + ' locked behind your claims, ' + s.standing.free + ' free to stake)' : '')));
    } else st.appendChild(el('div', 'q', 'No tracker has answered with your standing yet.'));
    var c = $('coin'); c.textContent = '';
    if (s.coin) {
      var big = el('div', 'big' + (last !== null && s.coin.balance > last ? ' lit' : ''), String(s.coin.balance));
      last = s.coin.balance;
      c.appendChild(big);
      c.appendChild(el('div', 'q', 'coin, in units: ' + s.coin.free_vested + ' transferable now, ' + s.coin.free + ' free to stake or pay'));
      if (s.coin.pending && s.coin.pending.amount > 0) c.appendChild(el('div', 'q', s.coin.pending.amount + ' owed from the squares verified so far today, paid at ' + clock(s.coin.pending.pays_at)));
    }
    var state = $('state'); state.textContent = '';
    var groups = $('groups'); groups.textContent = '';
    if (s.state !== 'connected') {
      state.appendChild(el('h2', null, 'Connect your AI'));
      state.appendChild(el('p', 'q', 'No AI has connected through this address yet. The address of this page is the connector: in claude.ai or Claude Desktop, under Settings, Connectors, choose Add custom connector and paste it. The Claude app on a phone uses the connectors the account has.'));
      state.appendChild(el('p', 'q', 'Then, in a new chat, say:'));
      state.appendChild(copyRow(s.first));
      return;
    }
    s.groups.forEach(function (g) {
      groups.appendChild(el('h2', null, g.title));
      g.phrases.forEach(function (p) { groups.appendChild(copyRow(p)); });
    });
  };
  var load = function () {
    fetch(dataUrl, { headers: { accept: 'application/json' } }).then(function (r) { return r.json(); }).then(render).catch(function () { $('who').textContent = 'The tracker did not answer.'; });
  };
  load();
  setInterval(load, 15000);
})();
</script>
</body>
</html>
`;
