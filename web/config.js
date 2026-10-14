/**
 * LaalPen website settings — edit these when the app is published.
 * The "Open app" button opens the installed mobile app. It never opens the web version of the app.
 */
window.LAALPEN = {
  // must match `scheme` and the Android package in app/app.config.ts
  appScheme: 'laalpen',
  androidPackage: 'pk.laalpen.app',

  // where people get the app if it is not installed yet (leave '' until you have the link)
  playStoreUrl: '', // e.g. 'https://play.google.com/store/apps/details?id=pk.laalpen.app'
  apkUrl: '', // optional direct APK download while the app is not on Play Store yet
  appStoreUrl: '', // e.g. 'https://apps.apple.com/app/idXXXXXXXXX'

  contactEmail: 'hello@laalpen.pk',
  contactWhatsApp: '', // e.g. '923001234567'
};
