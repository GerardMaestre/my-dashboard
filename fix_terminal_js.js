const fs = require("fs");
let js = fs.readFileSync("src/renderer.js", "utf8");
js = js + `
function toggleTerminal() {
    const drawer = document.getElementById("terminal-drawer");
    const icon = document.getElementById("btn-terminal-icon");
    if (drawer.classList.contains("collapsed")) {
        drawer.classList.remove("collapsed");
        if(icon) icon.style.transform = "rotate(0deg)";
    } else {
        drawer.classList.add("collapsed");
        if(icon) icon.style.transform = "rotate(180deg)";
    }
}
window.toggleTerminal = toggleTerminal;
`;
fs.writeFileSync("src/renderer.js", js, "utf8");

