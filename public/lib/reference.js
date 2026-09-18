// Lookup tables developers keep a tab open for.

import { report } from "./report.js";

export const MIME_TYPES = {
  aac: "audio/aac", abw: "application/x-abiword", apng: "image/apng", arc: "application/x-freearc", avif: "image/avif", avi: "video/x-msvideo",
  azw: "application/vnd.amazon.ebook", bin: "application/octet-stream", bmp: "image/bmp", bz: "application/x-bzip", bz2: "application/x-bzip2",
  cda: "application/x-cdf", csh: "application/x-csh", css: "text/css", csv: "text/csv", doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", eot: "application/vnd.ms-fontobject", epub: "application/epub+zip",
  gz: "application/gzip", gif: "image/gif", htm: "text/html", html: "text/html", ico: "image/vnd.microsoft.icon", ics: "text/calendar",
  jar: "application/java-archive", jpeg: "image/jpeg", jpg: "image/jpeg", js: "text/javascript", json: "application/json", jsonld: "application/ld+json",
  md: "text/markdown", mid: "audio/midi", midi: "audio/midi", mjs: "text/javascript", mp3: "audio/mpeg", mp4: "video/mp4", mpeg: "video/mpeg",
  mpkg: "application/vnd.apple.installer+xml", odp: "application/vnd.oasis.opendocument.presentation", ods: "application/vnd.oasis.opendocument.spreadsheet",
  odt: "application/vnd.oasis.opendocument.text", oga: "audio/ogg", ogv: "video/ogg", ogx: "application/ogg", opus: "audio/ogg", otf: "font/otf",
  png: "image/png", pdf: "application/pdf", php: "application/x-httpd-php", ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", rar: "application/vnd.rar", rtf: "application/rtf",
  sh: "application/x-sh", svg: "image/svg+xml", tar: "application/x-tar", tif: "image/tiff", tiff: "image/tiff", ts: "video/mp2t", ttf: "font/ttf",
  txt: "text/plain", vsd: "application/vnd.visio", wav: "audio/wav", weba: "audio/webm", webm: "video/webm", webp: "image/webp", woff: "font/woff",
  woff2: "font/woff2", xhtml: "application/xhtml+xml", xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xml: "application/xml", xul: "application/vnd.mozilla.xul+xml",
  yaml: "application/yaml", yml: "application/yaml", zip: "application/zip", "3gp": "video/3gpp", "3g2": "video/3gpp2", "7z": "application/x-7z-compressed",
  toml: "application/toml", wasm: "application/wasm", ndjson: "application/x-ndjson", sql: "application/sql", tsv: "text/tab-separated-values",
};

export function lookupMime(query) {
  const term = query.trim().toLowerCase().replace(/^[.*]/, "");
  if (!term) throw new Error("Enter a file extension or media type");
  const matches = Object.entries(MIME_TYPES).filter(([extension, type]) => extension === term || type === term || extension.includes(term) || type.includes(term));
  if (!matches.length) return report([["No match", `Nothing matches "${query}". Unknown binary content should use application/octet-stream.`]]);
  return report(matches.map(([extension, type]) => [`.${extension}`, type]));
}

export const HTTP_STATUS = {
  100: ["Continue", "The client should continue with its request."],
  101: ["Switching Protocols", "The server is switching protocols as requested by Upgrade."],
  102: ["Processing", "WebDAV: the server has accepted the request but has not completed it."],
  103: ["Early Hints", "Preload hints sent before the final response."],
  200: ["OK", "The request succeeded."],
  201: ["Created", "The request succeeded and a new resource was created."],
  202: ["Accepted", "The request was accepted for processing but is not complete."],
  203: ["Non-Authoritative Information", "Metadata came from a copy rather than the origin."],
  204: ["No Content", "Success with no body to return."],
  205: ["Reset Content", "The client should reset the document view."],
  206: ["Partial Content", "The body carries only the requested byte range."],
  207: ["Multi-Status", "WebDAV: the body carries several independent statuses."],
  208: ["Already Reported", "WebDAV: members were already enumerated."],
  226: ["IM Used", "The response is the result of instance manipulations."],
  300: ["Multiple Choices", "The request has more than one possible response."],
  301: ["Moved Permanently", "The resource has a new permanent URL."],
  302: ["Found", "The resource is temporarily at a different URL."],
  303: ["See Other", "Fetch the result with GET from another URL."],
  304: ["Not Modified", "The cached copy is still valid."],
  307: ["Temporary Redirect", "Same as 302 but the method must not change."],
  308: ["Permanent Redirect", "Same as 301 but the method must not change."],
  400: ["Bad Request", "The server could not understand the request."],
  401: ["Unauthorized", "Authentication is required and has failed or not been supplied."],
  402: ["Payment Required", "Reserved for future or provider-specific use."],
  403: ["Forbidden", "The server understood the request but refuses to authorise it."],
  404: ["Not Found", "The server cannot find the requested resource."],
  405: ["Method Not Allowed", "The method is known but not supported for this resource."],
  406: ["Not Acceptable", "No representation matches the Accept headers."],
  407: ["Proxy Authentication Required", "Authentication with the proxy is required."],
  408: ["Request Timeout", "The server timed out waiting for the request."],
  409: ["Conflict", "The request conflicts with the current state of the resource."],
  410: ["Gone", "The resource has been permanently removed."],
  411: ["Length Required", "Content-Length is required."],
  412: ["Precondition Failed", "A conditional header did not match."],
  413: ["Content Too Large", "The payload exceeds the server limit."],
  414: ["URI Too Long", "The request target is longer than the server accepts."],
  415: ["Unsupported Media Type", "The payload format is not supported."],
  416: ["Range Not Satisfiable", "The requested range cannot be served."],
  417: ["Expectation Failed", "The Expect header cannot be met."],
  418: ["I'm a teapot", "An April Fools' joke from RFC 2324 that stuck around."],
  421: ["Misdirected Request", "The request was sent to a server that cannot answer it."],
  422: ["Unprocessable Content", "The request was well formed but semantically invalid."],
  423: ["Locked", "WebDAV: the resource is locked."],
  424: ["Failed Dependency", "WebDAV: a dependent request failed."],
  425: ["Too Early", "The server will not risk processing a replayed request."],
  426: ["Upgrade Required", "The client must switch protocols."],
  428: ["Precondition Required", "The request must be conditional."],
  429: ["Too Many Requests", "The client has sent too many requests in a given period."],
  431: ["Request Header Fields Too Large", "The headers are too large to process."],
  451: ["Unavailable For Legal Reasons", "Access is denied for legal reasons."],
  500: ["Internal Server Error", "The server hit an unexpected condition."],
  501: ["Not Implemented", "The server does not support the request method."],
  502: ["Bad Gateway", "An upstream server returned an invalid response."],
  503: ["Service Unavailable", "The server is not ready to handle the request."],
  504: ["Gateway Timeout", "An upstream server did not respond in time."],
  505: ["HTTP Version Not Supported", "The HTTP version is not supported."],
  506: ["Variant Also Negotiates", "Content negotiation is misconfigured."],
  507: ["Insufficient Storage", "WebDAV: the server cannot store the representation."],
  508: ["Loop Detected", "WebDAV: an infinite loop was detected."],
  510: ["Not Extended", "Further extensions are required."],
  511: ["Network Authentication Required", "The client must authenticate to gain network access."],
};

export function lookupStatus(query) {
  const term = query.trim().toLowerCase();
  const entries = Object.entries(HTTP_STATUS);
  const matches = term
    ? entries.filter(([code, [name, description]]) => code.startsWith(term) || name.toLowerCase().includes(term) || description.toLowerCase().includes(term))
    : entries;
  if (!matches.length) return report([["No match", `No HTTP status matches "${query}".`]]);
  const classOf = (code) => ({ 1: "Informational", 2: "Success", 3: "Redirection", 4: "Client error", 5: "Server error" })[code[0]];
  const tone = (code) => (code[0] === "2" ? "good" : code[0] === "4" || code[0] === "5" ? "bad" : undefined);
  return report(matches.map(([code, [name, description]]) => [code, `${name} — ${classOf(code)}. ${description}`, tone(code)]));
}

export const KEY_CODES = [
  [8, "Backspace"], [9, "Tab"], [13, "Enter"], [16, "Shift"], [17, "Control"], [18, "Alt"], [19, "Pause"], [20, "CapsLock"],
  [27, "Escape"], [32, "Space"], [33, "PageUp"], [34, "PageDown"], [35, "End"], [36, "Home"], [37, "ArrowLeft"], [38, "ArrowUp"],
  [39, "ArrowRight"], [40, "ArrowDown"], [45, "Insert"], [46, "Delete"], [91, "Meta (left)"], [92, "Meta (right)"], [93, "ContextMenu"],
  [144, "NumLock"], [145, "ScrollLock"], [186, "; :"], [187, "= +"], [188, ", <"], [189, "- _"], [190, ". >"], [191, "/ ?"],
  [192, "` ~"], [219, "[ {"], [220, "\\ |"], [221, "] }"], [222, "' \""],
];

export function lookupKeyCode(query) {
  const term = query.trim();
  if (!term) {
    const rows = [...KEY_CODES, ...Array.from({ length: 12 }, (_, index) => [112 + index, `F${index + 1}`])].sort((a, b) => a[0] - b[0]);
    return report(["Press a key in the input above, or search by name.", "", ...rows.map(([code, name]) => [String(code), name])]);
  }
  if (/^\d+$/.test(term)) {
    const code = Number(term);
    const known = KEY_CODES.find(([value]) => value === code);
    const printable = code >= 48 && code <= 90 ? String.fromCharCode(code) : null;
    const functionKey = code >= 112 && code <= 123 ? `F${code - 111}` : null;
    return report([
      ["keyCode", String(code), "accent"],
      ["Name", known?.[1] ?? functionKey ?? printable ?? "unassigned"],
      ["event.key", printable ? printable.toLowerCase() : known?.[1] ?? functionKey ?? "—"],
      ["event.code", printable ? (/\d/.test(printable) ? `Digit${printable}` : `Key${printable}`) : known?.[1] ?? functionKey ?? "—"],
      ["Hex", `0x${code.toString(16).toUpperCase()}`],
      "",
      ["Note", "keyCode is deprecated — prefer event.key for characters and event.code for physical keys."],
    ]);
  }
  const matches = KEY_CODES.filter(([, name]) => name.toLowerCase().includes(term.toLowerCase()));
  if (!matches.length) return report([["No match", `No key matches "${query}".`]]);
  return report(matches.map(([code, name]) => [String(code), name]));
}

export const WELL_KNOWN_PORTS = [
  [20, "FTP data"], [21, "FTP control"], [22, "SSH / SFTP"], [23, "Telnet"], [25, "SMTP"], [53, "DNS"], [67, "DHCP server"], [68, "DHCP client"],
  [69, "TFTP"], [80, "HTTP"], [110, "POP3"], [119, "NNTP"], [123, "NTP"], [143, "IMAP"], [161, "SNMP"], [389, "LDAP"], [443, "HTTPS"],
  [445, "SMB"], [465, "SMTPS"], [514, "Syslog"], [587, "SMTP submission"], [636, "LDAPS"], [993, "IMAPS"], [995, "POP3S"],
  [1433, "Microsoft SQL Server"], [1521, "Oracle"], [2049, "NFS"], [2375, "Docker (plain)"], [2376, "Docker (TLS)"], [3000, "Node dev server"],
  [3306, "MySQL / MariaDB"], [3389, "RDP"], [4200, "Angular dev server"], [5000, "Flask / .NET dev"], [5173, "Vite dev server"],
  [5432, "PostgreSQL"], [5672, "AMQP / RabbitMQ"], [6379, "Redis"], [8000, "HTTP alternate"], [8080, "HTTP proxy / Tomcat"],
  [8443, "HTTPS alternate"], [9000, "SonarQube / PHP-FPM"], [9092, "Kafka"], [9200, "Elasticsearch"], [11211, "Memcached"], [27017, "MongoDB"],
];

export function lookupPort(query) {
  const term = query.trim().toLowerCase();
  const matches = term
    ? WELL_KNOWN_PORTS.filter(([port, service]) => String(port).startsWith(term) || service.toLowerCase().includes(term))
    : WELL_KNOWN_PORTS;
  if (!matches.length) return report([["No match", `No well-known service matches "${query}". Ports 49152–65535 are ephemeral and unassigned.`]]);
  return report(matches.map(([port, service]) => [String(port), service]));
}
