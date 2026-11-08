// Spots popular games running on this computer so Orbit can show "Playing …".
// Only process names are read — nothing about what's inside them — and only names on this list count.
const { execFile } = require('child_process');

// process name (lowercase, no .exe) -> game name
const GAMES = {
  'fortniteclient-win64-shipping': 'Fortnite',
  'robloxplayerbeta': 'Roblox', 'robloxplayer': 'Roblox',
  'minecraft.windows': 'Minecraft', 'minecraft': 'Minecraft',
  'cs2': 'Counter-Strike 2',
  'dota2': 'Dota 2',
  'r5apex': 'Apex Legends', 'r5apex_dx12': 'Apex Legends',
  'valorant-win64-shipping': 'VALORANT',
  'league of legends': 'League of Legends',
  'overwatch': 'Overwatch 2',
  'gta5': 'Grand Theft Auto V', 'gta5_enhanced': 'Grand Theft Auto V',
  'rdr2': 'Red Dead Redemption 2',
  'rustclient': 'Rust',
  'tslgame': 'PUBG: BATTLEGROUNDS',
  'rainbowsix': 'Rainbow Six Siege', 'rainbowsix_vulkan': 'Rainbow Six Siege', 'rainbowsix_be': 'Rainbow Six Siege',
  'cod': 'Call of Duty', 'cod24-cod': 'Call of Duty',
  'bf2042': 'Battlefield 2042', 'bf6': 'Battlefield 6',
  'marvel-win64-shipping': 'Marvel Rivals',
  'escapefromtarkov': 'Escape from Tarkov',
  'rocketleague': 'Rocket League',
  'fallguys_client_game': 'Fall Guys',
  'tf_win64': 'Team Fortress 2', 'tf': 'Team Fortress 2',
  'left4dead2': 'Left 4 Dead 2',
  'gmod': "Garry's Mod",
  'deadbydaylight-win64-shipping': 'Dead by Daylight',
  'destiny2': 'Destiny 2',
  'warframe.x64': 'Warframe',
  'pathofexile': 'Path of Exile', 'pathofexile_x64': 'Path of Exile', 'pathofexilesteam': 'Path of Exile', 'pathofexile_x64steam': 'Path of Exile',
  'eldenring': 'ELDEN RING',
  'bg3': "Baldur's Gate 3", 'bg3_dx11': "Baldur's Gate 3",
  'cyberpunk2077': 'Cyberpunk 2077',
  'witcher3': 'The Witcher 3',
  'hogwartslegacy': 'Hogwarts Legacy',
  'b1-win64-shipping': 'Black Myth: Wukong',
  'monsterhunterwilds': 'Monster Hunter Wilds', 'monsterhunterworld': 'Monster Hunter: World',
  'helldivers2': 'HELLDIVERS 2',
  'palworld-win64-shipping': 'Palworld',
  'nms': "No Man's Sky",
  'sotgame': 'Sea of Thieves',
  'fsd-win64-shipping': 'Deep Rock Galactic',
  'factorygamesteam-win64-shipping': 'Satisfactory', 'factorygameegs-win64-shipping': 'Satisfactory',
  'valheim': 'Valheim',
  'terraria': 'Terraria',
  'stardew valley': 'Stardew Valley',
  'among us': 'Among Us',
  'phasmophobia': 'Phasmophobia',
  'lethal company': 'Lethal Company',
  'repo': 'R.E.P.O.',
  'peak': 'PEAK',
  'schedule i': 'Schedule I',
  'hollow knight silksong': 'Hollow Knight: Silksong',
  'geometrydash': 'Geometry Dash',
  'osu!': 'osu!',
  'factorio': 'Factorio',
  'arma3_x64': 'Arma 3',
  'dayz_x64': 'DayZ',
  'ready or not': 'Ready or Not', 'readyornot-win64-shipping': 'Ready or Not',
  'deltaforce-win64-shipping': 'Delta Force',
  'naraka': 'NARAKA: BLADEPOINT', 'narakabladepoint': 'NARAKA: BLADEPOINT',
  'rivals2-win64-shipping': 'Rivals of Aether II',
  'sf6': 'Street Fighter 6', 'streetfighter6': 'Street Fighter 6',
  'tekken8': 'TEKKEN 8',
  'efootball': 'eFootball',
  'fc25': 'EA SPORTS FC 25', 'fc26': 'EA SPORTS FC 26',
};

function listProcesses() {
  return new Promise((resolve) => {
    if (process.platform === 'win32') execFile('tasklist', ['/fo', 'csv', '/nh'], { windowsHide: true, maxBuffer: 8 << 20 }, (e, out) => resolve(e ? [] : String(out).split(/\r?\n/).map(l => (l.match(/^"([^"]+)"/) || [])[1]).filter(Boolean)));
    else execFile('ps', ['-axco', 'command'], { maxBuffer: 8 << 20 }, (e, out) => resolve(e ? [] : String(out).split('\n').slice(1).map(s => s.trim()).filter(Boolean)));
  });
}

// every known game running right now (several at once is fine)
async function detectGames() {
  const found = new Set();
  for (const n of await listProcesses()) { const g = GAMES[n.toLowerCase().replace(/\.exe$/, '')]; if (g) found.add(g); }
  return [...found];
}

// calls onChange([game names]) whenever the set of running games changes; games you started first stay first
function watchGames(onChange, everyMs = 15000) {
  let current = [], busy = false;
  const tick = async () => {
    if (busy) return; busy = true;
    try {
      const now = await detectGames();
      const next = [...current.filter(g => now.includes(g)), ...now.filter(g => !current.includes(g))];
      if (next.join('|') !== current.join('|')) { current = next; onChange(next.length ? next : null); }
    } catch {} finally { busy = false; }
  };
  tick(); const t = setInterval(tick, everyMs);
  return { stop: () => clearInterval(t), current: () => (current.length ? current : null) };
}

module.exports = { watchGames, GAMES };
