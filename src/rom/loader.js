// File picker + drag-drop wiring. DOM only; parsing happens in app.js.
export function wireLoader(o) {
  const read = f => {
    const r = new FileReader();
    r.onload = () => o.onFile(r.result, f.name);
    r.onerror = () => o.onError("read-failed");
    r.readAsArrayBuffer(f);
  };
  o.inputEl.addEventListener("change", () => { if (o.inputEl.files[0]) read(o.inputEl.files[0]); });
  o.dropEl.addEventListener("dragover", e => e.preventDefault());
  o.dropEl.addEventListener("drop", e => {
    e.preventDefault();
    if (e.dataTransfer.files[0]) read(e.dataTransfer.files[0]);
  });
}
