/* Quicky — Firebase Cloud Messaging service worker (background push).
 *
 * Registered by src/lib/quicky/push-client.ts as:
 *   /firebase-messaging-sw.js?cfg=<base64 config>
 * The Firebase web config is passed through the URL (a public SW file cannot
 * read env vars), decoded below and used to initialize the compat SDK.
 *
 * Messages carrying a `notification` payload are auto-displayed by FCM; the
 * onBackgroundMessage below also covers data-only sends. Tapping the
 * notification focuses the app (or opens it).
 */
;(function () {
  'use strict'

  try {
    var params = new URLSearchParams(self.location.search)
    var raw = params.get('cfg')
    if (raw) {
      var config = JSON.parse(decodeURIComponent(escape(atob(raw))))
      importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js')
      importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js')
      firebase.initializeApp(config)
      var messaging = firebase.messaging()
      messaging.onBackgroundMessage(function (payload) {
        var title = (payload.notification && payload.notification.title) || 'Quicky'
        var body = (payload.notification && payload.notification.body) || ''
        return self.registration.showNotification(title, {
          body: body,
          icon: '/quicky-logo.png',
          badge: '/quicky-logo.png',
          tag: 'quicky-push',
          data: (payload.data || {}),
        })
      })
    }
  } catch (e) {
    /* Push stays inert — the app itself never breaks. */
  }

  self.addEventListener('notificationclick', function (event) {
    event.notification.close()
    event.waitUntil(
      (function () {
        return self.clients
          .matchAll({ type: 'window', includeUncontrolled: true })
          .then(function (clientList) {
            for (var i = 0; i < clientList.length; i++) {
              var client = clientList[i]
              if ('focus' in client) return client.focus()
            }
            return self.clients.openWindow('/')
          })
          .catch(function () {})
      })()
    )
  })
})()
