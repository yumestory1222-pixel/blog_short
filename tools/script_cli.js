// 블로그 글(마크다운) → 쇼츠 대본 JSON (script.js 재사용)
// 사용: node tools/script_cli.js <글.md> [제목] [길이초]
const fs = require("fs");
const path = require("path");
const S = require(path.join(__dirname, "..", "script.js"));
const [file, title, dur] = process.argv.slice(2);
const md = fs.readFileSync(file, "utf8");
const sc = S.buildScript(md, { title: title || undefined, duration: +dur || 30 });
sc.district = S.detectDistrict(sc.title + " " + md, sc.title);
process.stdout.write(JSON.stringify(sc));
