// WebDriver harness: real waits, console gate, screenshot. Zero npm deps.
// usage: PROFILE=<dir> node tools/wd.js <url> <shot.png> <marker> [timeoutMs]
const fs = require("fs");
const { spawn } = require("child_process");
const [url, shot, marker, tmo] = [process.argv[2], process.argv[3], process.argv[4], +(process.argv[5] || 25000)];
const PORT = 9516;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(method, path, body) {
  const r = await fetch("http://127.0.0.1:" + PORT + path, {
    method, headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const j = await r.json();
  if (j.status) throw new Error("wd-status:" + j.status + " " + JSON.stringify(j.value).slice(0, 200));
  return j.value;
}
(async () => {
  const args = ["--port=" + PORT, "--silent"];
  const drv = spawn("chromedriver", args, { stdio: "ignore" });
  await sleep(1500);
  try {
    const chromeArgs = ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--window-size=800,600"];
    if (process.env.PROFILE) chromeArgs.push("--user-data-dir=" + process.env.PROFILE);
    const s = await api("POST", "/session", { capabilities: { alwaysMatch: { browserName: "chrome", "goog:chromeOptions": { args: chromeArgs }, "goog:loggingPrefs": { browser: "ALL" } } } });
    const sid = s.sessionId;
    try {
      await api("POST", "/session/" + sid + "/url", { url });
      const t0 = Date.now();
      let title = "";
      for (;;) {
        title = await api("GET", "/session/" + sid + "/title");
        if (title.indexOf(marker) !== -1) break;
        if (Date.now() - t0 > tmo) throw new Error("TIMEOUT want=" + marker + " last=" + title);
        await sleep(500);
      }
      const logs = await api("POST", "/session/" + sid + "/log", { type: "browser" });
      const bad = logs.filter(e => e.level === "SEVERE" || /Uncaught|Failed to load/.test(e.message || ""));
      if (bad.length > 0) { console.log("CONSOLE-ERRORS:"); for (const e of bad) console.log(e.message.slice(0, 300)); throw new Error("console-errors:" + bad.length); }
      const png = await api("GET", "/session/" + sid + "/screenshot");
      fs.writeFileSync(shot, Buffer.from(png, "base64"));
      console.log("WD-OK marker=" + marker + " shot=" + fs.statSync(shot).size + "B");
    } finally {
      await api("DELETE", "/session/" + sid).catch(() => {});
    }
  } finally {
    drv.kill();
  }
})().catch(e => { console.error("WD-FAIL " + e.message); process.exit(1); });
