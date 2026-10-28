# bitquilt.org

Three static pages, no build step and no framework, each with its styles and its script inside and fonts from Google Fonts. Serve the folder as it is; GitHub Pages, Vercel or any file server will do, and the plan is the tracker's own host, so that one domain does everything.

- `index.html` is the first screen: the newest problems a tracker carries, each as its strip (a square a piece, a colour a state), read live from the tracker's `/search` route; under them the one button, Get an address, which opens the tracker's `/join` page, and a quieter link to holding your own key.
- `problems.html` is every problem the tracker carries, read live: a search box, each problem's map, its counts, and the `quilt:` link to hand to an AI.
- `how.html` is the long form: what Quilt is, holding your own key (the bundle and the Mac app), how a piece is done, what accepted means, building a client (where Quilt's build-from-source block lives, under `#build`), and the open problem.

The tracker the first two pages read is the `bitquilt:tracker` meta in each page's head (`http://localhost:3977/` until the public tracker stands: one line to change at deployment, in both files), and `?tr=https://your.tracker/` on the address overrides it. Everything read from the tracker is set as text, never as markup; the pages load nothing but JSON from the tracker and fonts from Google. While the tracker is unreachable the first screen says so in a line and stands as it is. The colours of the squares mean what they mean in the app.
