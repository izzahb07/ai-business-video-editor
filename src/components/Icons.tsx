import type { SVGProps } from 'react';

const base = (p: SVGProps<SVGSVGElement>) => ({
  width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, ...p,
});

export const IconPlay = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none" /></svg>);
export const IconPause = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" /><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" /></svg>);
export const IconUndo = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg>);
export const IconRedo = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></svg>);
export const IconPlus = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>);
export const IconLeft = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="m15 18-6-6 6-6" /></svg>);
export const IconRight = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="m9 18 6-6-6-6" /></svg>);
export const IconTrash = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>);
export const IconCopy = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></svg>);
export const IconExport = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M12 3v12M7 8l5-5 5 5" /><path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" /></svg>);
export const IconInfo = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.5" /></svg>);
export const IconFilm = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" /></svg>);
export const IconVolume = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M11 5 6 9H3v6h3l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /></svg>);
export const IconMute = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M11 5 6 9H3v6h3l5 4z" /><path d="m16 9 5 6M21 9l-5 6" /></svg>);
export const IconClose = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M6 6l12 12M18 6 6 18" /></svg>);
export const IconCheck = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="m5 12 5 5 9-10" /></svg>);

export const TabEdit = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12" /></svg>);
export const TabCaptions = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><rect x="2.5" y="5" width="19" height="14" rx="3" /><path d="M10 10.2a2.2 2.2 0 1 0 0 3.6M17 10.2a2.2 2.2 0 1 0 0 3.6" /></svg>);
export const TabText = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M5 6V4h14v2M12 4v16M9 20h6" /></svg>);
export const TabColor = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" /></svg>);
export const TabAudio = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></svg>);
export const TabAI = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></svg>);
export const TabFormat = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><rect x="7" y="2.5" width="10" height="19" rx="2" /><path d="M3 8v8M21 8v8" /></svg>);
