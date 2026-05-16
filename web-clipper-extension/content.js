// 全视维 Web Clipper · 内嵌轻量 HTML → Markdown 转换。
// 与桌面端 http://127.0.0.1:33333/clip 接口（X-Clip-Token 鉴权）配套。

(function () {
  function stripTags(html) {
    return String(html || "").replace(/<[^>]+>/g, "");
  }

  function htmlToMarkdown(root) {
    if (!root) return "";
    var clone = root.cloneNode(true);
    // 移除噪声节点
    clone.querySelectorAll("script,style,nav,header,footer,aside,form,iframe,noscript").forEach(function (n) { n.remove(); });
    var html = clone.innerHTML;
    html = html
      .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, function (_, n, t) { return "\n" + "#".repeat(+n) + " " + stripTags(t).trim() + "\n"; })
      .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**")
      .replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, "**$1**")
      .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, "*$1*")
      .replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, "*$1*")
      .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
      .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, function (_, body) { return "\n```\n" + stripTags(body) + "\n```\n"; })
      .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, function (_, body) {
        return stripTags(body).split(/\n+/).map(function (l) { return "> " + l; }).join("\n");
      })
      .replace(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
      .replace(/<img [^>]*src="([^"]*)"[^>]*\/?>/gi, "![]($1)")
      .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<br\s*\/?>/gi, "\n");
    var md = stripTags(html)
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"');
    return md.replace(/\n{3,}/g, "\n\n").trim();
  }

  // 朴素 Readability：选评分最高的 <article>/<main>/含最多 <p> 的容器。
  function readabilityRoot() {
    var candidate = document.querySelector("article") || document.querySelector("main");
    if (candidate) return candidate;
    var all = Array.from(document.querySelectorAll("div,section"));
    var best = document.body, bestScore = 0;
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var ps = el.querySelectorAll(":scope > p").length;
      var text = (el.innerText || "").length;
      var score = ps * 25 + text;
      if (score > bestScore) { bestScore = score; best = el; }
    }
    return best;
  }

  function extractMeta() {
    function meta(name) {
      var el = document.querySelector('meta[name="' + name + '"], meta[property="' + name + '"]');
      return el ? el.getAttribute("content") || "" : "";
    }
    var keywords = meta("keywords") || meta("article:tag");
    var tags = keywords ? keywords.split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean) : [];
    return {
      title: document.title || "",
      url: location.href,
      author: meta("author") || meta("article:author"),
      site: meta("og:site_name"),
      description: meta("description") || meta("og:description"),
      tags: tags,
    };
  }

  // 监听消息
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
      if (!msg || !msg.type) return;
      try {
        if (msg.type === "extract-page") {
          var root = readabilityRoot();
          var meta = extractMeta();
          sendResponse({
            ok: true,
            payload: Object.assign({}, meta, {
              body: htmlToMarkdown(root),
              mode: "page",
            }),
          });
        } else if (msg.type === "extract-selection") {
          var sel = window.getSelection ? window.getSelection() : null;
          var text = sel ? sel.toString() : "";
          var html = "";
          if (sel && sel.rangeCount) {
            var div = document.createElement("div");
            div.appendChild(sel.getRangeAt(0).cloneContents());
            html = div.innerHTML;
          }
          var meta2 = extractMeta();
          sendResponse({
            ok: true,
            payload: Object.assign({}, meta2, {
              body: html ? htmlToMarkdown({ innerHTML: html, cloneNode: function () { return this; }, querySelectorAll: function () { return []; } }) : text,
              mode: "journal",
            }),
          });
        }
      } catch (e) {
        sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
      }
      return true;
    });
  }
})();
