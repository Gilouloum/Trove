// Copy this file to telemetry-config.js to turn on the anonymous "Help improve
// Trove" ping (Settings, off until the user says yes). Without this file, main.js's
// 'send-telemetry' handler just silently does nothing - no crash, no error, telemetry is
// simply off for everyone until you set this up.
//
// Forking Trove and shipping your own builds? Point telemetry-config.js at your own Firebase
// project (or delete it) so your users' pings don't land in the upstream Trove project.
//
// What gets sent, once when the app opens and once when it closes: a random per-install id
// (not tied to a person - see installId in main.js's DEFAULT_DATA), how long the session was,
// rough counts (files/folders/favorites/pins), and how many times each main feature has been
// used (featureUse). Never file names, paths, photos, or anything else that could identify
// someone or their library.
//
// Setup (free - Firebase's Spark plan needs no billing/credit card for this level of usage):
//   1. Create a Firebase project at https://console.firebase.google.com (or reuse one you
//      already have) - Build -> Firestore Database -> Create database -> start in
//      **production mode** (the rules below replace its defaults either way).
//   2. Firestore -> Rules, and paste this in - it allows anyone to CREATE a new telemetry_events
//      document (that's the whole point - anonymous, no login required) but nobody, including
//      the app itself, can read, list, edit or delete existing ones through the client API.
//      The source is public, so the create rule also checks the document has exactly the shape
//      main.js sends - anything else (junk fields, made-up events) is rejected:
//        rules_version = '2';
//        service cloud.firestore {
//          match /databases/{database}/documents {
//            match /telemetry_events/{eventId} {
//              allow create: if request.resource.data.keys().hasOnly(['event', 'installId',
//                                 'sessionDurationMs', 'fileCount', 'folderCount', 'bestOfCount',
//                                 'pinnedCount', 'featureUse', 'appVersion', 'platform', 'expireAt'])
//                            && request.resource.data.event in ['app_open', 'session_end']
//                            && request.resource.data.installId is string
//                            && request.resource.data.installId.size() == 36
//                            && (!('featureUse' in request.resource.data)
//                                || (request.resource.data.featureUse is map
//                                    && request.resource.data.featureUse.keys().hasOnly(['onboarded',
//                                         'guidedSort', 'guidedSortDone', 'located', 'flick', 'flickDone',
//                                         'binned', 'globe', 'relive', 'editor', 'photomod', 'duplicates',
//                                         'findPeople', 'search', 'exportLiked', 'nudgeShown', 'nudgeOpened'])));
//      featureUse (added in 2026-11) is the running total of uses per feature - main.js's
//      TELEMETRY_USAGE_KEYS. A build that sends it is REJECTED by the older rules above it, so
//      publish these rules in the Firebase console before shipping that build.
//              allow read, update, delete: if false;
//            }
//          }
//        }
//      (Your own view of the data - Firebase console, or the Admin SDK/BigQuery export - always
//      bypasses these rules entirely; they only restrict the public client-facing API above.)
//   3. Project settings (gear icon) -> General -> scroll to "Your apps" -> add a Web app (no
//      Hosting needed) -> copy the "Project ID" and "apiKey" it shows you into the values below.
//      This API key is meant to be embedded in a shipped app - it's not a secret, your Firestore
//      rules above are what actually keeps the data safe (write-only, unreadable to anyone but you).
//   4. Google Cloud console (console.cloud.google.com, same project) -> Firestore -> Time-to-live
//      (TTL) -> Create policy, not a new collection: collection group "telemetry_events", timestamp
//      field "expireAt". Every event main.js sends carries an expireAt 25 months out, and this
//      policy is what actually deletes it then (the retention limit the privacy policy promises).
//      TTL needs the paid Blaze plan. On the free Spark plan, delete events older than 25 months
//      by hand instead (first ones due Nov 2028, since packaged builds sent nothing before then).
module.exports = {
  FIREBASE_PROJECT_ID: 'YOUR_PROJECT_ID',
  FIREBASE_API_KEY: 'YOUR_API_KEY'
};
