import { ElementType, Parser } from "htmlparser2";
import { DomHandler, Element, Text } from "domhandler";
import render from "dom-serializer";
import http from "node:http";
import { readFile } from "node:fs/promises";
import parse from "set-cookie-parser";
import { fetch } from "undici";
//import babel from "@babel/core";

const PAN_PATH = "/global-protect/vpn-js/";
const PAN_BUNDLE = "pan_js_all_260s.js";
const PORT = 8080;
const HOST = "0.0.0.0";
// MODIFY THIS TO WHERE YOU'RE RUNNING IT
const location = new URL("http://localhost:8080/");

async function handleResponse(req, res, body, rawurl, realOrigin) {
	try {
		const newReqHeaders = {};
		for (const [key, value] of Object.entries(req.headers)) {
			if (key === "host") continue; // host is set by the URL
			if (key === "origin") {
				if (realOrigin) {
					newReqHeaders[key] = `https://${realOrigin}`;
				} else {
					newReqHeaders[key] = rawurl.origin;
				}
			} else if (key === "referer" || key === "referrer") {
				if (realOrigin) {
					newReqHeaders[key] = `https://${realOrigin}/`;
				} else {
					newReqHeaders[key] = rawurl.href;
				}
			} else {
				newReqHeaders[key] = value;
			}
		}
		newReqHeaders.cookie = cookiestore.getCookies(rawurl, false);
		const response = await fetch(rawurl, {
			method: req.method,
			headers: newReqHeaders,
			body: body,
			redirect: "manual",
		});
		const newHeaders = {};
		for (const [key, value] of response.headers.entries()) {
			if (cspHeaders.includes(key.toLowerCase())) continue;
			newHeaders[key] = value;
		}
		if (response.status === 301 || response.status === 302) {
			const location = response.headers.get("location");
			if (location) {
				console.log(`Redirecting to ${location}`);
				res.writeHead(response.status, response.statusText, {
					Location: rewriteUrl(location, { url: rawurl }),
				});
				res.end();
				return;
			}
		}

		const setcookies = response.headers.getSetCookie();
		cookiestore.setCookies(setcookies, rawurl);

		let newBody = response.body;
		if (
			req.headers["sec-fetch-dest"] === "document" ||
			req.headers["sec-fetch-dest"] === "iframe"
		) {
			if (response.headers.get("content-type")?.includes("text/html")) {
				const bodyText = await response.text();
				newBody = rewriteHtml(bodyText, rawurl);
				console.info("REWROTE HTML");
				newHeaders["referrer-policy"] = "unsafe-url";
			}
		}

		if (req.headers["sec-fetch-dest"] === "style") {
			const bodyText = await response.text();
			newBody = rewriteCss(bodyText, {
				url: rawurl,
				origin: rawurl,
			});
			console.info("REWROTE CSS");
		}

		if (req.headers["sec-fetch-dest"] === "script") {
			const bodyText = await response.text();
			newBody = rewriteJs(bodyText);
		}

		if (newBody instanceof ReadableStream) {
			newBody = Buffer.from(await response.arrayBuffer());
		}
		res.writeHead(response.status, response.statusText, newHeaders);
		res.end(newBody);
	} catch {}
}

const server = http.createServer(async (req, res) => {
	try {
		const url = new URL(req.url, location);
		if (url.pathname === "/") {
			res.setHeader("Content-Type", "text/html");
			res.end(
				`<h1>PANic!</h1>
        <a href="https://github.com/MercuryWorkshop/panic">experimental web proxy</a><br>
        <script>
        ${rewriteUrl.toString()}
        </script>
        <input id="input" />
        <button onclick="window.open(rewriteUrl(input.value, {url: location}))">go</button>
        `,
			);
			return;
		}
		// sandboxing
		if (url.pathname.startsWith("client.js")) {
			res.setHeader("Content-Type", "application/javascript");
			res.end(await readFile("./client.js", "utf-8"));
			return;
		}

		if (url.pathname === "/global-protect/vpn/") {
			// cookie endpoint
			const _method = url.searchParams.get("method");
			const host = url.searchParams.get("host");
			const scheme = url.searchParams.get("scheme");
			const path = url.searchParams.get("path");
			const cookieurl = new URL(`${scheme}://${host}${path}`);

			if (req.method === "GET") {
				const cookies = cookiestore.getCookies(cookieurl, false);
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

		if (url.pathname === `${PAN_PATH}${PAN_BUNDLE}`) {
			res.setHeader("Content-Type", "application/javascript");
			res.end(
				await readFile(`./${PAN_BUNDLE}`, {
					encoding: "utf-8",
				}),
			);
			return;
		}

		const [_, proto, ...rest] = url.pathname.split("/");
		if (!rest || !proto) throw new Error("Invalid URL format??");
		if (proto !== "https" && proto !== "http" && proto !== "wss") {
			console.error(`not a rewritten url ${url.pathname}`);
			res.writeHead(400, "Bad Request (pan)");
			res.end("bad");
			return;
		}

		const rawUrl = new URL(
			`${proto}://${rest.join("/")}${url.search}${url.hash}`,
		);
		let realOrigin;
		for (const param of url.searchParams) {
			if (param[0].startsWith("gp-1")) {
				rawUrl.searchParams.delete(param[0]);
				if (param[0].startsWith("gp-1-o2-")) {
					realOrigin = param[0].slice(8);
				}
			}
		}

		let body = undefined;
		if (req.method === "POST" || req.method === "PUT") {
			body = await new Promise((resolve, reject) => {
				const chunks = [];
				req.on("data", (chunk) => chunks.push(chunk));
				req.on("end", () => resolve(Buffer.concat(chunks)));
				req.on("error", (err) => reject(err));
			});
		}

		handleResponse(req, res, body, rawUrl, realOrigin);
	} catch (err) {
		console.error("Error handling request:", err);
		res.writeHead(500, "Internal Server Error (pan)");
		res.end("Internal Server Error (pan)");
	}
});
server.listen(8080, "0.0.0.0", () => {
	console.log("Listening");
});

//
// rewriter logic below
// mostly ripped from scramjet
//

function rewriteJs(text) {
	return `pan_eval((function(){
  ${text}
  }).toString().slice(12, -2), "");`;
}

function rewriteUrl(rawUrl, meta) {
	const url = typeof rawUrl === "string" ? new URL(rawUrl, meta.url) : rawUrl;
	if (url.protocol === "data:" || url.protocol === "blob:") return url.href;
	return `${location.protocol}//${location.host}/${url.protocol.slice(0, -1)}/${url.host}${url.pathname}${url.search}${url.hash}`;
}

const CSS_URL_REGEX = /url\(['"]?(.+?)['"]?\)/gm;
const CSS_AT_RULE_REGEX =
	/@import\s+(url\s*?\(.{0,9999}?\)|['"].{0,9999}?['"]|.{0,9999}?)($|\s|;)/gm;
function rewriteCss(css, meta) {
	// regex from vk6 (https://github.com/ading2210)
	const urlRegex = CSS_URL_REGEX;

	const cssStr = new String(css).toString();
	const rewrittenCSS1 = cssStr.replace(urlRegex, (match, url) => {
		const encodedUrl = rewriteUrl(url.trim(), meta);
		return match.replace(url, encodedUrl);
	});
	const rewrittenCSS2 = rewrittenCSS1.replace(
		CSS_AT_RULE_REGEX,
		(match, importStatement) => {
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
		},
	);
	return rewrittenCSS2;
}

function rewriteHtml(html, url) {
	const handler = new DomHandler((err, dom) => dom);
	const parser = new Parser(handler);

	const meta = {
		url: new URL(url),
	};

	parser.write(html);
	parser.end();
	traverseHtml(handler.root, meta);

	function findhead(node) {
		if (node.type === ElementType.Tag && node.name === "head") {
			return node;
		}
		if (node.childNodes) {
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

	const injected = /* js */ `var _gp_enc_ck_name = "1";
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
			src: `data:application/javascript;base64,${btoa(injected)}`,
		}),
		new Element("script", { src: `${PAN_PATH}${PAN_BUNDLE}` }),
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
		fn: (value, meta) => rewriteUrl(value, meta),
		src: ["embed", "img", "image", "iframe", "source", "input", "track"],
		href: ["a", "link", "area", "use"],
		data: ["object"],
		action: ["form"],
		formaction: ["button", "input", "textarea", "submit"],
		poster: ["video"],
		"xlink:href": ["image"],
	},
	{
		fn: (value, meta) => rewriteUrl(value, meta),
		src: ["video", "audio"],
	},
	{
		fn: () => null,
		nonce: "*",
		crossorigin: "*",
		integrity: ["script", "link"],
		csp: ["iframe"],
	},
	{
		fn: (value, meta) => rewriteSrcset(value, meta),
		srcset: ["img", "source"],
		srcSet: ["img", "source"],
		imagesrcset: ["link"],
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

function traverseHtml(node, meta) {
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
					}
				}
			}
		}
	if (node.name === "base")
		node.attribs.href = rewriteUrl(node.attribs.href, meta);
	if (node.name === "style" && node.children[0] !== undefined)
		node.children[0].data = rewriteCss(node.children[0].data, meta);
	if (
		node.name === "script" &&
		/(application|text)\/javascript|module|importmap|undefined/.test(
			node.attribs.type,
		)
	) {
		if (node.attribs.type === "module") node.attribs.type = "disabled";
		if ("nomodule" in node.attribs) node.attribs.nomodule = undefined;
		if (node.children[0] !== undefined) {
			let js = node.children[0].data;
			const htmlcomment = /<!--[\s\S]*?-->/g;
			js = js.replace(htmlcomment, "");
			node.children[0].data = rewriteJs(js);
		} else if (node.attribs.src) {
			const url = rewriteUrl(node.attribs.src, meta);
			node.attribs.src = url;
		}
	}

	if (node.name === "meta" && node.attribs["http-equiv"] !== undefined) {
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

	if (node.childNodes)
		for (const childNode in node.childNodes)
			node.childNodes[childNode] = traverseHtml(
				node.childNodes[childNode],
				meta,
			);
	return node;
}

function rewriteSrcset(srcset, meta) {
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

class CookieStore {
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

			if (!cookie.domain) cookie.domain = `.${url.hostname}`;
			if (!cookie.domain.startsWith(".")) cookie.domain = `.${cookie.domain}`;
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
const cookiestore = new CookieStore();
