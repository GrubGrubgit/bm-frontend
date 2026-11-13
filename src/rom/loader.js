// File picker + drag-drop wiring. DOM only; parsing happens in app.js.
// NOTE: the input carries NO accept= filter. Android WebViews honor it and
// the .nes extension has no MIME mapping, which renders ROM files
// unselectable in the system picker (Cordova honors accept types; the old
// hand-built wrapper bypassed them with */*). We accept any file here and
// validate content in pack/builder.js, which rejects non-ROMs with a message.
export function wireLoader(o) {
  const read = f => {
    const r = new FileReader();
    r.onload = () => o.onFile(r.result, f.name);
    r.onerror = () => o.onError("read-failed");
    r.readAsArrayBuffer(f);
  };
  if (o.pickEl) o.pickEl.addEventListener("click", () => {
    o.inputEl.value = ""; // allow re-picking the same file twice in a row
    o.inputEl.click();
  });
  o.inputEl.addEventListener("change", () => { if (o.inputEl.files[0]) read(o.inputEl.files[0]); });
  o.dropEl.addEventListener("dragover", e => e.preventDefault());
  o.dropEl.addEventListener("drop", e => {
    e.preventDefault();
    if (e.dataTransfer.files[0]) read(e.dataTransfer.files[0]);
  });
}
