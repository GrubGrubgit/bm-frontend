// L3 WebGL renderer: uploads the 256x240 RGBA guest framebuffer (SPEC
// section 5 bm_video_ptr path: CHR/palette/scroll/OAM compositing already
// happened in the C adapter, oracle-verified) and presents it with scaling
// + filter modes. No game code; consumes video bytes only.
// Modes: scale integer|fit|fill|stretch, filter nearest|bilinear.
// Canvas backing store is set in device pixels by resize(); rect math is
// in device pixels so Integer stays exact under any devicePixelRatio.
var GW = 256, GH = 240;
// CRT overscan view: hide 8px on every side (real TVs + jsnes clipToTvSize
// black these out; tiles there are never meant to be seen). Upload stays
// full-frame (digest/oracle compare full bytes); only the VIEW crops.
var VW = 240, VH = 224, OX = 8, OY = 8;
var VS = "attribute vec2 p;attribute vec2 t;varying vec2 v_t;" +
  "void main(){v_t=t;gl_Position=vec4(p,0.0,1.0);}";
var FS = "precision mediump float;uniform sampler2D u_tex;varying vec2 v_t;" +
  "void main(){gl_FragColor=texture2D(u_tex,v_t);}";
function shader(gl, type, src) {
  var s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error("shader:" + gl.getShaderInfoLog(s));
  }
  return s;
}
export function VideoRenderer(canvas) {
  this.cv = canvas;
  this.lost = false;
  this.onEvent = null;
  var self = this;
  if (canvas.isConnected !== false) {
  canvas.addEventListener("webglcontextlost", function (e) {
    if (!self._noRestore) { try { e.preventDefault(); } catch (err) {} }
    self.lost = true;
    if (self.onEvent) { try { self.onEvent("lost"); } catch (err) {} }
  });
  canvas.addEventListener("webglcontextrestored", function () {
    try { self.initGL(); } catch (err) {}
    self.lost = false;
    if (self.onEvent) { try { self.onEvent("restored"); } catch (err) {} }
  });
  }
  var gl = canvas.getContext("webgl", { preserveDrawingBuffer: true, antialias: false, alpha: true, depth: false, stencil: false });
  if (!gl) throw new Error("no-webgl");
  this.gl = gl;
  var noR = false;
  try {
    var di = gl.getExtension("WEBGL_debug_renderer_info");
    var rn = di ? gl.getParameter(di.UNMASKED_RENDERER_WEBGL) : "";
    noR = /swiftshader/i.test(String(rn || ""));
  } catch (err) {}
  this._noRestore = noR;
  this.initGL();
  this.scale = "integer";
  this.filter = "nearest";
  this.frames = 0;
  this.fpsT0 = 0;
  this.fps = 0;
  this.lastDigest = "0";
  this.applyFilter();
}

VideoRenderer.prototype.initGL = function () {
  var gl = this.gl;
  var prog = this.prog = gl.createProgram();
  gl.attachShader(prog, shader(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, shader(gl, gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("link:" + gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  var vb = this.vbuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, OX/GW, OY/GH, 1, -1, (OX+VW)/GW, OY/GH, -1, 1, OX/GW, (OY+VH)/GH, 1, 1, (OX+VW)/GW, (OY+VH)/GH]), gl.STATIC_DRAW);
  var lp = gl.getAttribLocation(prog, "p"), lt = gl.getAttribLocation(prog, "t");
  gl.enableVertexAttribArray(lp);
  gl.enableVertexAttribArray(lt);
  gl.vertexAttribPointer(lp, 2, gl.FLOAT, false, 16, 0);
  gl.vertexAttribPointer(lt, 2, gl.FLOAT, false, 16, 8);
  this.lp = lp; this.lt = lt;
  var tex = this.tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, GW, GH, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(GW * GH * 4));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  this.applyFilter();
};
VideoRenderer.prototype.applyFilter = function () {
  var gl = this.gl;
  var f = this.filter === "bilinear" ? gl.LINEAR : gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
};
VideoRenderer.prototype.setMode = function (scale, filter) {
  if (scale) this.scale = scale;
  if (filter) { this.filter = filter; this.applyFilter(); }
};
VideoRenderer.prototype.resize = function (cssW, cssH, dpr) {
  var d = dpr || 1;
  this.cv.width = Math.max(1, Math.round(cssW * d));
  this.cv.height = Math.max(1, Math.round(cssH * d));
  this.cv.style.width = cssW + "px";
  this.cv.style.height = cssH + "px";
};
VideoRenderer.prototype.rect = function () {
  var dw = this.cv.width, dh = this.cv.height, rw, rh;
  if (this.scale === "stretch") { rw = dw; rh = dh; }
  else if (this.scale === "fit") { var s = Math.min(dw / VW, dh / VH); rw = Math.round(VW * s); rh = Math.round(VH * s); }
  else if (this.scale === "fill") { var s2 = Math.max(dw / VW, dh / VH); rw = Math.round(VW * s2); rh = Math.round(VH * s2); }
  else { var k = Math.max(1, Math.floor(Math.min(dw / VW, dh / VH))); rw = VW * k; rh = VH * k; }
  return { x: Math.round((dw - rw) / 2), y: Math.round((dh - rh) / 2), w: rw, h: rh };
};
VideoRenderer.prototype.upload = function (rgba) {
  var gl = this.gl;
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, GW, GH, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(rgba));
  var h = 2166136261, i;
  for (i = 0; i < rgba.length; i++) { h ^= rgba[i]; h = Math.imul(h, 16777619); }
  this.lastDigest = (h >>> 0).toString(16);
};
VideoRenderer.prototype.present = function () {
  var gl = this.gl, r = this.rect();
  var es = [];
  gl.bindTexture(gl.TEXTURE_2D, this.tex);
  gl.useProgram(this.prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, this.vbuf);
  gl.enableVertexAttribArray(this.lp);
  gl.enableVertexAttribArray(this.lt);
  gl.vertexAttribPointer(this.lp, 2, gl.FLOAT, false, 16, 0);
  gl.vertexAttribPointer(this.lt, 2, gl.FLOAT, false, 16, 8);
  gl.disable(gl.BLEND);
  gl.disable(gl.CULL_FACE);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.DITHER);
  gl.disable(gl.SCISSOR_TEST);
  gl.viewport(0, 0, this.cv.width, this.cv.height); es.push(gl.getError());
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT); es.push(gl.getError());
  gl.viewport(r.x, r.y, r.w, r.h); es.push(gl.getError());
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); es.push(gl.getError());
  this.lastSteps = es;
  this.frames++;
  var now = performance.now();
  if (!this.fpsT0) this.fpsT0 = now;
  else if (now - this.fpsT0 >= 1000) { this.fps = this.frames * 1000 / (now - this.fpsT0); this.frames = 0; this.fpsT0 = now; }
  var e2 = gl.getError();
  this.lastSteps.push(e2);
  return e2;
};
VideoRenderer.prototype.readRect = function (x, y, w, h) {
  var gl = this.gl, out = new Uint8Array(w * h * 4);
  gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
  return out;
};
VideoRenderer.prototype.enterFullscreen = function (el) {
  var t = el || this.cv;
  if (t.requestFullscreen) return t.requestFullscreen();
  return Promise.reject(new Error("no-fullscreen-api"));
};
VideoRenderer.prototype.exitFullscreen = function () {
  if (document.fullscreenElement && document.exitFullscreen) return document.exitFullscreen();
  return Promise.resolve();
};
