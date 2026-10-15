/**
 * LaalPen website settings — edit these when the app is published.
 * Website and web app share one domain: the website is "/", the app lives at /login, /teacher, /admin ...
 * "Open app": on a computer it opens the web app (/login); on a phone it opens the installed app, else the web app.
 */
window.LAALPEN = {
  // must match `scheme` and the Android package in app/app.config.ts
  appScheme: 'laalpen',
  androidPackage: 'pk.laalpen.app',

  // where people get the app if it is not installed yet (leave '' until you have the link)
  playStoreUrl: '', // e.g. 'https://play.google.com/store/apps/details?id=pk.laalpen.app'
  apkUrl: '/LaalPen.apk', // direct APK download while the app is not on Play Store yet (served by this website)
  appStoreUrl: '', // e.g. 'https://apps.apple.com/app/idXXXXXXXXX'

  // the web version of the app, served by this same site (laalpen.vercel.app/login); also used when the phone app is not installed
  webAppUrl: '/login',

  contactEmail: 'hello@laalpen.pk',
  contactWhatsApp: '', // e.g. '923001234567'
};
