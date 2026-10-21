/*! Hash widget loader. Usage (CDN url + one element):
 *  <script src="https://epicproject.github.io/newapp/embed.js"></script>
 *  1) existing ID:   <div id="0hsz748"></div>   or  <div data-hash-widget="0hsz748"></div>
 *  2) no ID needed:  <div data-hash-widget data-type="button" data-label="Buy now"
 *                         data-bg="#2563eb" data-color="#ffffff"
 *                         data-width="180" data-height="50" data-radius="8" data-font="16"
 *                         data-link="https://example.com" data-target="new|same" data-bold="true"></div>
 *     (data-type: button | input | heading). The loader builds the hash itself.
 * Size comes from the ID / attributes; override with data-width / data-height.
 */
(function () {
  var BASE = 'https://epicproject.github.io/newapp/';
  var B36 = '0123456789abcdefghijklmnopqrstuvwxyz';
  var TYPES = { button: 0, input: 1, heading: 2 };
  var ID_RE = /^[0-2][0-9a-z]{6}(~.*)?$/i; // short-code id: type digit 0-2 + 6 base36 chars, optional ~label

  function size(id) {
    var m = /^([0-9a-z]{7})(~|$)/i.exec(id); if (!m) return null;
    var h = B36.indexOf(m[1][1].toLowerCase()) * 10, w = B36.indexOf(m[1][2].toLowerCase()) * 20;
    return { w: w || 300, h: h + (m[1][0] === '1' ? 4 : 0) };
  }

  // Build an exact hash (#b.<base64url JSON>) from data-* attributes.
  function hashFromAttrs(el) {
    var g = function (k, d) { var v = el.getAttribute('data-' + k); return v == null || v === '' ? d : v; };
    var t = TYPES[String(g('type', 'button')).toLowerCase()];
    var cfg = {
      t: t == null ? 0 : t, h: +g('height', 50), w: +g('width', 0), bg: g('bg', '#2563eb'),
      c: g('color', '#ffffff'), r: +g('radius', 8), f: +g('font', 16), l: g('label', ''),
      u: g('link', ''), o: g('target', 'new') === 'same' ? 1 : 0, b: g('bold', '') === 'true' ? 1 : 0
    };
    var bytes = new TextEncoder().encode(JSON.stringify(cfg)), s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return { id: 'b.' + btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), w: cfg.w || 300, h: cfg.h + (cfg.t === 1 ? 4 : 0) };
  }

  function mount(el) {
    if (el.getAttribute('data-mounted')) return;
    var id = (el.getAttribute('data-hash-widget') || '').replace(/^#/, ''), s;
    if (id) s = size(id) || {};
    else if (el.hasAttribute('data-hash-widget')) { var b = hashFromAttrs(el); id = b.id; s = b; }
    else { id = el.id; s = size(id) || {}; }
    if (!id) return;
    var f = document.createElement('iframe');
    f.src = BASE + '#' + id;
    f.width = el.getAttribute('data-width') || s.w || 300;
    f.height = el.getAttribute('data-height') || s.h || 60;
    f.setAttribute('frameborder', '0'); f.setAttribute('scrolling', 'no');
    f.setAttribute('allow', 'autoplay; fullscreen'); f.setAttribute('allowfullscreen', '');   // media clips need these
    f.style.border = '0'; f.style.maxWidth = '100%';
    el.appendChild(f); el.setAttribute('data-mounted', '1');
  }
  function run() {
    [].forEach.call(document.querySelectorAll('[data-hash-widget], [id]'), function (el) {
      if (el.hasAttribute('data-hash-widget') || ID_RE.test(el.id)) mount(el);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
  window.HashWidgets = { mount: run };
})();
