// Every game server module carries this string. scripts/check-bundle.mjs fails the build if it ever
// shows up in the client bundle, which would mean server logic leaked into the browser.
export const SERVER_MARKER = '__STALLHUB_SERVER_ONLY__'
