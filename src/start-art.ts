import type { RegionId } from './progression';

/**
 * Small course-guide illustrations, all drawn the same way: a paper sky, flat faded colours, a dark
 * evergreen outline and one red flag on a pale green. 120 x 72 each.
 */
const INK = '#1d3a2c';
const SKY = '#efe5c8';
const o = `stroke="${INK}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"`;
const flag = (x: number, y: number) =>
  `<path d="M${x} ${y}v-15" ${o} fill="none"/><path d="M${x} ${y - 15}l9 3.4-9 3.4z" fill="#b63d2a" ${o} stroke-width="1"/>`;
const pine = (x: number, y: number, s = 1, fill = '#4f7a52') =>
  `<path d="M${x} ${y - 24 * s}l${8 * s} ${17 * s}h${-5 * s}l${6 * s} ${9 * s}h${-18 * s}l${6 * s}-${9 * s}h${-5 * s}z" fill="${fill}" ${o}/><path d="M${x} ${y + 2 * s}v${-3 * s}" ${o}/>`;

const wrap = (inner: string, label: string) =>
  `<svg class="rart" viewBox="0 0 120 72" role="img" aria-label="${label}"><rect width="120" height="72" fill="${SKY}"/>${inner}<rect x=".75" y=".75" width="118.5" height="70.5" fill="none" stroke="${INK}" stroke-width="1.5"/></svg>`;

export const REGION_ART: Record<RegionId, string> = {
  parkland: wrap(
    `<path d="M0 40q30-10 60-4t60-6v42H0z" fill="#9db77d" ${o}/>
     <path d="M20 72q30-26 80 0z" fill="#c4d6a0" ${o}/>
     <ellipse cx="66" cy="50" rx="17" ry="6" fill="#d9e5b8" ${o}/>${flag(70, 50)}
     ${pine(14, 52, 1.15)}${pine(34, 46, .8, '#6b9168')}${pine(104, 52, 1.2)}${pine(88, 44, .75, '#6b9168')}`,
    'Forest clearing',
  ),
  plains: wrap(
    `<circle cx="96" cy="18" r="8" fill="#e8c46a" ${o}/>
     <path d="M0 40h120v32H0z" fill="#cdd49a" ${o}/>
     <path d="M0 52q30-5 60 0t60-1v21H0z" fill="#b9c685" ${o}/>
     <ellipse cx="52" cy="56" rx="16" ry="5" fill="#dfe9bd" ${o}/>${flag(56, 56)}
     <path d="M12 66l3-8M18 66l2-6M24 67l4-7M84 63l3-8M90 64l2-7M100 62l4-7M72 46l2-5M30 46l2-5" ${o} fill="none" stroke-width="1.2"/>
     <path d="M104 40v-9M104 31l-5-3M104 31l5-3M104 35l-4-2M104 35l4-2" ${o} fill="none" stroke-width="1.2"/>`,
    'Open prairie',
  ),
  coast: wrap(
    `<rect y="0" width="120" height="30" fill="#bcd3cf"/>
     <path d="M0 22q10-4 20 0t20 0 20 0 20 0 20 0M0 14q10-4 20 0t20 0 20 0 20 0 20 0" fill="none" stroke="#7fa6a5" stroke-width="1.2"/>
     <path d="M0 34q26-9 52 0t68-3v41H0z" fill="#ead9a4" ${o}/>
     <path d="M0 52q26-9 54-2t66-4v26H0z" fill="#b8c98a" ${o}/>
     <ellipse cx="78" cy="55" rx="15" ry="5" fill="#d9e5b8" ${o}/>${flag(82, 55)}
     <path d="M14 60q8-6 17 0z" fill="#ead9a4" ${o}/><path d="M38 66q7-5 14 0z" fill="#ead9a4" ${o}/>
     <path d="M100 66l-1-6M104 66l1-7M108 66l3-6" ${o} fill="none" stroke-width="1.2"/>`,
    'Coastal dunes',
  ),
  mountain: wrap(
    `<path d="M0 44l24-26 16 14 22-22 30 34 28-18v46H0z" fill="#a9b7a4" ${o}/>
     <path d="M62 10l-9 10 6-2 4 4 4-4 5 2z" fill="${SKY}" ${o} stroke-width="1.2"/>
     <path d="M24 18l-6 7 5-1 3 3 3-3 4 1z" fill="${SKY}" ${o} stroke-width="1.2"/>
     <path d="M0 52q30-8 62-2t58-4v26H0z" fill="#8fae7b" ${o}/>
     <ellipse cx="60" cy="58" rx="14" ry="4.5" fill="#d3e1b1" ${o}/>${flag(64, 58)}
     ${pine(12, 62, 1.1, '#3f6b4a')}${pine(28, 64, .85, '#3f6b4a')}${pine(100, 62, 1.15, '#3f6b4a')}${pine(112, 64, .8, '#3f6b4a')}`,
    'Mountain pines',
  ),
  desert: wrap(
    `<circle cx="22" cy="20" r="8.5" fill="#e3a851" ${o}/>
     <path d="M60 40l6-10h14l5 8h8l5 6v28H60z" fill="#d49a72" ${o}/>
     <path d="M0 44q30-5 60 0t60-2v30H0z" fill="#ecd39b" ${o}/>
     <path d="M0 58q28-7 56-1t64-3v18H0z" fill="#e0bf82" ${o}/>
     <ellipse cx="50" cy="60" rx="14" ry="4.5" fill="#cfe0a6" ${o}/>${flag(54, 60)}
     <path d="M96 66V44M96 54h-7v-8M96 51h7v-7" fill="none" ${o} stroke-width="3"/><path d="M96 66V44M96 54h-7v-8M96 51h7v-7" fill="none" stroke="#6f9a62" stroke-width="1.4" stroke-linecap="round"/>
     <path d="M8 68l3-4 3 4M24 66l2-3 3 3" ${o} fill="none" stroke-width="1.2"/>`,
    'Desert scrub',
  ),
};

/** The wide banner at the top of the opening screen: the same drawing style, one hole in a valley. */
export const BANNER_ART = `<svg class="banner" viewBox="0 0 400 110" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <rect width="400" height="110" fill="${SKY}"/>
  <circle cx="318" cy="26" r="13" fill="#e8c46a" ${o}/>
  <path d="M0 62l50-30 40 22 56-34 70 42 60-28 54 30 70-26v72H0z" fill="#b5c3ad" ${o}/>
  <path d="M0 80q80-20 170-6t230-14v50H0z" fill="#8fae7b" ${o}/>
  <path d="M110 110q50-34 130-12 50 12 100-4v16z" fill="#c4d6a0" ${o}/>
  <ellipse cx="262" cy="92" rx="30" ry="9" fill="#d9e5b8" ${o}/><path d="M270 92V70" ${o} fill="none"/><path d="M270 70l15 5.5-15 5.5z" fill="#b63d2a" ${o} stroke-width="1.2"/>
  <ellipse cx="206" cy="100" rx="13" ry="4" fill="#ead9a4" ${o}/>
  ${pine(40, 96, 1.7)}${pine(78, 92, 1.1, '#6b9168')}${pine(356, 98, 1.8)}${pine(332, 92, 1.1, '#6b9168')}${pine(20, 84, 1.0, '#6b9168')}
  <rect x=".75" y=".75" width="398.5" height="108.5" fill="none" stroke="${INK}" stroke-width="1.5"/>
</svg>`;

/** Flag ratings for difficulty: filled flags for the level, outlines for the rest. */
export const levelFlags = (level: number) =>
  Array.from({ length: 5 }, (_, i) => `<svg viewBox="0 0 10 12" class="lf ${i < level ? 'on' : ''}" aria-hidden="true"><path d="M1.5 11.5V1M1.5 1.5h7L6 4l2.5 2.5h-7" /></svg>`).join('');
