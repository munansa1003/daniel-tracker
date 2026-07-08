/* public/push-sw.js — 웹푸시 수신 핸들러.
   vite-plugin-pwa(generateSW)가 workbox.importScripts로 생성 SW에 합쳐 넣는다.
   즉 이 코드는 앱의 서비스워커 전역(self)에서 실행된다. */

self.addEventListener("push", (event) => {
  let data = { title: "Daniel Body Plan", body: "", tab: "home" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (e) {
    if (event.data) data.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.tag || "daniel-reminder",
      data: { tab: data.tab || "home" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const tab = (event.notification.data && event.notification.data.tab) || "home";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) {
          c.postMessage({ type: "nav", tab });
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(`/?tab=${tab}`);
    })
  );
});
