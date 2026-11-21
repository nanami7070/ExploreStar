'use client';

/**
 * 探知星插画与图形组件（内联 SVG，无外链资源）。
 *
 * 风格：扁平 + 少量高光，线条圆润，配色与设计系统一致
 * （自然绿 / 浅蓝 / 柔和橙黄）。不做复杂渐变与过度拟人化。
 */

/* ------------------------------------------------------------------ */
/* 品牌与场景插画                                                      */
/* ------------------------------------------------------------------ */

/** 品牌标志：轨道上的一颗探索之星 */
export function BrandMark({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 34 34" fill="none" aria-hidden>
      <circle cx="17" cy="17" r="15.5" fill="#4C9A6D" />
      <ellipse
        cx="17"
        cy="17"
        rx="10.5"
        ry="4.6"
        stroke="#fff"
        strokeWidth="1.6"
        opacity="0.85"
        transform="rotate(-24 17 17)"
      />
      <path
        d="M17 8.6l1.9 3.85 4.25.62-3.07 3 .72 4.23L17 18.06l-3.8 2.24.72-4.23-3.07-3 4.25-.62L17 8.6z"
        fill="#FFD98A"
        stroke="#E8A23A"
        strokeWidth="0.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 首页吉祥物：举着星星的小望远镜 */
export function TelescopeMascot({ size = 96 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" fill="none" aria-hidden>
      {/* 支架腿 */}
      <path d="M38 66 L48 82 M52 66 L48 82" stroke="#B9946B" strokeWidth="3.4" strokeLinecap="round" />
      {/* 镜筒 */}
      <g transform="rotate(-18 48 58)">
        <rect x="20" y="50" width="46" height="17" rx="8.5" fill="#5498C8" />
        <rect x="20" y="50" width="46" height="7" rx="3.5" fill="#7FB3D8" />
        <rect x="62" y="51.5" width="10" height="14" rx="4" fill="#3E8E5E" />
        <rect x="16" y="53" width="7" height="11" rx="3.5" fill="#E8A23A" />
        {/* 大眼睛 */}
        <circle cx="30" cy="58.5" r="4.4" fill="#fff" />
        <circle cx="31.4" cy="57.6" r="2" fill="#24301F" />
        <circle cx="30.8" cy="57" r="0.9" fill="#fff" />
        {/* 微笑 */}
        <path d="M24.5 63.5c1.6 1.2 4.4 1.2 6 0" stroke="#24301F" strokeWidth="1.3" strokeLinecap="round" />
      </g>
      {/* 举起的星星 */}
      <path
        d="M72 18l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4-3.9-3.8 5.4-.8L72 18z"
        fill="#FFD98A"
        stroke="#E8A23A"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      {/* 小星光 */}
      <circle cx="20" cy="16" r="2" fill="#8AC5A5" />
      <circle cx="86" cy="44" r="1.6" fill="#FFD98A" />
      <circle cx="12" cy="40" r="1.4" fill="#7FB3D8" />
    </svg>
  );
}

/** 水箱实验场景：材料台 + 两箱液体 */
export function TankScene({ size = 120 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" aria-hidden>
      {/* 桌子 */}
      <rect x="12" y="88" width="96" height="7" rx="3.5" fill="#D9B98C" />
      <rect x="24" y="95" width="8" height="14" rx="2" fill="#C4A173" />
      <rect x="88" y="95" width="8" height="14" rx="2" fill="#C4A173" />
      {/* 清水箱 */}
      <rect x="14" y="34" width="42" height="52" rx="6" fill="#E7F2FA" stroke="#5498C8" strokeWidth="2" />
      <rect x="14" y="48" width="42" height="38" rx="6" fill="#A9D4EE" opacity="0.85" />
      {/* 清水里漂着木块 */}
      <rect x="27" y="40" width="16" height="9" rx="2.5" fill="#C98F5A" />
      <rect x="27" y="40" width="16" height="3" rx="1.5" fill="#E0AE7E" />
      {/* 盐水箱 */}
      <rect x="64" y="34" width="42" height="52" rx="6" fill="#FCF3DC" stroke="#E0A63C" strokeWidth="2" />
      <rect x="64" y="48" width="42" height="38" rx="6" fill="#F3DCA0" opacity="0.8" />
      {/* 盐水里漂着蜡块 */}
      <rect x="78" y="41" width="14" height="8" rx="2.5" fill="#F0B98C" />
      <rect x="78" y="41" width="14" height="3" rx="1.5" fill="#FBD2B0" />
      {/* 气泡 */}
      <circle cx="36" cy="60" r="2" fill="#fff" opacity="0.85" />
      <circle cx="40" cy="70" r="1.4" fill="#fff" opacity="0.7" />
      <circle cx="86" cy="62" r="2" fill="#fff" opacity="0.85" />
      <circle cx="90" cy="72" r="1.4" fill="#fff" opacity="0.7" />
      {/* 星星点缀 */}
      <path
        d="M101 14l1.4 2.8 3.1.45-2.25 2.2.53 3.1-2.78-1.46-2.78 1.46.53-3.1-2.25-2.2 3.1-.45L101 14z"
        fill="#FFD98A"
        stroke="#E8A23A"
        strokeWidth="0.8"
        strokeLinejoin="round"
      />
      <circle cx="14" cy="16" r="1.8" fill="#8AC5A5" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* 材料图形（按材料 id 映射颜色与形状）                                */
/* ------------------------------------------------------------------ */

const MATERIAL_STYLES: Record<string, { fill: string; stroke: string; shape: 'block' | 'nail' | 'ball' }> = {
  'wood-block': { fill: '#C98F5A', stroke: '#A06B3C', shape: 'block' },
  'plastic-block': { fill: '#8FC1E3', stroke: '#5E96BE', shape: 'block' },
  'wax-block': { fill: '#F0B98C', stroke: '#CF9260', shape: 'block' },
  'stone-block': { fill: '#A8AFB4', stroke: '#7C8287', shape: 'block' },
  'iron-nail': { fill: '#8B8F94', stroke: '#5F6368', shape: 'nail' },
  'clay-ball': { fill: '#C96F5A', stroke: '#9E4F3E', shape: 'ball' },
};

export function MaterialGlyph({ materialId, size = 34 }: { materialId: string; size?: number }) {
  const style = MATERIAL_STYLES[materialId] ?? { fill: '#A8AFB4', stroke: '#7C8287', shape: 'block' as const };
  return (
    <svg width={size} height={size} viewBox="0 0 34 34" fill="none" aria-hidden>
      {style.shape === 'nail' ? (
        <>
          <rect x="6" y="13" width="17" height="7" rx="2" fill={style.fill} stroke={style.stroke} strokeWidth="1.4" />
          <path d="M23 12 L29 17 L23 22 Z" fill={style.stroke} />
        </>
      ) : style.shape === 'ball' ? (
        <circle cx="17" cy="17" r="11" fill={style.fill} stroke={style.stroke} strokeWidth="1.6" />
      ) : (
        <>
          <rect x="6" y="9" width="22" height="16" rx="4" fill={style.fill} stroke={style.stroke} strokeWidth="1.6" />
          <rect x="6" y="9" width="22" height="5" rx="2.5" fill="#ffffff" opacity="0.35" />
        </>
      )}
      {style.shape === 'ball' ? <circle cx="13.4" cy="13.4" r="2.6" fill="#fff" opacity="0.4" /> : null}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* 预测结果图形：浮起 / 悬浮 / 沉底                                    */
/* ------------------------------------------------------------------ */

export function OutcomeGlyph({ outcome, size = 44 }: { outcome: 'float' | 'sink' | 'suspend'; size?: number }) {
  const h = 48;
  const w = 40;
  const waterTop = 22;
  const itemY = outcome === 'float' ? 8 : outcome === 'suspend' ? 24 : 36;
  return (
    <svg width={size} height={(size * h) / w} viewBox={`0 0 ${w} ${h}`} fill="none" aria-hidden>
      {/* 杯壁 */}
      <path
        d={`M6 ${waterTop} V44 a3 3 0 0 0 3 3 h22 a3 3 0 0 0 3-3 V${waterTop}`}
        stroke="#7FB3D8"
        strokeWidth="2"
        fill="#E7F2FA"
      />
      {/* 水 */}
      <path
        d={`M8 ${waterTop + 2} V43 a2 2 0 0 0 2 2 h20 a2 2 0 0 0 2-2 V${waterTop + 2}`}
        fill="#A9D4EE"
        opacity="0.85"
      />
      {/* 物体 */}
      <rect x="12" y={itemY} width="16" height="9" rx="2.5" fill="#C98F5A" stroke="#A06B3C" strokeWidth="1.2" />
      <rect x="12" y={itemY} width="16" height="3" rx="1.5" fill="#E0AE7E" />
      {/* 水面线 */}
      <path d={`M7 ${waterTop} H33`} stroke="#5498C8" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** 液体图形：清水 / 盐水 */
export function LiquidGlyph({ liquidId, size = 30 }: { liquidId: string; size?: number }) {
  const isSalt = liquidId === 'salt-water';
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" fill="none" aria-hidden>
      <path
        d="M15 3c4 4.6 7.5 8.3 7.5 12.4a7.5 7.5 0 0 1-15 0C7.5 11.3 11 7.6 15 3z"
        fill={isSalt ? '#F6E3B4' : '#A9D4EE'}
        stroke={isSalt ? '#E0A63C' : '#5498C8'}
        strokeWidth="1.6"
      />
      {isSalt ? (
        <circle cx="13" cy="14" r="1" fill="#D9A63C" />
      ) : null}
    </svg>
  );
}
