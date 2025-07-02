import epoxyInit, {
  EpoxyClient,
  EpoxyClientOptions,
  EpoxyHandlers,
  EpoxyWebSocket,
} from "https://esm.sh/@mercuryworkshop/epoxy-tls";
import { ElementType, Parser } from "https://esm.sh/htmlparser2";
import { DomHandler, Element, Text } from "https://esm.sh/domhandler";
import render from "https://esm.sh/dom-serializer";

let client;
async function instantiate() {
  await epoxyInit();

  let options = new EpoxyClientOptions();
  client = new EpoxyClient("wss://anura.pro/", options);

  console.log(await client.fetch("https://google.com"));
}
instantiate();

function rewriteUrl(url, meta) {
  if (typeof url === "string") url = new URL(url, meta.url);
  return `${location.protocol}//${location.host}/${url.protocol.slice(0, -1)}/${url.host}${url.pathname}${url.search}${url.hash}`;
}

async function handleRequest(url, request) {
  let response = await client.fetch(url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
  });
  console.log(response);
  let newbody = response.body;
  let newheaders = {};
  for (const [key, value] of response.headers.entries()) {
    if (cspHeaders.includes(key.toLowerCase())) continue;
    newheaders[key] = value;
  }

  if (request.destination == "document" || request.destination == "iframe") {
    if (response.headers.get("content-type")?.startsWith("text/html")) {
      let bodyText = await response.text();
      newbody = rewriteHtml(bodyText, url);
      console.log("REWROTE HTML");
    }
  }
  if (request.destination == "script") {
    let bodyText = await response.text();
    newbody = `
pan_eval((function(){
${bodyText}
}).toString().slice(12, -2), "");
      `;
  }

  return new Response(newbody, {
    status: response.status,
    statusText: response.statusText,
    headers: newheaders,
  });
}

self.addEventListener("fetch", (event) => {
  console.log(event.request.url);
  let url = new URL(event.request.url);

  if (url.pathname == "/global-protect/vpn/") {
    let method = url.searchParams.get("method");
    let host = url.searchParams.get("host");
    let scheme = url.searchParams.get("scheme");
    let path = url.searchParams.get("path");
    if (!method || !host || !scheme || !path) {
      throw new Error("'vpn' Invalid URL parameters??");
    }

    let rawurl = new URL(`${scheme}://${host}${path}${url.search}${url.hash}`);
    console.log("RAWURL 'vpn' " + rawurl.href);

    event.respondWith(client.fetch(rawurl, event.request));
  }

  if (url.pathname == "/global-protect/vpn-js/pan_js_all_260s.js")
    return event.respondWith(fetch("/pan_js_all_260s.js"));
  if (url.pathname == "/" || url.pathname == "/pan_js_all_260s.js") return;

  let [_, proto, ...rest] = url.pathname.split("/");
  if (!rest || !proto) throw new Error("Invalid URL format??");
  if (proto == "https:") proto = "https";
  if (proto != "https" && proto != "http" && proto != "wss")
    throw new Error("Invalid URL protocol??");
  let rawurl = new URL(`${proto}://${rest.join("/")}${url.search}${url.hash}`);
  console.log("RAWURL " + rawurl.href);

  event.respondWith(handleRequest(rawurl, event.request));
});

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
          var __pan_custom_app_domain = undefined;`;
  head.children.unshift(
    new Element("script", {
      src: "data:application/javascript;base64," + btoa(injected),
    }),
    new Element("script", { src: "/pan_js_all_260s.js" }),
    new Element("script", {
      src:
        "data:application/javascript;base64," +
        btoa(`
        window.pan_get_cookie = function() {
        console.log("cookies asked for");
        return "";
        }
        window.pan_set_cookie = function(value) {
          console.log("cookies set to", value);
        }
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
  // {
  //   fn: (value, meta) => rewriteCss(value, meta),
  //   style: "*",
  // },
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
            const v = rule.fn(value, meta, cookieStore);

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
    if (node.children[0] !== undefined) {
      let js = node.children[0].data;
      // node.attribs["data-scramjet-script-source-src"] = bytesToBase64(
      //   new TextEncoder().encode(js),
      // );
      // const htmlcomment = /<!--[\s\S]*?-->/g;
      // js = js.replace(htmlcomment, "");
      // node.children[0].data = rewriteJs(
      //   js,
      //   node.attribs["type"] === "module",
      //   meta,
      // );
    } else if (node.attribs["src"]) {
      let url = rewriteUrl(node.attribs["src"], meta);

      node.attribs["data-scramjet-src"] = node.attribs["src"];
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
