// Superagent's typings assume we're in a browser.
// We don't want to import the whole dom library's typings,
// as that could hide some legit errors if we try to use a value
// that's undefined in Node but would exist in a browser.
// So, instead, we define these minimal types here to make TS happy.
declare interface XMLHttpRequest {}
declare interface Blob {}
