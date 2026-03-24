
const fs = require('fs');
let css = fs.readFileSync('src/style.css', 'utf8');
css = css.replace('.disk-virtual-viewport {', '.disk-virtual-viewport { position: absolute; left: 0; top: 0;');
fs.writeFileSync('src/style.css', css);

