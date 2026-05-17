const fs = require("fs");
const FROM = "0.1.9";
const TO = "0.1.10";

const jsonFiles = ["package.json", "package-lock.json", "src-tauri/tauri.conf.json"];
for (const f of jsonFiles) {
  let s = fs.readFileSync(f, "utf8");
  const re = new RegExp('"version":\\s*"' + FROM + '"', "g");
  if (re.test(s)) {
    s = s.replace(re, `"version": "${TO}"`);
    fs.writeFileSync(f, s);
    console.log("bumped", f);
  } else {
    console.log("(skip, not", FROM + ")", f);
  }
}

const toml = "src-tauri/Cargo.toml";
let c = fs.readFileSync(toml, "utf8");
const tomlRe = new RegExp('^version = "' + FROM + '"', "m");
if (tomlRe.test(c)) {
  c = c.replace(tomlRe, `version = "${TO}"`);
  fs.writeFileSync(toml, c);
  console.log("bumped", toml);
}

const lock = "src-tauri/Cargo.lock";
if (fs.existsSync(lock)) {
  let l = fs.readFileSync(lock, "utf8");
  l = l.replace(
    new RegExp(`(name = "logseq-rs"\\nversion = ")${FROM}(")`, "g"),
    `$1${TO}$2`
  );
  fs.writeFileSync(lock, l);
  console.log("bumped", lock);
}

