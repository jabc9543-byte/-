const fs = require("fs");
const files = ["src-tauri/tauri.conf.json", "package-lock.json"];
for (const f of files) {
  let s = fs.readFileSync(f, "utf8");
  s = s.replace(/"version":\s*"0\.1\.8"/g, '"version": "0.1.9"');
  fs.writeFileSync(f, s);
  console.log("bumped", f);
}
const cargo = "src-tauri/Cargo.toml";
let c = fs.readFileSync(cargo, "utf8");
c = c.replace(/^version = "0\.1\.8"/m, 'version = "0.1.9"');
fs.writeFileSync(cargo, c);
console.log("bumped", cargo);
