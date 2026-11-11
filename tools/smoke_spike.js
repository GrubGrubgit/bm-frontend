const fs = require("fs");
const f = process.argv[2] || "build/bm_spike.wasm";
WebAssembly.instantiate(fs.readFileSync(f), {}).then(m => {
  const e = m.instance.exports;
  const checks = [
    ["add", e.bm_spike_add(40, 2) === 42],
    ["nmi_tail", (() => { e.bm_spike_init(); return e.bm_spike_nmi_tail() === 1; })()],
    ["irq", e.bm_spike_irq() === 1],
  ];
  for (const [n, ok] of checks) console.log((ok ? "PASS" : "FAIL") + " " + n);
  if (!checks.every(c => c[1])) process.exit(1);
  console.log("SPIKE-OK " + f);
}).catch(err => { console.error("FAIL instantiate", err); process.exit(1); });
