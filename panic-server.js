import { ElementType, Parser } from "htmlparser2";
import { DomHandler, Element, Text } from "domhandler";
import http from "http";
import render from "dom-serializer";
import { readFile } from "fs/promises";
import parse from "set-cookie-parser";
import { fetch } from "undici";

let location = new URL("http://localhost:8080/");

async function handleResponse(req, res, body, rawurl, realorigin) {
  try {
    let newreqheaders = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (key === "host") continue; // host is set by the URL
      if (key === "origin") {
        if (realorigin) {
          newreqheaders[key] = "https://" + realorigin;
        } else {
          newreqheaders[key] = rawurl.origin;
        }
      } else if (key === "referer" || key === "referrer") {
        if (realorigin) {
          newreqheaders[key] = "https://" + realorigin + "/";
        } else {
          newreqheaders[key] = rawurl.href;
        }
      } else {
        newreqheaders[key] = value;
      }
    }
    let response = await fetch(rawurl, {
      method: req.method,
      headers: newreqheaders,
      body: body,
      redirect: "manual",
    });
    let newheaders = {};
    for (const [key, value] of response.headers.entries()) {
      if (cspHeaders.includes(key.toLowerCase())) continue;
      newheaders[key] = value;
    }
    if (response.status == 301 || response.status == 302) {
      let location = response.headers.get("location");
      if (location) {
        console.log("Redirecting to " + location);
        res.writeHead(response.status, response.statusText, {
          Location: rewriteUrl(location, { url: rawurl }),
        });
        res.end();
        return;
      }
    }

    let setcookies = response.headers.getSetCookie();
    cookiestore.setCookies(setcookies, rawurl);

    let newbody = response.body;
    if (
      req.headers["sec-fetch-dest"] == "document" ||
      req.headers["sec-fetch-dest"] == "iframe"
    ) {
      if (response.headers.get("content-type")?.includes("text/html")) {
        let bodyText = await response.text();
        newbody = rewriteHtml(bodyText, rawurl);
        console.log("REWROTE HTML");
        newheaders["referrer-policy"] = "unsafe-url";
      }
    }

    if (req.headers["sec-fetch-dest"] == "style") {
      let bodyText = await response.text();
      newbody = rewriteCss(bodyText, {
        url: rawurl,
        origin: rawurl,
      });
      console.log("REWROTE CSS");
    }

    if (req.headers["sec-fetch-dest"] === "script") {
      let bodyText = await response.text();
      newbody = `
  pan_eval((function(){
  ${bodyText}
  }).toString().slice(12, -2), "");
        `;
    }

    if (newbody instanceof ReadableStream) {
      newbody = Buffer.from(await response.arrayBuffer());
    }
    res.writeHead(response.status, response.statusText, newheaders);
    res.end(newbody);
  } catch {}
}

const server = http.createServer(async (req, res) => {
  try {
    let url = new URL(req.url, location);
    if (url.pathname == "/") {
      res.setHeader("Content-Type", "text/html");
      res.end(
        await readFile("./index.html", {
          encoding: "utf-8",
        }),
      );
      return;
    }

    if (url.pathname == "/global-protect/vpn/") {
      // cookie endpoint
      let method = url.searchParams.get("method");
      let host = url.searchParams.get("host");
      let scheme = url.searchParams.get("scheme");
      let path = url.searchParams.get("path");
      let cookieurl = new URL(`${scheme}://${host}${path}`);

      if (req.method === "GET") {
        let cookies = cookiestore.getCookies(cookieurl, false);
        res.setHeader("Content-Type", "text/plain");
        res.end(cookies);
      } else if (req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          cookiestore.setCookies([body], cookieurl);
          res.end();
        });
      }
      return;
    }

    if (url.pathname == "/global-protect/vpn-js/pan_js_all_260s.js") {
      res.setHeader("Content-Type", "application/javascript");
      res.end(
        await readFile("./pan_js_all_260s.js", {
          encoding: "utf-8",
        }),
      );
      return;
    }

    let [_, proto, ...rest] = url.pathname.split("/");
    if (!rest || !proto) throw new Error("Invalid URL format??");
    if (proto != "https" && proto != "http" && proto != "wss") {
      console.error("not a rewritten url " + url.pathname);
      res.writeHead(400, "Bad Request (pan)");
      res.end("bad");
      return;
    }

    let rawurl = new URL(
      `${proto}://${rest.join("/")}${url.search}${url.hash}`,
    );
    let realorigin;
    for (const param of url.searchParams) {
      if (param[0].startsWith("gp-1")) {
        console.log(param[0]);
        rawurl.searchParams.delete(param[0]);
        if (param[0].startsWith("gp-1-o2-")) {
          realorigin = param[0].slice(8);
        }
      }
    }

    let body = undefined;
    if (req.method === "POST" || req.method === "PUT") {
      body = await new Promise((resolve, reject) => {
        let chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("error", (err) => reject(err));
      });
    }

    handleResponse(req, res, body, rawurl, realorigin);
  } catch (err) {
    console.error("Error handling request:", err);
    res.writeHead(500, "Internal Server Error (pan)");
    res.end("Internal Server Error (pan)");
  }
});
server.listen(8080, "localhost", () => {
  console.log("Listening");
});

function rewriteUrl(url, meta) {
  if (typeof url === "string") url = new URL(url, meta.url);
  if (url.protocol == "data:" || url.protocol == "blob:") return url.href;
  return `${location.protocol}//${location.host}/${url.protocol.slice(0, -1)}/${url.host}${url.pathname}${url.search}${url.hash}`;
}

function rewriteCss(css, meta) {
  // regex from vk6 (https://github.com/ading2210)
  const urlRegex = /url\(['"]?(.+?)['"]?\)/gm;
  const Atruleregex =
    /@import\s+(url\s*?\(.{0,9999}?\)|['"].{0,9999}?['"]|.{0,9999}?)($|\s|;)/gm;
  css = new String(css).toString();
  css = css.replace(urlRegex, (match, url) => {
    const encodedUrl = rewriteUrl(url.trim(), meta);

    return match.replace(url, encodedUrl);
  });
  css = css.replace(Atruleregex, (match, importStatement) => {
    return match.replace(
      importStatement,
      importStatement.replace(
        /^(url\(['"]?|['"]|)(.+?)(['"]|['"]?\)|)$/gm,
        (match, firstQuote, url, endQuote) => {
          if (firstQuote.startsWith("url")) {
            return match;
          }
          const encodedUrl = rewriteUrl(url.trim(), meta);

          return `${firstQuote}${encodedUrl}${endQuote}`;
        },
      ),
    );
  });

  return css;
}

export function rewriteHtml(html, url) {
  const handler = new DomHandler((err, dom) => dom);
  const parser = new Parser(handler);

  let meta = {
    url: new URL(url),
  };

  parser.write(html);
  parser.end();
  traverseParsedHtml(handler.root, meta);

  function findhead(node) {
    if (node.type === ElementType.Tag && node.name === "head") {
      return node;
    } else if (node.childNodes) {
      for (const child of node.childNodes) {
        const head = findhead(child);
        if (head) return head;
      }
    }

    return null;
  }

  let head = findhead(handler.root);
  if (!head) {
    head = new Element("head", {}, []);
    handler.root.children.unshift(head);
  }

  let injected = `var _gp_enc_ck_name = "1";
          var __pan_gp_hostname_data = "${location.hostname}";
          var __pan_gp_protocol_data = "${location.protocol}";
          var __pan_gp_protocol_host = "${location.protocol}//${location.host}";
          var __pan_app_hostname_data = "${url.hostname}";
          var __pan_app_protocol_data = "${url.protocol.slice(0, -1)}";
          var __pan_app_port_data = "0";
          var __pan_advanced_mode = "0";
          var __pan_n_url_directory = "0";
          var __pan_cre_engine_ver = "9.0.0";
          var __pan_site_rules = "";
          var __pan_custom_app_domain = undefined;

          XMLHttpRequest.prototype.open = new Proxy(XMLHttpRequest.prototype.open, {
            apply: function (target, thisArg, args) {
              // console.log("XMLHttpRequest send called with args:", args);
              return Reflect.apply(target, thisArg, args);
            }
          });
          `;
  head.children.unshift(
    new Element("script", {
      src: "data:application/javascript;base64," + btoa(injected),
    }),
    new Element("script", { src: "/global-protect/vpn-js/pan_js_all_260s.js" }),
    new Element("script", {
      src:
        "data:application/javascript;base64," +
        btoa(`

        `),
    }),
  );

  return render(handler.root);
}

const cspHeaders = [
  "cross-origin-embedder-policy",
  "cross-origin-opener-policy",
  "cross-origin-resource-policy",
  "content-security-policy",
  "content-security-policy-report-only",
  "expect-ct",
  "feature-policy",
  "origin-isolation",
  "strict-transport-security",
  "upgrade-insecure-requests",
  "x-content-type-options",
  "x-download-options",
  "x-frame-options",
  "x-permitted-cross-domain-policies",
  "x-powered-by",
  "x-xss-protection",
  // This needs to be emulated, but for right now it isn't that important of a feature to be worried about
  // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Clear-Site-Data
  "clear-site-data",

  "content-encoding",
  "content-length",
  "connection",
  "expires",
  "last-modified",
  "report-to",
  "accept-ranges",
  "age",
  "cache-control",
  "alt-svc",
  "keep-alive",
];

const htmlRules = [
  {
    fn: (value, meta) => {
      return rewriteUrl(value, meta);
    },
    // url rewrites
    src: ["embed", "img", "image", "iframe", "source", "input", "track"],
    href: ["a", "link", "area", "use"],
    data: ["object"],
    action: ["form"],
    formaction: ["button", "input", "textarea", "submit"],
    poster: ["video"],
    "xlink:href": ["image"],
  },
  {
    fn: (value, meta) => {
      if (value.startsWith("blob:")) {
        // for media elements specifically they must take the original blob
        // because they can't be fetch'd
        return unrewriteBlob(value);
      }
      return;
      rewriteUrl(value, meta);
    },
    src: ["video", "audio"],
  },
  {
    fn: () => null,
    // csp stuff that must be deleted
    nonce: "*",
    crossorigin: "*",
    integrity: ["script", "link"],
    csp: ["iframe"],
  },
  {
    fn: (value, meta) => rewriteSrcset(value, meta),
    // srcset
    srcset: ["img", "source"],
    srcSet: ["img", "source"],
    imagesrcset: ["link"],
  },
  {
    fn: (value, meta, cookieStore) =>
      rewriteHtml(
        value,
        cookieStore,
        {
          // for srcdoc origin is the origin of the page that the iframe is on. base and path get dropped
          origin: new URL(meta.origin.origin),
          base: new URL(meta.origin.origin),
        },
        true,
      ),
    // srcdoc
    srcdoc: ["iframe"],
  },
  {
    fn: (value, meta) => rewriteCss(value, meta),
    style: "*",
  },
  {
    fn: (value) => {
      if (["_parent", "_top", "_unfencedTop"].includes(value)) return "_self";
    },
    target: ["a", "base"],
  },
];

// i need to add the attributes in during rewriting

function traverseParsedHtml(node, meta) {
  if (node.attribs)
    for (const rule of htmlRules) {
      for (const attr in rule) {
        const sel = rule[attr];
        if (typeof sel === "function") continue;

        if (sel === "*" || sel.includes(node.name)) {
          if (node.attribs[attr] !== undefined) {
            const value = node.attribs[attr];
            const v = rule.fn(value, meta, null);

            if (v === null) delete node.attribs[attr];
            else {
              node.attribs[attr] = v;
            }
            node.attribs[`data-scramjet-${attr}`] = value;
          }
        }
      }
    }

  // if (node.name === "style" && node.children[0] !== undefined)
  //   node.children[0].data = rewriteCss(node.children[0].data, meta);

  if (
    node.name === "script" &&
    /(application|text)\/javascript|module|importmap|undefined/.test(
      node.attribs.type,
    )
  ) {
    if (node.attribs.type == "module") {
      node.attribs.type = "disabled";
    }
    if ("nomodule" in node.attribs) {
      // we don't support modules
      delete node.attribs.nomodule;
    }
    if (node.children[0] !== undefined) {
      let js = node.children[0].data;
      // const htmlcomment = /<!--[\s\S]*?-->/g;
      // js = js.replace(htmlcomment, "");
      // node.children[0].data = rewriteJs(
      //   js,
      //   node.attribs["type"] === "module",
      //   meta,
      // );
    } else if (node.attribs["src"]) {
      let url = rewriteUrl(node.attribs["src"], meta);
      node.attribs["src"] = url;
    }
  }

  if (node.name === "meta" && node.attribs["http-equiv"] != undefined) {
    if (
      node.attribs["http-equiv"].toLowerCase() === "content-security-policy"
    ) {
      node = {};
    } else if (
      node.attribs["http-equiv"] === "refresh" &&
      node.attribs.content.includes("url")
    ) {
      const contentArray = node.attribs.content.split("url=");
      if (contentArray[1])
        contentArray[1] = rewriteUrl(contentArray[1].trim(), meta);
      node.attribs.content = contentArray.join("url=");
    }
  }

  if (node.childNodes) {
    for (const childNode in node.childNodes) {
      node.childNodes[childNode] = traverseParsedHtml(
        node.childNodes[childNode],
        meta,
      );
    }
  }

  return node;
}

export function rewriteSrcset(srcset, meta) {
  const urls = srcset.split(/ [0-9]+x,? ?/g);
  if (!urls) return "";
  const sufixes = srcset.match(/ [0-9]+x,? ?/g);
  if (!sufixes) return "";
  const rewrittenUrls = urls.map((url, i) => {
    if (url && sufixes[i]) {
      return rewriteUrl(url) + sufixes[i];
    }
  });

  return rewrittenUrls.join("");
}

export class CookieStore {
  cookies = {};

  setCookies(cookies, url) {
    for (const str of cookies) {
      const parsed = parse(str);
      const domain = parsed.domain;
      const sameSite = parsed.sameSite;
      const cookie = {
        domain,
        sameSite,
        ...parsed[0],
      };

      if (!cookie.domain) cookie.domain = "." + url.hostname;
      if (!cookie.domain.startsWith(".")) cookie.domain = "." + cookie.domain;
      if (!cookie.path) cookie.path = "/";
      if (!cookie.sameSite) cookie.sameSite = "lax";
      if (cookie.expires) cookie.expires = cookie.expires.toString();

      const id = `${cookie.domain}@${cookie.path}@${cookie.name}`;
      this.cookies[id] = cookie;
    }
  }

  getCookies(url, fromJs) {
    const now = new Date();
    const cookies = Object.values(this.cookies);

    const validCookies = [];

    for (const cookie of cookies) {
      if (cookie.expires && new Date(cookie.expires) < now) {
        delete this.cookies[`${cookie.domain}@${cookie.path}@${cookie.name}`];
        continue;
      }

      if (cookie.secure && url.protocol !== "https:") continue;
      if (cookie.httpOnly && fromJs) continue;
      if (!url.pathname.startsWith(cookie.path)) continue;

      if (cookie.domain.startsWith(".")) {
        if (!url.hostname.endsWith(cookie.domain.slice(1))) continue;
      }

      validCookies.push(cookie);
    }

    return validCookies
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");
  }

  load(cookies) {
    if (typeof cookies === "object") return cookies;
    this.cookies = JSON.parse(cookies);
  }

  dump() {
    return JSON.stringify(this.cookies);
  }
}

let cookiestore = new CookieStore();
