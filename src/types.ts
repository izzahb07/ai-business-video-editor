export type AspectRatio = '9:16' | '16:9' | '1:1' | '4:5';
export type FitMode = 'fill' | 'fit';

/** An imported source video file. Immutable once imported. */
export interface Asset {
  id: string;
  name: string;
  size: number;
  mime: string;
  /** Duration in seconds (source time 0 = first video frame). */
  duration: number;
  /** Display width/height (after rotation metadata is applied). */
  width: number;
  height: number;
  codec: string | null;
  hasAudio: boolean;
  /** Whether this browser can decode the video track with WebCodecs (fast export path). */
  webCodecsDecodable: boolean;
  /** Small JPEG data URL. */
  thumb: string;
  /** Whether the original file is saved on the device (IndexedDB) so it survives reloads. */
  stored: boolean;
}

/** One piece of a source video placed on the timeline. */
export interface Clip {
  id: string;
  assetId: string;
  /** Source in/out points in seconds. */
  in: number;
  out: number;
  /** 0..2 (1 = original level). */
  volume: number;
  muted: boolean;
  fit: FitMode;
}

export interface ProjectSettings {
  aspect: AspectRatio;
  /** What fills empty space when a clip is in "fit" mode. */
  background: 'blur' | 'black';
}

export interface Project {
  id: string;
  name: string;
  clips: Clip[];
  settings: ProjectSettings;
}

export type ExportResolution = 1080 | 720;
export type ExportQuality = 'high' | 'standard' | 'small';

export interface ExportSettings {
  resolution: ExportResolution;
  fps: 24 | 25 | 30 | 60;
  quality: ExportQuality;
}
