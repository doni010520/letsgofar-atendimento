const HOST = "https://benitechlab.uazapi.com";
const ADMIN = process.env.UAZAPI_ADMIN_TOKEN;
const get = (p, T) => fetch(HOST + p, { headers: { token: T } }).then((r) => r.status).catch(() => "ERR");
(async () => {
  const all = await fetch(HOST + "/instance/all", { headers: { admintoken: ADMIN } }).then((r) => r.json());
  const list = Array.isArray(all) ? all : (all.instances || []);
  const T = list.find((i) => /Teste Adonias/.test(i.name || "")).token;
  const paths = [
    "/message/react", "/message/reaction", "/send/reaction",
    "/message/edit", "/message/editText", "/send/edit",
    "/message/delete", "/message/deleteMessage", "/chat/deleteMessage",
    "/message/forward", "/send/forward",
    "/chat/markRead", "/message/markRead", "/chat/sendPresence", "/chat/presence", "/sendPresence",
    "/send/location", "/send/contact", "/send/poll", "/send/sticker",
    "/group/info", "/group/participants", "/chat/find", "/message/find",
  ];
  for (const p of paths) console.log((await get(p, T)), p);
})();
