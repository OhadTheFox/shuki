#!/bin/sh
# Builds sim/index.html: the app + server bundled into one page that opens as file:// in Simulator Safari.
# Needs sql.js, which the app itself does not: npm install --no-save sql.js
cd "$(dirname "$0")/.."
npx esbuild sim/entry.js public/app.js --bundle --format=iife --outdir=sim/out --loader:.wasm=binary --loader:.sql=text --external:fs --external:path --external:crypto --external:node:* --log-level=warning || exit 1
cat sim/out/sim/entry.js sim/out/public/app.js > sim/bundle.js && rm -r sim/out
sed -e 's#<link rel="manifest"[^>]*>##' -e 's#href="\([a-z]\)#href="../public/\1#g' -e 's#<script type="module" src="app.js"></script>#<script src="bundle.js"></script>#' public/index.html > sim/index.html
ls -la sim/index.html sim/bundle.js
# Fonts can't be fetched cross-file on file://, so the stylesheet carries them inline.
python3 - <<'PY'
import re, base64, pathlib
css = pathlib.Path('public/style.css').read_text()
def inline(m):
    f = pathlib.Path('public') / m.group(1)
    return 'url(data:font/woff2;base64,' + base64.b64encode(f.read_bytes()).decode() + ')'
css = re.sub(r"url\(['\"]?(fonts/[^'\")]+\.woff2)['\"]?\)", inline, css)
css = re.sub(r"url\(['\"]?((?:icons|img)/[^'\")]+)['\"]?\)", r"url(../public/\1)", css)
pathlib.Path('sim/style.css').write_text(css)
PY
sed -i "" -e 's#<link rel="preload"[^>]*>##' -e 's#href="../public/style.css"#href="style.css"#' sim/index.html
