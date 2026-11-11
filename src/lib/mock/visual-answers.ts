const PELICAN_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>鹈鹕骑自行车</title>
<style>
  html, body { margin: 0; height: 100%; background: linear-gradient(#bfe6ff, #eaf7ff 70%, #d8efc8 70%); }
  svg { display: block; width: 100%; height: 100vh; max-height: 520px; }
  .ground-lines line { stroke: #9cc98a; stroke-width: 3; stroke-linecap: round; }
  .ground-lines { animation: scroll 1.2s linear infinite; }
  @keyframes scroll { from { transform: translateX(0); } to { transform: translateX(-80px); } }
  .rider { animation: bob 0.6s ease-in-out infinite alternate; transform-origin: 300px 230px; }
  @keyframes bob { from { transform: translateY(0); } to { transform: translateY(-4px); } }
  .cloud { animation: drift 18s linear infinite; }
  @keyframes drift { from { transform: translateX(640px); } to { transform: translateX(-200px); } }
</style>
</head>
<body>
<svg viewBox="0 0 600 400" xmlns="http://www.w3.org/2000/svg" aria-label="鹈鹕骑自行车">
  <g class="cloud" id="cloud">
    <ellipse cx="80" cy="70" rx="46" ry="18" fill="#fff"/>
    <ellipse cx="110" cy="60" rx="30" ry="16" fill="#fff"/>
    <ellipse cx="55" cy="62" rx="22" ry="12" fill="#fff"/>
  </g>
  <circle cx="520" cy="70" r="30" fill="#ffd54a" id="sun"/>
  <rect x="0" y="330" width="600" height="70" fill="#a8d88f"/>
  <g class="ground-lines">
    <line x1="20" y1="350" x2="60" y2="350"/><line x1="100" y1="360" x2="140" y2="360"/>
    <line x1="180" y1="350" x2="220" y2="350"/><line x1="260" y1="365" x2="300" y2="365"/>
    <line x1="340" y1="350" x2="380" y2="350"/><line x1="420" y1="360" x2="460" y2="360"/>
    <line x1="500" y1="350" x2="540" y2="350"/><line x1="580" y1="362" x2="620" y2="362"/>
    <line x1="660" y1="350" x2="700" y2="350"/>
  </g>

  <!-- bicycle -->
  <g id="bicycle" stroke="#2d3a4a" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <g id="rear-wheel">
      <circle cx="200" cy="280" r="50"/>
      <g class="spokes" stroke-width="2">
        <line x1="200" y1="230" x2="200" y2="330"/><line x1="150" y1="280" x2="250" y2="280"/>
        <line x1="165" y1="245" x2="235" y2="315"/><line x1="235" y1="245" x2="165" y2="315"/>
        <animateTransform attributeName="transform" type="rotate" from="0 200 280" to="360 200 280" dur="1s" repeatCount="indefinite"/>
      </g>
    </g>
    <g id="front-wheel">
      <circle cx="420" cy="280" r="50"/>
      <g class="spokes" stroke-width="2">
        <line x1="420" y1="230" x2="420" y2="330"/><line x1="370" y1="280" x2="470" y2="280"/>
        <line x1="385" y1="245" x2="455" y2="315"/><line x1="455" y1="245" x2="385" y2="315"/>
        <animateTransform attributeName="transform" type="rotate" from="0 420 280" to="360 420 280" dur="1s" repeatCount="indefinite"/>
      </g>
    </g>
    <path id="frame" d="M200 280 L290 280 L370 200 L260 200 Z M290 280 L250 180 M370 200 L420 280" stroke="#e4572e"/>
    <path id="handlebar" d="M370 200 L362 168 L392 160" />
    <path id="seat" d="M232 176 L270 176" stroke-width="7"/>
    <g id="crank">
      <circle cx="290" cy="280" r="10" fill="#2d3a4a"/>
      <line x1="290" y1="280" x2="290" y2="252" stroke-width="4"/>
      <line x1="290" y1="280" x2="290" y2="308" stroke-width="4"/>
      <animateTransform attributeName="transform" type="rotate" from="0 290 280" to="360 290 280" dur="1s" repeatCount="indefinite"/>
    </g>
  </g>

  <!-- pelican -->
  <g class="rider" id="pelican">
    <path id="leg-back" d="M262 196 L276 236 L290 252" stroke="#f39c12" stroke-width="6" fill="none" stroke-linecap="round">
      <animate attributeName="d" values="M262 196 L276 236 L290 252;M262 196 L300 238 L290 308;M262 196 L276 236 L290 252" dur="1s" repeatCount="indefinite"/>
    </path>
    <ellipse id="body" cx="262" cy="160" rx="62" ry="40" fill="#f7f7f2" stroke="#c9c9c0" stroke-width="2"/>
    <path id="wing" d="M220 150 Q260 120 300 150 Q262 176 220 150 Z" fill="#dcdcd2" stroke="#b5b5aa" stroke-width="2">
      <animateTransform attributeName="transform" type="rotate" values="0 262 150;-8 262 150;0 262 150" dur="0.6s" repeatCount="indefinite"/>
    </path>
    <path id="tail" d="M200 160 L182 150 L186 170 Z" fill="#dcdcd2"/>
    <path id="neck" d="M308 140 Q330 110 322 80" stroke="#f7f7f2" stroke-width="20" fill="none" stroke-linecap="round"/>
    <circle id="head" cx="324" cy="74" r="20" fill="#f7f7f2" stroke="#c9c9c0" stroke-width="2"/>
    <circle id="eye" cx="330" cy="70" r="3.5" fill="#1f2a36"/>
    <path id="beak" d="M338 70 L398 92 L338 84 Z" fill="#f5b041" stroke="#d68910" stroke-width="2"/>
    <path id="pouch" d="M340 84 Q368 112 396 92 L338 84 Z" fill="#f8c471" stroke="#d68910" stroke-width="1.5"/>
    <path id="leg-front" d="M282 196 L300 232 L290 308" stroke="#f39c12" stroke-width="6" fill="none" stroke-linecap="round">
      <animate attributeName="d" values="M282 196 L300 232 L290 308;M282 196 L276 236 L290 252;M282 196 L300 232 L290 308" dur="1s" repeatCount="indefinite"/>
    </path>
    <path id="wing-tip-on-handlebar" d="M300 150 Q340 160 380 164" stroke="#dcdcd2" stroke-width="8" fill="none" stroke-linecap="round"/>
  </g>
</svg>
</body>
</html>`;

const LAZY_PELICAN = `<html><body><svg width="200" height="120"><circle cx="40" cy="80" r="30"/><circle cx="150" cy="80" r="30"/><text x="60" y="30">pelican</text>`;

const SUBJECT_WORDS: Record<string, string[]> = {
  polarbear: ["polar-bear", "bicycle-wheel", "snow", "iceberg"],
  ultraman: ["ultraman", "color-timer", "motorcycle-wheel", "city-building"],
  octopus: ["octopus", "tentacle", "drum", "cymbal"],
  giraffe: ["giraffe", "neck", "skateboard", "ramp"],
  mooncat: ["astronaut-cat", "helmet", "moon-crater", "fishing-rod", "star", "earth"],
  clock: ["hour-hand", "minute-hand", "second-hand"],
  solar: ["sun", "水星", "金星", "地球", "火星", "木星", "土星", "moon", "ring"],
  balls: ["ball", "gravity", "velocity", "collision"],
  gears: ["gear-12", "gear-24", "gear-36", "gear-18"],
  city: ["far-layer", "building", "window", "car", "road", "headlight"],
  strokes: ["永", "点", "横折钩", "横撇", "撇", "捺"],
  lighthouse: ["lighthouse-tower", "lamp", "beam", "wave", "boat"],
  newton: ["ball", "string", "beam", "pendulum"],
  hummingbird: ["hummingbird", "beak", "wing", "flower", "petal"],
  windmill: ["windmill", "blade", "sun", "sky"],
  rocket: ["rocket", "flame", "smoke", "countdown"],
  aquarium: ["fish", "fin", "bubble", "seaweed"],
  ecg: ["ecg-wave", "bpm", "heart", "grid"],
  traffic: ["traffic-light", "car", "road", "stop-line"],
  origami: ["paper", "fold", "crane", "step-1"],
  dna: ["helix", "strand", "base-pair", "A", "G"],
};

function genericScene(key: string): string {
  const words = SUBJECT_WORDS[key] ?? ["scene"];
  const shapes = Array.from({ length: 18 }, (_, i) => {
    const id = words[i % words.length];
    const x = 30 + ((i * 53) % 540);
    const y = 60 + ((i * 37) % 260);
    return i % 3 === 0
      ? `<circle id="${id}-${i}" cx="${x}" cy="${y}" r="${12 + (i % 5) * 4}" fill="hsl(${i * 20},70%,60%)"><animate attributeName="cy" values="${y};${y - 12};${y}" dur="${1 + (i % 4) * 0.4}s" repeatCount="indefinite"/></circle>`
      : i % 3 === 1
        ? `<rect id="${id}-${i}" x="${x}" y="${y}" width="${24 + i}" height="${18 + (i % 6) * 3}" rx="4" fill="hsl(${i * 20},60%,55%)"/>`
        : `<path id="${id}-${i}" d="M${x} ${y} q20 -30 40 0 t40 0" stroke="hsl(${i * 20},50%,40%)" stroke-width="3" fill="none"/>`;
  }).join("\n    ");
  const extra =
    key === "clock"
      ? `<script>setInterval(function(){var d=new Date();document.getElementById('label').textContent=d.toLocaleTimeString();},1000);</script>`
      : key === "balls"
        ? `<script>var gravity=0.3,vy=0;document.addEventListener('click',function(){vy=-6;});</script>`
        : key === "newton" || key === "dna"
          ? `<script>var angle=0;setInterval(function(){angle=Math.sin(Date.now()/300);},30);</script>`
        : key === "strokes"
          ? `<style>path{stroke-dasharray:200;animation:write 2s linear infinite}@keyframes write{from{stroke-dashoffset:200}to{stroke-dashoffset:0}}</style>`
          : "";
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>${key}</title>
<style>body{margin:0;background:#0f172a}svg{width:100%;height:100vh;max-height:480px}</style></head>
<body>
<svg viewBox="0 0 600 400" xmlns="http://www.w3.org/2000/svg">
  <g id="scene">
    ${shapes}
    <animateTransform attributeName="transform" type="translate" values="0 0;6 0;0 0" dur="3s" repeatCount="indefinite"/>
  </g>
  <text id="label" x="300" y="380" fill="#fff" text-anchor="middle">${words.join(" · ")}</text>
</svg>
${extra}
</body>
</html>`;
}

export function visualAnswer(smart: boolean, prompt: string): string | null {
  if (!prompt.includes("创建一个 HTML")) return null;
  if (prompt.includes("鹈鹕")) return smart ? "```html\n" + PELICAN_HTML + "\n```" : LAZY_PELICAN;
  const key =
    Object.entries({
      polarbear: "北极熊",
      ultraman: "奥特曼",
      octopus: "章鱼",
      giraffe: "长颈鹿",
      mooncat: "宇航服的猫",
      clock: "模拟时钟",
      solar: "太阳系",
      balls: "弹跳小球",
      gears: "齿轮",
      city: "城市夜景",
      strokes: "「永」",
      lighthouse: "灯塔",
      newton: "牛顿摆",
      hummingbird: "蜂鸟",
      windmill: "风车",
      rocket: "火箭发射",
      aquarium: "水族箱",
      ecg: "心电",
      traffic: "十字路口",
      origami: "纸鹤",
      dna: "DNA",
    }).find(([, word]) => prompt.includes(word))?.[0] ?? "scene";
  return smart ? genericScene(key) : `<svg><text>${key}</text></svg>`;
}
