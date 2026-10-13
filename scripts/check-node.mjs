// בדיקת גרסת Node לפני הפעלה — כדי לקבל הודעה ברורה במקום שגיאה טכנית.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`
  ✖ Node.js ${process.versions.node} is too old. AI Production OS needs Node.js 22.13 or newer.
    Download the LTS version from https://nodejs.org , install it, close this window and run again.
`);
  process.exit(1);
}
