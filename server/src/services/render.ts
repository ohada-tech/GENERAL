/**
 * עריכה אוטומטית ב-ffmpeg: חיבור הקליפים לפי סדר השוטים, חיתוך לאורך השוט,
 * התאמה ליחס התמונה הסופי, קריינות + מוזיקת רקע מונמכת, ו-fade בסוף.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ProviderError } from '../providers/types.js';

const run = promisify(execFile);

export async function ffprobeDuration(file: string): Promise<number | null> {
  try {
    const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
    const n = Number(stdout.trim());
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
  } catch {
    return null;
  }
}

export async function ffmpegAvailable() {
  try {
    await run('ffmpeg', ['-version']);
    return true;
  } catch {
    return false;
  }
}

export interface RenderInput {
  clips: Array<{ path: string; durationSec: number }>;
  voice?: string | null;
  music?: string | null;
  width: number;
  height: number;
  output: string;
}

export function buildRenderArgs(input: RenderInput, voiceSec: number | null) {
  const { clips, width: W, height: H } = input;
  const videoSec = clips.reduce((a, c) => a + c.durationSec, 0);
  // הקריינות לא נחתכת: אם היא ארוכה מהווידאו, הפריים האחרון מוחזק עד סופה
  const total = Math.max(videoSec, voiceSec ? voiceSec + 0.4 : 0);
  const pad = Math.max(0, total - videoSec);
  const args: string[] = ['-y'];
  clips.forEach((c) => args.push('-i', c.path));
  let idx = clips.length;
  const voiceIdx = input.voice ? idx++ : -1;
  const musicIdx = input.music ? idx++ : -1;
  if (input.voice) args.push('-i', input.voice);
  if (input.music) args.push('-i', input.music);

  const f: string[] = [];
  clips.forEach((c, i) => {
    f.push(
      `[${i}:v]trim=0:${c.durationSec.toFixed(2)},setpts=PTS-STARTPTS,scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=30,format=yuv420p,setsar=1[v${i}]`,
    );
  });
  f.push(`${clips.map((_, i) => `[v${i}]`).join('')}concat=n=${clips.length}:v=1:a=0[vcat]`);
  f.push(pad > 0 ? `[vcat]tpad=stop_mode=clone:stop_duration=${pad.toFixed(2)}[vout]` : '[vcat]null[vout]');

  const fadeStart = Math.max(0, total - 1.5).toFixed(2);
  const audio: string[] = [];
  if (voiceIdx >= 0) {
    f.push(`[${voiceIdx}:a]aresample=48000,aformat=channel_layouts=stereo,apad=whole_dur=${total.toFixed(2)}[va]`);
    audio.push('[va]');
  }
  if (musicIdx >= 0) {
    const vol = voiceIdx >= 0 ? 0.16 : 0.9;
    f.push(
      `[${musicIdx}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${total.toFixed(2)},asetpts=PTS-STARTPTS,volume=${vol},afade=t=in:d=0.6,afade=t=out:st=${fadeStart}:d=1.5[ma]`,
    );
    audio.push('[ma]');
  }
  if (audio.length === 2) f.push(`[va][ma]amix=inputs=2:duration=first:normalize=0[aout]`);
  else if (audio.length === 1) f.push(`${audio[0]}anull[aout]`);

  args.push('-filter_complex', f.join(';'), '-map', '[vout]');
  if (audio.length) args.push('-map', '[aout]', '-c:a', 'aac', '-b:a', '192k');
  else args.push('-an');
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-movflags', '+faststart', '-t', total.toFixed(2), input.output);
  return { args, total };
}

export async function renderVideo(input: RenderInput) {
  if (!(await ffmpegAvailable())) {
    throw new ProviderError('ffmpeg לא מותקן בשרת — העריכה האוטומטית זמינה בשרת הענן (Docker) או אחרי התקנת ffmpeg.', false, 'ffmpeg_missing');
  }
  if (!input.clips.length) throw new ProviderError('אין קליפים מאושרים לעריכה', false, 'no_clips');
  const voiceSec = input.voice ? await ffprobeDuration(input.voice) : null;
  const { args, total } = buildRenderArgs(input, voiceSec);
  try {
    await run('ffmpeg', args, { maxBuffer: 20 * 1024 * 1024, timeout: 15 * 60_000 });
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    const tail = (err.stderr ?? err.message ?? '').split('\n').filter(Boolean).slice(-4).join(' | ');
    throw new ProviderError(`העריכה ב-ffmpeg נכשלה: ${tail}`, false, 'ffmpeg_failed');
  }
  return { durationSec: (await ffprobeDuration(input.output)) ?? total };
}
