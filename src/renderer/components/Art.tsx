import { useState } from 'react';
import { Gamepad2, Trophy } from 'lucide-react';

interface Props {
  image?: string | null;
  name: string;
  kind?: 'game' | 'achievement';
  large?: boolean;
  demo?: boolean;
}
const DEMO_COVERS = [
  'Cyberpunk 2077',
  'The Witcher 3: Wild Hunt',
  'Stardew Valley',
  "Baldur's Gate 3",
  'Hades',
  'Disco Elysium',
  'Hollow Knight',
  'Celeste',
];
const DEMO_ACHIEVEMENTS = [
  'The World',
  'Frequent Flyer',
  'The Wandering Fool',
  'Legend of The Afterlife',
  'Full Body Conversion',
  'Hidden achievement',
];
function safeSource(image: string | null | undefined): string | undefined {
  if (!image) return undefined;
  try {
    const url = new URL(image.startsWith('//') ? `https:${image}` : image);
    if (url.protocol !== 'https:' || url.username || url.password) return undefined;
    return /(^|\.)(gog\.com|gog-statics\.com)$/.test(url.hostname) ? url.href : undefined;
  } catch {
    return undefined;
  }
}
export function Art({ image, name, kind = 'game', large = false, demo = false }: Props) {
  const index = demo ? (kind === 'game' ? DEMO_COVERS : DEMO_ACHIEVEMENTS).indexOf(name) : -1;
  const columns = kind === 'game' ? 4 : 3;
  const sprite =
    index >= 0
      ? {
          backgroundImage: `url("./assets/${kind === 'game' ? 'demo-covers.png' : 'demo-achievements.png'}")`,
          backgroundSize: `${columns * 100}% 200%`,
          backgroundPosition: `${((index % columns) / (columns - 1)) * 100}% ${Math.floor(index / columns) * 100}%`,
        }
      : undefined;
  const src = demo ? undefined : safeSource(image);
  const [failedSource, setFailedSource] = useState<string | undefined>();
  return (
    <span
      className={`art art-${kind} ${large ? 'art-large' : ''}`}
      aria-hidden="true"
      style={sprite}
    >
      {sprite ? null : src && src !== failedSource ? (
        <img src={src} alt="" loading="lazy" onError={() => setFailedSource(src)} />
      ) : kind === 'game' ? (
        <Gamepad2 size={large ? 38 : 24} />
      ) : (
        <Trophy size={26} />
      )}
    </span>
  );
}
