// עריכת וידאו (ffmpeg) זמינה רק בשרת — לא בגרסת claude.ai
export const execFile = () => {
  throw new Error('ffmpeg לא זמין בגרסת claude.ai');
};
export default { execFile };
