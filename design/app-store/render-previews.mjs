import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const directory = fileURLToPath(new URL('.', import.meta.url));
const editPath = resolve(process.argv[2] ?? join(directory, 'preview-edit.json'));
const edit = JSON.parse(readFileSync(editPath, 'utf8'));
const outputDirectory = resolve(process.argv[3] ?? directory);
const workDirectory = join(outputDirectory, '.generated');
mkdirSync(workDirectory, { recursive: true });
function run(program, args, capture = false) {
  const result = spawnSync(program, args, {
    encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${program} failed with status ${result.status}`);
  return result.stdout;
}
function probe(path) {
  return JSON.parse(run('ffprobe', [
    '-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', path,
  ], true));
}
if (!Array.isArray(edit.previews) || edit.previews.length < 1 || edit.previews.length > 3) {
  throw new Error('The edit must contain one to three previews');
}
const names = new Set();
const durations = edit.previews.map(preview => {
  if (!Array.isArray(preview.sections) || !preview.sections.length ||
      typeof preview.output !== 'string' || basename(preview.output) !== preview.output ||
      !preview.output.endsWith('.mp4') || names.has(preview.output)) {
    throw new Error('Each preview needs sections and a unique MP4 output filename');
  }
  names.add(preview.output);
  preview.source = resolve(dirname(editPath), preview.source);
  if (!existsSync(preview.source)) {
    throw new Error(
      `Recording not found: ${preview.source}. Video sources are not stored in Git. ` +
      'Add your footage under design/app-store/sources/ or update source in the edit list.'
    );
  }
  const source = probe(preview.source);
  const sourceDuration = Number(source.format.duration);
  if (!source.streams.some(stream => stream.codec_type === 'video')) throw new Error('Source has no video');
  let duration = 0;
  for (const section of preview.sections) {
    if (typeof section.title !== 'string' || !section.title.trim() ||
        ![section.start, section.end, section.cardSeconds].every(Number.isFinite) ||
        section.start < 0 || section.end <= section.start || section.end > sourceDuration ||
        section.cardSeconds <= 0) {
      throw new Error(`Invalid title or time range in ${preview.name}`);
    }
    duration += section.cardSeconds + section.end - section.start;
  }
  if (duration < 15 || duration > 30) throw new Error(`${preview.name} is ${duration}s; Apple allows 15-30s`);
  if (!Number.isFinite(preview.posterAt) || preview.posterAt < 0 || preview.posterAt >= duration) {
    throw new Error(`Invalid poster time in ${preview.name}`);
  }
  return duration;
});
const titleGenerator = join(workDirectory, 'preview-title-cards');
run('xcrun', ['swiftc', '-parse-as-library', '-O', join(directory, 'preview-title-cards.swift'), '-o', titleGenerator]);
run(titleGenerator, [editPath, workDirectory]);

for (const [previewIndex, preview] of edit.previews.entries()) {
  const args = ['-hide_banner', '-loglevel', 'warning', '-nostdin', '-n'];
  const filters = [];
  const parts = [];
  for (const [index, section] of preview.sections.entries()) {
    const titleInput = index * 2;
    const videoInput = titleInput + 1;
    args.push(
      '-loop', '1', '-framerate', '30', '-i', join(workDirectory, `preview-title-${previewIndex}-${index}.png`),
      '-i', preview.source
    );
    filters.push(
      `[${titleInput}:v]trim=duration=${section.cardSeconds},setpts=PTS-STARTPTS,` +
      'scale=886:1920:out_color_matrix=bt709:out_range=tv,format=yuv420p,' +
      `colorspace=iall=bt709:itrc=iec61966-2-1:all=bt709:format=yuv420p,setsar=1[card${index}]`,
      // Expand sparse recording frames before trimming, preserving holds at each cut boundary.
      `[${videoInput}:v]fps=30:start_time=0,trim=start=${section.start}:end=${section.end},setpts=PTS-STARTPTS,` +
      'scale=886:1920:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,' +
      'colorspace=all=bt709:format=yuv420p,setsar=1,' +
      `pad=886:1920:(ow-iw)/2:(oh-ih)/2:color=0xf5efdf[clip${index}]`
    );
    parts.push(`[card${index}][clip${index}]`);
  }
  args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');
  filters.push(`${parts.join('')}concat=n=${preview.sections.length * 2}:v=1:a=0[out]`);
  const duration = durations[previewIndex];
  const temporary = join(workDirectory, `.preview-${randomUUID()}.mp4`);
  args.push(
    '-filter_complex', filters.join(';'), '-map', '[out]',
    '-t', String(duration), '-r', '30', '-fps_mode', 'cfr',
    '-c:v', 'libx264', '-preset', 'slow', '-b:v', '11M',
    '-maxrate', '12M', '-bufsize', '24M', '-profile:v', 'high', '-level:v', '4.0',
    '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-colorspace', 'bt709',
    '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-metadata', `title=WingDex - ${preview.name}`,
    '-metadata', 'comment=Recorded app footage with chapter title cards; no speed changes.'
  );
  const passLog = temporary.replace(/\.mp4$/, '-pass');
  console.log(`${preview.name}: analyzing for the 11 Mbps export`);
  run('ffmpeg', [...args, '-pass', '1', '-passlogfile', passLog, '-f', 'null', '-']);
  run('ffmpeg', [
    ...args, '-pass', '2', '-passlogfile', passLog,
    '-map', `${preview.sections.length * 2}:a:0`,
    '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart', '-video_track_timescale', '30000', temporary,
  ]);
  for (const suffix of ['-0.log', '-0.log.mbtree']) {
    const log = `${passLog}${suffix}`;
    if (existsSync(log)) unlinkSync(log);
  }
  const result = probe(temporary);
  const video = result.streams.find(stream => stream.codec_type === 'video');
  const audio = result.streams.find(stream => stream.codec_type === 'audio');
  if (Math.abs(Number(result.format.duration) - duration) > 1 / 30 ||
      video?.codec_name !== 'h264' || video.profile !== 'High' || video.level > 40 ||
      video.width !== 886 || video.height !== 1920 ||
      video.r_frame_rate !== '30/1' || Number(video.nb_read_frames) !== Math.round(duration * 30) ||
      audio?.codec_name !== 'aac' || audio.channels !== 2 || Number(audio.sample_rate) !== 48000 ||
      Number(result.format.size) > 500_000_000) {
    throw new Error(`Export failed format/duration validation: ${temporary}`);
  }
  const output = join(outputDirectory, preview.output);
  renameSync(temporary, output);
  run('ffmpeg', [
    '-v', 'error', '-ss', String(preview.posterAt), '-i', output,
    '-frames:v', '1', '-q:v', '2', '-update', '1', '-y',
    output.replace(/\.mp4$/, '-poster.jpg'),
  ]);
  console.log(`${preview.name}: ${duration}s -> ${output}`);
}
