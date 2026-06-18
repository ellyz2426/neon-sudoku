import {
	World,
	createSystem,
	PanelUI,
	PanelDocument,
	UIKitDocument,
	UIKit,
	Follower,
	ScreenSpace,
	eq,
	BoxGeometry,
	MeshStandardMaterial,
	MeshBasicMaterial,
	Mesh,
	Group,
	SphereGeometry,
	PlaneGeometry,
	LineSegments,
	BufferGeometry,
	Float32BufferAttribute,
	LineBasicMaterial,
	Color,
	Vector3,
	Raycaster,
	Vector2,
	AdditiveBlending,
	FogExp2,
	TorusGeometry,
	ConeGeometry,
	PointLight,
	DirectionalLight,
	AmbientLight,
	Object3D,
	InputComponent,
} from '@iwsdk/core';

// ===== TYPES =====
type GameState = 'title' | 'modeSelect' | 'difficulty' | 'playing' | 'paused' | 'complete' | 'leaderboard' | 'achvlist' | 'settings' | 'stats' | 'help';
type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';
type GameMode = 'classic' | 'timed' | 'daily' | 'zen' | 'speed' | 'practice';

interface CellData {
	value: number;
	solution: number;
	isGiven: boolean;
	pencilMarks: boolean[];
	meshBg: Mesh;
	segmentGroup: Group;
	segments: Mesh[];
	pencilDots: Mesh[];
}

interface LeaderboardEntry {
	score: number;
	mode: string;
	difficulty: string;
	time: number;
	date: string;
}

interface Achievement {
	id: string;
	name: string;
	desc: string;
	check: () => boolean;
}

interface SavedGame {
	board: { value: number; solution: number; isGiven: boolean; pencilMarks: boolean[] }[][];
	mode: GameMode;
	difficulty: Difficulty;
	timer: number;
	score: number;
	mistakes: number;
	hintsUsed: number;
	cellsCompleted: number;
	totalCells: number;
	pencilMode: boolean;
	comboCount: number;
	bestCombo: number;
	undoStack: { r: number; c: number; oldVal: number; oldPencil: boolean[] }[];
}

// ===== CONSTANTS =====
const CELL_SIZE = 0.058;
const CELL_GAP = 0.004;
const BOX_GAP = 0.01;
const BOARD_Y = 1.45;
const BOARD_Z = -1.6;

const SEG_LEN = 0.018;
const SEG_THICK = 0.003;
const SEG_DEPTH = 0.003;

const DIGIT_SEGS: Record<number, number[]> = {
	1: [1, 2],
	2: [0, 1, 6, 4, 3],
	3: [0, 1, 6, 2, 3],
	4: [5, 6, 1, 2],
	5: [0, 5, 6, 2, 3],
	6: [0, 5, 4, 3, 2, 6],
	7: [0, 1, 2],
	8: [0, 1, 2, 3, 4, 5, 6],
	9: [0, 1, 2, 3, 5, 6],
};

// Segment positions: [x, y, isHorizontal]
const SEG_POS: [number, number, boolean][] = [
	[0, SEG_LEN * 0.55 + SEG_THICK, true],     // 0: top
	[SEG_LEN * 0.55, SEG_LEN * 0.3 + SEG_THICK * 0.5, false], // 1: top-right
	[SEG_LEN * 0.55, -(SEG_LEN * 0.3 + SEG_THICK * 0.5), false], // 2: bot-right
	[0, -(SEG_LEN * 0.55 + SEG_THICK), true],   // 3: bottom
	[-(SEG_LEN * 0.55), -(SEG_LEN * 0.3 + SEG_THICK * 0.5), false], // 4: bot-left
	[-(SEG_LEN * 0.55), SEG_LEN * 0.3 + SEG_THICK * 0.5, false],   // 5: top-left
	[0, 0, true], // 6: middle
];

const THEMES = [
	{ name: 'Neon Holodeck', grid: 0x00ffff, accent: 0x00ffff, bg: 0x000a0a, given: 0x00ddff, placed: 0x00ff88, conflict: 0xff3333, selected: 0xffff00, highlight: 0x002828, fog: 0x000808, wall: 0x001414, cellBg: 0x001a1a, cellBorder: 0x004444 },
	{ name: 'Crimson Arena', grid: 0xff3344, accent: 0xff4455, bg: 0x0a0000, given: 0xff6677, placed: 0xffaa33, conflict: 0xff0000, selected: 0xffff00, highlight: 0x280000, fog: 0x080000, wall: 0x140000, cellBg: 0x1a0005, cellBorder: 0x440011 },
	{ name: 'Toxic Neon', grid: 0x33ff44, accent: 0x44ff55, bg: 0x000a00, given: 0x66ff77, placed: 0xaaff33, conflict: 0xff3333, selected: 0xffff00, highlight: 0x002800, fog: 0x000800, wall: 0x001400, cellBg: 0x001a00, cellBorder: 0x004400 },
	{ name: 'Ultra Violet', grid: 0x9933ff, accent: 0xaa44ff, bg: 0x05000a, given: 0xbb66ff, placed: 0xff66aa, conflict: 0xff3333, selected: 0xffff00, highlight: 0x140028, fog: 0x040008, wall: 0x0a0014, cellBg: 0x0d001a, cellBorder: 0x330044 },
	{ name: 'Solar Blaze', grid: 0xff8800, accent: 0xffaa33, bg: 0x0a0500, given: 0xffbb44, placed: 0xffdd00, conflict: 0xff3333, selected: 0xffff00, highlight: 0x281400, fog: 0x080400, wall: 0x140a00, cellBg: 0x1a0d00, cellBorder: 0x443300 },
];

const MODE_NAMES: Record<GameMode, string> = {
	classic: 'Classic', timed: 'Timed', daily: 'Daily Challenge',
	zen: 'Zen', speed: 'Speed', practice: 'Practice',
};

const DIFF_CLUES: Record<Difficulty, number> = { easy: 38, medium: 30, hard: 25, expert: 20 };
const TIMED_SECONDS: Record<Difficulty, number> = { easy: 600, medium: 480, hard: 360, expert: 300 };

// ===== SUDOKU GENERATOR =====
function shuffle<T>(arr: T[]): T[] {
	const a = [...arr];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

function seededRandom(seed: number): () => number {
	let s = seed;
	return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
}

function seededShuffle<T>(arr: T[], rng: () => number): T[] {
	const a = [...arr];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

function isValidPlacement(grid: number[][], r: number, c: number, n: number): boolean {
	for (let i = 0; i < 9; i++) { if (grid[r][i] === n) return false; }
	for (let i = 0; i < 9; i++) { if (grid[i][c] === n) return false; }
	const br = Math.floor(r / 3) * 3, bc = Math.floor(c / 3) * 3;
	for (let i = br; i < br + 3; i++)
		for (let j = bc; j < bc + 3; j++)
			if (grid[i][j] === n) return false;
	return true;
}

function fillGrid(grid: number[][], pos: number): boolean {
	if (pos === 81) return true;
	const r = Math.floor(pos / 9), c = pos % 9;
	const nums = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
	for (const n of nums) {
		if (isValidPlacement(grid, r, c, n)) {
			grid[r][c] = n;
			if (fillGrid(grid, pos + 1)) return true;
			grid[r][c] = 0;
		}
	}
	return false;
}

function fillGridSeeded(grid: number[][], pos: number, rng: () => number): boolean {
	if (pos === 81) return true;
	const r = Math.floor(pos / 9), c = pos % 9;
	const nums = seededShuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], rng);
	for (const n of nums) {
		if (isValidPlacement(grid, r, c, n)) {
			grid[r][c] = n;
			if (fillGridSeeded(grid, pos + 1, rng)) return true;
			grid[r][c] = 0;
		}
	}
	return false;
}

function countSolutions(grid: number[][], max: number = 2): number {
	const copy = grid.map(r => [...r]);
	let count = 0;
	function solve(pos: number): boolean {
		if (count >= max) return true;
		if (pos === 81) { count++; return count >= max; }
		const r = Math.floor(pos / 9), c = pos % 9;
		if (copy[r][c] !== 0) return solve(pos + 1);
		for (let n = 1; n <= 9; n++) {
			if (isValidPlacement(copy, r, c, n)) {
				copy[r][c] = n;
				if (solve(pos + 1)) return true;
				copy[r][c] = 0;
			}
		}
		return false;
	}
	solve(0);
	return count;
}

function generatePuzzle(clueCount: number, rng?: () => number): { puzzle: number[][]; solution: number[][] } {
	const solution: number[][] = Array.from({ length: 9 }, () => Array(9).fill(0));
	if (rng) fillGridSeeded(solution, 0, rng); else fillGrid(solution, 0);
	const puzzle = solution.map(r => [...r]);
	const positions = rng ? seededShuffle(Array.from({ length: 81 }, (_, i) => i), rng) : shuffle(Array.from({ length: 81 }, (_, i) => i));
	let removed = 0;
	for (const pos of positions) {
		if (81 - removed <= clueCount) break;
		const r = Math.floor(pos / 9), c = pos % 9;
		const val = puzzle[r][c];
		if (val === 0) continue;
		puzzle[r][c] = 0;
		if (clueCount < 32 && countSolutions(puzzle) !== 1) {
			puzzle[r][c] = val;
		} else {
			removed++;
		}
	}
	return { puzzle, solution };
}


// ===== AUDIO MANAGER =====
class AudioManager {
	private ctx: AudioContext | null = null;
	private masterGain: GainNode | null = null;
	private sfxGain: GainNode | null = null;
	private musicGain: GainNode | null = null;
	private droneOscs: OscillatorNode[] = [];
	masterVol = 0.7; sfxVol = 0.8; musicVol = 0.3;

	init() {
		if (this.ctx) return;
		this.ctx = new AudioContext();
		this.masterGain = this.ctx.createGain();
		this.masterGain.gain.value = this.masterVol;
		this.masterGain.connect(this.ctx.destination);
		this.sfxGain = this.ctx.createGain();
		this.sfxGain.gain.value = this.sfxVol;
		this.sfxGain.connect(this.masterGain);
		this.musicGain = this.ctx.createGain();
		this.musicGain.gain.value = this.musicVol;
		this.musicGain.connect(this.masterGain);
	}

	startDrone() {
		if (!this.ctx || !this.musicGain || this.droneOscs.length > 0) return;
		const freqs = [55, 82.5, 110];
		const types: OscillatorType[] = ['sine', 'triangle', 'sine'];
		for (let i = 0; i < 3; i++) {
			const osc = this.ctx.createOscillator();
			const g = this.ctx.createGain();
			const lp = this.ctx.createBiquadFilter();
			osc.type = types[i]; osc.frequency.value = freqs[i];
			g.gain.value = i === 0 ? 0.15 : 0.08;
			lp.type = 'lowpass'; lp.frequency.value = 400;
			osc.connect(g).connect(lp).connect(this.musicGain!);
			osc.start();
			this.droneOscs.push(osc);
		}
		const lfo = this.ctx.createOscillator();
		const lfoG = this.ctx.createGain();
		lfo.type = 'sine'; lfo.frequency.value = 0.15;
		lfoG.gain.value = 30;
		lfo.connect(lfoG);
		lfo.start();
		this.droneOscs.push(lfo);
	}

	private tone(freq: number, type: OscillatorType, dur: number, vol: number = 0.15) {
		if (!this.ctx || !this.sfxGain) return;
		const osc = this.ctx.createOscillator();
		const g = this.ctx.createGain();
		const pitch = 1 + (Math.random() - 0.5) * 0.06;
		osc.type = type; osc.frequency.value = freq * pitch;
		g.gain.value = vol;
		g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
		osc.connect(g).connect(this.sfxGain);
		osc.start(); osc.stop(this.ctx.currentTime + dur);
	}

	playSelect() { this.tone(880, 'sine', 0.08, 0.12); }
	playPlace() { this.tone(660, 'triangle', 0.12, 0.15); this.tone(990, 'sine', 0.15, 0.1); }
	playComboPlace(combo: number) {
		// Escalating pitch and richness for combo streaks
		const pitchMult = 1 + (Math.min(combo, 10) - 1) * 0.08;
		this.tone(660 * pitchMult, 'triangle', 0.12 + combo * 0.01, 0.15);
		this.tone(990 * pitchMult, 'sine', 0.15 + combo * 0.01, 0.1);
		if (combo >= 3) this.tone(1320 * pitchMult, 'sine', 0.1, 0.06);
		if (combo >= 5) this.tone(1650 * pitchMult, 'triangle', 0.08, 0.04);
	}
	playConflict() { this.tone(200, 'sawtooth', 0.2, 0.12); this.tone(150, 'square', 0.25, 0.08); }
	playErase() { this.tone(440, 'sine', 0.08, 0.08); }
	playHint() { this.tone(1100, 'sine', 0.1, 0.1); this.tone(1320, 'sine', 0.12, 0.08); }
	playPencil() { this.tone(1200, 'triangle', 0.06, 0.06); }
	playUndo() { this.tone(330, 'sine', 0.1, 0.1); }
	playClick() { this.tone(1000, 'sine', 0.04, 0.08); }
	playCountdown() { this.tone(660, 'sine', 0.15, 0.12); }
	playGo() { this.tone(880, 'sine', 0.2, 0.15); this.tone(1320, 'sine', 0.25, 0.1); }

	playComplete() {
		const notes = [523, 659, 784, 1047, 1319];
		notes.forEach((f, i) => setTimeout(() => this.tone(f, 'sine', 0.3, 0.15), i * 100));
	}

	playGameOver() {
		const notes = [440, 392, 349, 294];
		notes.forEach((f, i) => setTimeout(() => this.tone(f, 'triangle', 0.3, 0.12), i * 120));
	}

	playAchievement() {
		const notes = [660, 784, 880, 1047, 1320];
		notes.forEach((f, i) => setTimeout(() => this.tone(f, 'sine', 0.15, 0.1), i * 60));
	}

	playLevelUp() {
		const notes = [440, 554, 659, 880, 1047, 1320];
		notes.forEach((f, i) => setTimeout(() => this.tone(f, 'sine', 0.2, 0.12), i * 80));
	}

	updateVolumes() {
		if (this.masterGain) this.masterGain.gain.value = this.masterVol;
		if (this.sfxGain) this.sfxGain.gain.value = this.sfxVol;
		if (this.musicGain) this.musicGain.gain.value = this.musicVol;
	}
}

// ===== PARTICLE SYSTEM =====
interface Particle { mesh: Mesh; vx: number; vy: number; vz: number; life: number; maxLife: number; }

class ParticlePool {
	particles: Particle[] = [];
	private scene: Object3D;
	constructor(scene: Object3D, count: number = 120) {
		this.scene = scene;
		const geo = new SphereGeometry(0.006, 4, 4);
		for (let i = 0; i < count; i++) {
			const mat = new MeshBasicMaterial({ color: 0x00ffff, transparent: true, blending: AdditiveBlending });
			const mesh = new Mesh(geo, mat);
			mesh.visible = false;
			scene.add(mesh);
			this.particles.push({ mesh, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 0 });
		}
	}

	burst(x: number, y: number, z: number, color: number, count: number = 12) {
		let spawned = 0;
		for (const p of this.particles) {
			if (p.life > 0 || spawned >= count) continue;
			p.mesh.position.set(x, y, z);
			p.vx = (Math.random() - 0.5) * 1.5;
			p.vy = Math.random() * 2 + 0.5;
			p.vz = (Math.random() - 0.5) * 1.5;
			p.life = 0.6 + Math.random() * 0.4;
			p.maxLife = p.life;
			(p.mesh.material as MeshBasicMaterial).color.set(color);
			p.mesh.visible = true;
			spawned++;
		}
	}

	update(dt: number) {
		for (const p of this.particles) {
			if (p.life <= 0) continue;
			p.life -= dt;
			p.mesh.position.x += p.vx * dt;
			p.mesh.position.y += p.vy * dt;
			p.mesh.position.z += p.vz * dt;
			p.vy -= 3 * dt;
			const t = Math.max(0, p.life / p.maxLife);
			(p.mesh.material as MeshBasicMaterial).opacity = t;
			p.mesh.scale.setScalar(t);
			if (p.life <= 0) p.mesh.visible = false;
		}
	}
}


// ===== GAME STATE PERSISTENCE =====
const STORAGE_KEY = 'neon_sudoku_';
function loadData<T>(key: string, def: T): T {
	try { const v = localStorage.getItem(STORAGE_KEY + key); return v ? JSON.parse(v) : def; } catch { return def; }
}
function saveData(key: string, val: unknown) {
	try { localStorage.setItem(STORAGE_KEY + key, JSON.stringify(val)); } catch { /* noop */ }
}

// ===== MAIN GAME SYSTEM =====
class SudokuGame extends createSystem({
	titlePanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/title.json')] },
	modePanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/modeselect.json')] },
	diffPanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/difficulty.json')] },
	hudPanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/hud.json')] },
	numpadPanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/numpad.json')] },
	pausePanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/pause.json')] },
	gameoverPanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/gameover.json')] },
	lbPanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/leaderboard.json')] },
	achvPanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/achvlist.json')] },
	settingsPanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/settings.json')] },
	statsPanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/stats.json')] },
	helpPanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/help.json')] },
	toastPanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/toast.json')] },
	countdownPanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/countdown.json')] },
}) {
	private audio = new AudioManager();
	private particles!: ParticlePool;
	private state: GameState = 'title';
	private mode: GameMode = 'classic';
	private difficulty: Difficulty = 'easy';
	private cells: CellData[][] = [];
	private gridGroup!: Group;
	private selectedRow = -1;
	private selectedCol = -1;
	private pencilMode = false;
	private timer = 0;
	private timerRunning = false;
	private mistakes = 0;
	private maxMistakes = 3;
	private score = 0;
	private hintsUsed = 0;
	private cellsCompleted = 0;
	private totalCells = 0;
	private undoStack: { r: number; c: number; oldVal: number; oldPencil: boolean[] }[] = [];
	private themeIdx = 0;
	private panelEntities: Map<string, any> = new Map();
	private raycaster = new Raycaster();
	private mouse = new Vector2();
	private cellMeshes: Mesh[] = [];
	private isMouseDown = false;
	private toastQueue: string[] = [];
	private toastTimer = 0;
	private countdownVal = 0;
	private countdownTimer = 0;
	private achievementsUnlocked: Set<string> = new Set();
	private achvPage = 0;
	private comboCount = 0;
	private bestCombo = 0;
	private checkHighlightTimer = 0;
	private glowCells: { r: number; c: number; timer: number }[] = [];
	private xpGained = 0;
	private selectedNum = 0; // currently active number on numpad
	private rippleActive = false;
	private rippleTimer = 0;
	private rippleCells: { r: number; c: number; delay: number }[] = [];
	private selectionPulseTimer = 0;
	private timeWarningFlash = 0;
	private xrStickCooldown = 0;
	private nakedSingles: { r: number; c: number }[] = [];
	private digitPlaceAnims: { r: number; c: number; timer: number }[] = [];
	private lineCompleteCells: { r: number; c: number; timer: number }[] = [];

	// Career stats
	private career = {
		games: 0, wins: 0, bestTime: Infinity, totalTime: 0,
		totalMistakes: 0, totalHints: 0, puzzlesSolved: 0,
		perfectGames: 0, streak: 0, bestStreak: 0,
		easyWins: 0, mediumWins: 0, hardWins: 0, expertWins: 0,
		dailyDone: 0, dailyStreak: 0, lastDaily: '', level: 1, xp: 0,
	};
	private leaderboard: LeaderboardEntry[] = [];

	// Environment
	private decorations: { mesh: Mesh; rotSpeed: number; bobSpeed: number; bobAmt: number; baseY: number }[] = [];
	private ambientParticles: { mesh: Mesh; vx: number; vy: number; baseOpacity: number; phase: number }[] = [];
	private envLights: PointLight[] = [];

	get theme() { return THEMES[this.themeIdx]; }

	init() {
		this.loadCareer();
		this.audio.init();
		this.audio.startDrone();
		this.particles = new ParticlePool(this.world.scene, 120);
		this.createEnvironment();
		this.createGrid();
		this.createPanels();
		this.setupInput();
	}

	// ===== ENVIRONMENT =====
	private createEnvironment() {
		const t = this.theme;
		this.world.scene.background = new Color(t.bg);
		this.world.scene.fog = new FogExp2(t.fog, 0.15);

		const ambient = new AmbientLight(t.accent, 0.3);
		this.world.scene.add(ambient);
		const dir = new DirectionalLight(0xffffff, 0.4);
		dir.position.set(2, 4, 2);
		this.world.scene.add(dir);

		// Grid floor + ceiling
		const gridMat = new LineBasicMaterial({ color: t.grid, transparent: true, opacity: 0.12 });
		for (const isFloor of [true, false]) {
			const pts: number[] = [];
			for (let i = -10; i <= 10; i++) {
				pts.push(i, 0, -10, i, 0, 10);
				pts.push(-10, 0, i, 10, 0, i);
			}
			const geo = new BufferGeometry();
			geo.setAttribute('position', new Float32BufferAttribute(pts, 3));
			const grid = new LineSegments(geo, gridMat);
			grid.position.y = isFloor ? 0 : 3;
			this.world.scene.add(grid);
		}

		// Accent lights
		const lightColors = [t.accent, 0xff00ff, t.grid];
		const lightPositions = [[2, 2, -1], [-2, 2, -1], [0, 2.5, -2]];
		for (let i = 0; i < 3; i++) {
			const pl = new PointLight(lightColors[i], 0.4, 8);
			pl.position.set(lightPositions[i][0], lightPositions[i][1], lightPositions[i][2]);
			this.world.scene.add(pl);
			this.envLights.push(pl);
		}

		// Floating decorations
		const shapes = [
			() => new TorusGeometry(0.12, 0.02, 8, 16),
			() => new BoxGeometry(0.15, 0.15, 0.15),
			() => new SphereGeometry(0.1, 8, 8),
			() => new ConeGeometry(0.08, 0.2, 6),
		];
		for (let i = 0; i < 14; i++) {
			const geo = shapes[i % shapes.length]();
			const mat = new MeshStandardMaterial({ color: t.accent, emissive: t.accent, emissiveIntensity: 0.3, wireframe: true, transparent: true, opacity: 0.4 });
			const mesh = new Mesh(geo, mat);
			const angle = (i / 14) * Math.PI * 2;
			const dist = 3 + Math.random() * 3;
			mesh.position.set(Math.cos(angle) * dist, 0.5 + Math.random() * 2, Math.sin(angle) * dist - 2);
			this.world.scene.add(mesh);
			this.decorations.push({ mesh, rotSpeed: 0.2 + Math.random() * 0.5, bobSpeed: 0.3 + Math.random() * 0.4, bobAmt: 0.1 + Math.random() * 0.15, baseY: mesh.position.y });
		}

		// Ambient particles
		const pGeo = new SphereGeometry(0.008, 4, 4);
		for (let i = 0; i < 40; i++) {
			const mat = new MeshBasicMaterial({ color: t.accent, transparent: true, opacity: 0.3, blending: AdditiveBlending });
			const mesh = new Mesh(pGeo, mat);
			mesh.position.set((Math.random() - 0.5) * 10, Math.random() * 3, (Math.random() - 0.5) * 10 - 2);
			this.world.scene.add(mesh);
			this.ambientParticles.push({ mesh, vx: (Math.random() - 0.5) * 0.1, vy: (Math.random() - 0.5) * 0.05, baseOpacity: 0.2 + Math.random() * 0.3, phase: Math.random() * Math.PI * 2 });
		}
	}


	// ===== GRID CREATION =====
	private createGrid() {
		this.gridGroup = new Group();
		this.gridGroup.position.set(0, BOARD_Y, BOARD_Z);
		this.world.scene.add(this.gridGroup);

		const t = this.theme;
		const hSegGeo = new BoxGeometry(SEG_LEN, SEG_THICK, SEG_DEPTH);
		const vSegGeo = new BoxGeometry(SEG_THICK, SEG_LEN * 0.52, SEG_DEPTH);
		const cellGeo = new PlaneGeometry(CELL_SIZE, CELL_SIZE);
		const pencilGeo = new SphereGeometry(0.003, 4, 4);

		this.cells = [];
		this.cellMeshes = [];

		for (let r = 0; r < 9; r++) {
			this.cells[r] = [];
			for (let c = 0; c < 9; c++) {
				const pos = this.cellPosition(r, c);

				// Cell background
				const bgMat = new MeshStandardMaterial({ color: t.cellBg, emissive: t.cellBg, emissiveIntensity: 0.2, transparent: true, opacity: 0.9 });
				const bgMesh = new Mesh(cellGeo, bgMat);
				bgMesh.position.set(pos.x, pos.y, 0);
				(bgMesh as any)._row = r;
				(bgMesh as any)._col = c;
				this.gridGroup.add(bgMesh);
				this.cellMeshes.push(bgMesh);

				// Cell border
				const borderPts: number[] = [];
				const hs = CELL_SIZE / 2;
				borderPts.push(-hs, -hs, 0.001, hs, -hs, 0.001);
				borderPts.push(hs, -hs, 0.001, hs, hs, 0.001);
				borderPts.push(hs, hs, 0.001, -hs, hs, 0.001);
				borderPts.push(-hs, hs, 0.001, -hs, -hs, 0.001);
				const borderGeo = new BufferGeometry();
				borderGeo.setAttribute('position', new Float32BufferAttribute(borderPts, 3));
				const border = new LineSegments(borderGeo, new LineBasicMaterial({ color: t.cellBorder, transparent: true, opacity: 0.5 }));
				border.position.set(pos.x, pos.y, 0);
				this.gridGroup.add(border);

				// Seven-segment number display
				const segGroup = new Group();
				segGroup.position.set(pos.x, pos.y, 0.005);
				const segs: Mesh[] = [];
				for (let s = 0; s < 7; s++) {
					const [sx, sy, isH] = SEG_POS[s];
					const geo = isH ? hSegGeo : vSegGeo;
					const mat = new MeshStandardMaterial({ color: t.given, emissive: t.given, emissiveIntensity: 0.8, transparent: true });
					const mesh = new Mesh(geo, mat);
					mesh.position.set(sx, sy, 0);
					mesh.visible = false;
					segGroup.add(mesh);
					segs.push(mesh);
				}
				this.gridGroup.add(segGroup);

				// Pencil mark dots
				const pencilDots: Mesh[] = [];
				for (let d = 0; d < 9; d++) {
					const pr = Math.floor(d / 3);
					const pc = d % 3;
					const dx = (pc - 1) * 0.015;
					const dy = (1 - pr) * 0.015;
					const mat = new MeshBasicMaterial({ color: t.accent, transparent: true, opacity: 0.7, blending: AdditiveBlending });
					const dot = new Mesh(pencilGeo, mat);
					dot.position.set(pos.x + dx, pos.y + dy, 0.005);
					dot.visible = false;
					this.gridGroup.add(dot);
					pencilDots.push(dot);
				}

				this.cells[r][c] = {
					value: 0, solution: 0, isGiven: false,
					pencilMarks: Array(9).fill(false),
					meshBg: bgMesh, segmentGroup: segGroup, segments: segs, pencilDots,
				};
			}
		}

		// 3x3 box borders (thicker lines)
		const boxBorderMat = new LineBasicMaterial({ color: t.accent, transparent: true, opacity: 0.8 });
		for (let br = 0; br < 3; br++) {
			for (let bc = 0; bc < 3; bc++) {
				const topLeft = this.cellPosition(br * 3, bc * 3);
				const botRight = this.cellPosition(br * 3 + 2, bc * 3 + 2);
				const x1 = topLeft.x - CELL_SIZE / 2 - 0.001;
				const y1 = topLeft.y + CELL_SIZE / 2 + 0.001;
				const x2 = botRight.x + CELL_SIZE / 2 + 0.001;
				const y2 = botRight.y - CELL_SIZE / 2 - 0.001;
				const pts: number[] = [];
				pts.push(x1, y1, 0.002, x2, y1, 0.002);
				pts.push(x2, y1, 0.002, x2, y2, 0.002);
				pts.push(x2, y2, 0.002, x1, y2, 0.002);
				pts.push(x1, y2, 0.002, x1, y1, 0.002);
				const geo = new BufferGeometry();
				geo.setAttribute('position', new Float32BufferAttribute(pts, 3));
				const line = new LineSegments(geo, boxBorderMat);
				this.gridGroup.add(line);
			}
		}

		this.gridGroup.visible = false;
	}

	private cellPosition(r: number, c: number): { x: number; y: number } {
		const boxW = 3 * CELL_SIZE + 2 * CELL_GAP;
		const totalW = 3 * boxW + 2 * BOX_GAP;
		const bc = Math.floor(c / 3);
		const cc = c % 3;
		const x = -totalW / 2 + bc * (boxW + BOX_GAP) + cc * (CELL_SIZE + CELL_GAP) + CELL_SIZE / 2;
		const br = Math.floor(r / 3);
		const cr = r % 3;
		const y = totalW / 2 - br * (boxW + BOX_GAP) - cr * (CELL_SIZE + CELL_GAP) - CELL_SIZE / 2;
		return { x, y };
	}


	// ===== PANEL CREATION =====
	private createPanels() {
		const configs = [
			'title', 'modeselect', 'difficulty', 'hud', 'numpad',
			'pause', 'gameover', 'leaderboard', 'achvlist',
			'settings', 'stats', 'help', 'toast', 'countdown',
		];
		const hudPanels = ['hud', 'toast', 'countdown'];

		for (const name of configs) {
			const entity = this.world.createTransformEntity();
			entity.addComponent(PanelUI, { config: `./ui/${name}.json` });

			if (hudPanels.includes(name)) {
				entity.addComponent(Follower);
				const ov = entity.getVectorView(Follower, 'offsetPosition');
				if (name === 'hud') { ov[0] = 0; ov[1] = 0.15; ov[2] = -0.6; }
				else if (name === 'toast') { ov[0] = 0; ov[1] = -0.12; ov[2] = -0.6; }
				else if (name === 'countdown') { ov[0] = 0; ov[1] = 0; ov[2] = -0.5; }
				entity.addComponent(ScreenSpace, {});
			}

			this.panelEntities.set(name, entity);
		}

		// Numpad positioned next to grid
		const numpadEntity = this.panelEntities.get('numpad');
		if (numpadEntity && numpadEntity.object3D) {
			numpadEntity.object3D.position.set(0.45, BOARD_Y, BOARD_Z);
		}
	}

	// ===== PANEL WIRING =====
	private getDoc(queryName: string): UIKitDocument | undefined {
		const results = (this.queries as any)[queryName + 'Panel']?.results;
		if (!results || results.length === 0) return undefined;
		const entity = results[0];
		return PanelDocument.data.document[entity.index] as UIKitDocument | undefined;
	}

	private setText(queryName: string, id: string, text: string) {
		const doc = this.getDoc(queryName);
		(doc?.getElementById(id) as UIKit.Text | undefined)?.setProperties({ text });
	}

	private setVis(queryName: string, id: string, visible: boolean) {
		const doc = this.getDoc(queryName);
		(doc?.getElementById(id) as any)?.setProperties({ display: visible ? 'flex' : 'none' });
	}

	private wireButton(queryName: string, id: string, handler: () => void) {
		const doc = this.getDoc(queryName);
		const btn = doc?.getElementById(id) as UIKit.Text | undefined;
		btn?.addEventListener('click', handler);
	}

	private showPanel(name: string, visible: boolean) {
		const doc = this.getDoc(name);
		if (!doc) return;
		const root = doc.getElementById('root') as any;
		root?.setProperties({ display: visible ? 'flex' : 'none' });
	}

	private hideAll() {
		const panels = ['title', 'mode', 'diff', 'hud', 'numpad', 'pause', 'gameover', 'lb', 'achv', 'settings', 'stats', 'help', 'toast', 'countdown'];
		for (const p of panels) this.showPanel(p, false);
		this.gridGroup.visible = false;
	}

	// Panel qualify wiring
	private panelsWired = new Set<string>();

	private tryWirePanel(queryName: string, wireFn: () => void) {
		if (this.panelsWired.has(queryName)) return;
		const doc = this.getDoc(queryName);
		if (!doc) return;
		this.panelsWired.add(queryName);
		wireFn();
	}

	private wireAllPanels() {
		this.tryWirePanel('title', () => {
			this.wireButton('title', 'btn-continue', () => { this.audio.playClick(); this.loadSavedGame(); });
			this.wireButton('title', 'btn-play', () => { this.audio.playClick(); this.clearSavedGame(); this.setState('modeSelect'); });
			this.wireButton('title', 'btn-scores', () => { this.audio.playClick(); this.setState('leaderboard'); });
			this.wireButton('title', 'btn-achv', () => { this.audio.playClick(); this.achvPage = 0; this.setState('achvlist'); });
			this.wireButton('title', 'btn-stats', () => { this.audio.playClick(); this.setState('stats'); });
			this.wireButton('title', 'btn-settings', () => { this.audio.playClick(); this.setState('settings'); });
			this.wireButton('title', 'btn-help', () => { this.audio.playClick(); this.setState('help'); });
			this.updateTitlePanel();
			this.setState('title');
		});

		this.tryWirePanel('mode', () => {
			const modes: GameMode[] = ['classic', 'timed', 'daily', 'zen', 'speed', 'practice'];
			for (const m of modes) {
				this.wireButton('mode', `btn-${m}`, () => { this.audio.playClick(); this.mode = m; this.setState('difficulty'); });
			}
			this.wireButton('mode', 'btn-back', () => { this.audio.playClick(); this.setState('title'); });
		});

		this.tryWirePanel('diff', () => {
			const diffs: Difficulty[] = ['easy', 'medium', 'hard', 'expert'];
			for (const d of diffs) {
				this.wireButton('diff', `btn-${d}`, () => { this.audio.playClick(); this.difficulty = d; this.startGame(); });
			}
			this.wireButton('diff', 'btn-back', () => { this.audio.playClick(); this.setState('modeSelect'); });
			this.updateDifficultyPanel();
		});

		this.tryWirePanel('numpad', () => {
			for (let n = 1; n <= 9; n++) {
				const num = n;
				this.wireButton('numpad', `btn-${n}`, () => { this.selectedNum = num; this.placeNumber(num); this.updateNumpadHighlight(); });
			}
			this.wireButton('numpad', 'btn-clear', () => { this.selectedNum = 0; this.eraseCell(); this.updateNumpadHighlight(); });
			this.wireButton('numpad', 'btn-pencil', () => this.togglePencil());
			this.wireButton('numpad', 'btn-hint', () => this.useHint());
			this.wireButton('numpad', 'btn-undo', () => this.undoAction());
			this.wireButton('numpad', 'btn-autopencil', () => this.autoPencil());
			this.wireButton('numpad', 'btn-check', () => this.checkBoardErrors());
			this.wireButton('numpad', 'btn-nav-up', () => this.navigateCell(-1, 0));
			this.wireButton('numpad', 'btn-nav-down', () => this.navigateCell(1, 0));
			this.wireButton('numpad', 'btn-nav-left', () => this.navigateCell(0, -1));
			this.wireButton('numpad', 'btn-nav-right', () => this.navigateCell(0, 1));
		});

		this.tryWirePanel('pause', () => {
			this.wireButton('pause', 'btn-resume', () => { this.audio.playClick(); this.setState('playing'); });
			this.wireButton('pause', 'btn-save-quit', () => { this.audio.playClick(); this.saveGameState(); this.showToast('Game saved!'); this.setState('title'); });
			this.wireButton('pause', 'btn-reset', () => { this.audio.playClick(); this.resetBoard(); this.setState('playing'); });
			this.wireButton('pause', 'btn-quit', () => { this.audio.playClick(); this.clearSavedGame(); this.setState('title'); });
		});

		this.tryWirePanel('gameover', () => {
			this.wireButton('gameover', 'btn-rematch', () => { this.audio.playClick(); this.startGame(); });
			this.wireButton('gameover', 'btn-menu', () => { this.audio.playClick(); this.setState('title'); });
		});

		this.tryWirePanel('lb', () => {
			this.wireButton('lb', 'btn-back', () => { this.audio.playClick(); this.setState('title'); });
		});

		this.tryWirePanel('achv', () => {
			this.wireButton('achv', 'btn-back', () => { this.audio.playClick(); this.setState('title'); });
			this.wireButton('achv', 'btn-prev', () => { if (this.achvPage > 0) { this.achvPage--; this.updateAchvPanel(); } });
			this.wireButton('achv', 'btn-next', () => { this.achvPage++; this.updateAchvPanel(); });
		});

		this.tryWirePanel('settings', () => {
			this.wireButton('settings', 'btn-master-up', () => { this.audio.masterVol = Math.min(1, this.audio.masterVol + 0.1); this.audio.updateVolumes(); this.updateSettingsPanel(); });
			this.wireButton('settings', 'btn-master-down', () => { this.audio.masterVol = Math.max(0, this.audio.masterVol - 0.1); this.audio.updateVolumes(); this.updateSettingsPanel(); });
			this.wireButton('settings', 'btn-sfx-up', () => { this.audio.sfxVol = Math.min(1, this.audio.sfxVol + 0.1); this.audio.updateVolumes(); this.updateSettingsPanel(); });
			this.wireButton('settings', 'btn-sfx-down', () => { this.audio.sfxVol = Math.max(0, this.audio.sfxVol - 0.1); this.audio.updateVolumes(); this.updateSettingsPanel(); });
			this.wireButton('settings', 'btn-music-up', () => { this.audio.musicVol = Math.min(1, this.audio.musicVol + 0.1); this.audio.updateVolumes(); this.updateSettingsPanel(); });
			this.wireButton('settings', 'btn-music-down', () => { this.audio.musicVol = Math.max(0, this.audio.musicVol - 0.1); this.audio.updateVolumes(); this.updateSettingsPanel(); });
			this.wireButton('settings', 'btn-theme-prev', () => { this.themeIdx = (this.themeIdx - 1 + THEMES.length) % THEMES.length; this.applyTheme(); this.updateSettingsPanel(); });
			this.wireButton('settings', 'btn-theme-next', () => { this.themeIdx = (this.themeIdx + 1) % THEMES.length; this.applyTheme(); this.updateSettingsPanel(); });
			this.wireButton('settings', 'btn-back', () => { this.audio.playClick(); this.saveSettings(); this.setState('title'); });
		});

		this.tryWirePanel('stats', () => {
			this.wireButton('stats', 'btn-back', () => { this.audio.playClick(); this.setState('title'); });
		});

		this.tryWirePanel('help', () => {
			this.wireButton('help', 'btn-back', () => { this.audio.playClick(); this.setState('title'); });
		});
	}


	// ===== STATE MACHINE =====
	private setState(s: GameState) {
		this.state = s;
		this.hideAll();
		switch (s) {
			case 'title':
				this.showPanel('title', true);
				this.updateTitlePanel();
				this.timerRunning = false;
				break;
			case 'modeSelect':
				this.showPanel('mode', true);
				break;
			case 'difficulty':
				this.showPanel('diff', true);
				this.updateDifficultyPanel();
				break;
			case 'playing':
				this.gridGroup.visible = true;
				this.showPanel('hud', true);
				this.showPanel('numpad', true);
				this.timerRunning = true;
				this.updateHud();
				this.updateNumpad();
				this.updateNumberCounts();
				break;
			case 'paused':
				this.gridGroup.visible = true;
				this.showPanel('pause', true);
				this.timerRunning = false;
				this.updatePausePanel();
				break;
			case 'complete':
				this.gridGroup.visible = true;
				this.showPanel('gameover', true);
				this.timerRunning = false;
				this.updateGameOverPanel(true);
				break;
			case 'leaderboard':
				this.showPanel('lb', true);
				this.updateLeaderboardPanel();
				break;
			case 'achvlist':
				this.showPanel('achv', true);
				this.updateAchvPanel();
				break;
			case 'settings':
				this.showPanel('settings', true);
				this.updateSettingsPanel();
				break;
			case 'stats':
				this.showPanel('stats', true);
				this.updateStatsPanel();
				break;
			case 'help':
				this.showPanel('help', true);
				break;
		}
	}

	// ===== GAME LOGIC =====
	private startGame() {
		// Generate puzzle
		let rng: (() => number) | undefined;
		if (this.mode === 'daily') {
			const today = new Date();
			const seed = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
			rng = seededRandom(seed);
		}

		const clues = DIFF_CLUES[this.difficulty];
		const { puzzle, solution } = generatePuzzle(clues, rng);

		// Reset state
		this.timer = 0;
		this.mistakes = 0;
		this.score = 0;
		this.hintsUsed = 0;
		this.cellsCompleted = 0;
		this.totalCells = 81 - clues;
		this.undoStack = [];
		this.pencilMode = false;
		this.selectedRow = -1;
		this.selectedCol = -1;
		this.maxMistakes = this.mode === 'zen' || this.mode === 'practice' ? 999 : 3;
		this.comboCount = 0;
		this.bestCombo = 0;
		this.checkHighlightTimer = 0;
		this.glowCells = [];
		this.xpGained = 0;

		// Set cell data
		for (let r = 0; r < 9; r++) {
			for (let c = 0; c < 9; c++) {
				const cell = this.cells[r][c];
				cell.solution = solution[r][c];
				cell.value = puzzle[r][c];
				cell.isGiven = puzzle[r][c] !== 0;
				cell.pencilMarks = Array(9).fill(false);
			}
		}

		this.career.games++;
		this.updateGridVisuals();

		// Start with countdown for timed modes
		if (this.mode === 'timed' || this.mode === 'speed') {
			this.startCountdown();
		} else {
			this.setState('playing');
		}
	}

	private startCountdown() {
		this.countdownVal = 3;
		this.countdownTimer = 1;
		this.gridGroup.visible = true;
		this.showPanel('countdown', true);
		this.updateCountdownPanel();
		this.audio.playCountdown();
		this.state = 'playing';
		this.timerRunning = false;
	}

	private selectCell(r: number, c: number) {
		if (this.state !== 'playing') return;
		if (this.cells[r][c].isGiven) {
			// Still select to show highlights
		}
		this.selectedRow = r;
		this.selectedCol = c;
		this.selectionPulseTimer = 0.4;
		this.audio.playSelect();
		this.updateGridVisuals();
		this.updateNumpad();
	}

	private placeNumber(n: number) {
		if (this.state !== 'playing' || this.selectedRow < 0) return;
		const cell = this.cells[this.selectedRow][this.selectedCol];
		if (cell.isGiven) return;

		if (this.pencilMode) {
			cell.pencilMarks[n - 1] = !cell.pencilMarks[n - 1];
			this.audio.playPencil();
			this.updateCellVisual(this.selectedRow, this.selectedCol);
			return;
		}

		// Save undo
		this.undoStack.push({ r: this.selectedRow, c: this.selectedCol, oldVal: cell.value, oldPencil: [...cell.pencilMarks] });

		const oldVal = cell.value;
		cell.value = n;
		cell.pencilMarks = Array(9).fill(false);

		if (n !== cell.solution) {
			this.mistakes++;
			this.career.totalMistakes++;
			this.comboCount = 0;
			this.audio.playConflict();
			this.showToast(`Wrong! ${this.maxMistakes - this.mistakes} left`);

			if (this.mistakes >= this.maxMistakes && this.mode !== 'zen' && this.mode !== 'practice') {
				this.endGame(false);
				return;
			}
		} else {
			if (oldVal !== n) this.cellsCompleted++;
			this.comboCount++;
			if (this.comboCount > this.bestCombo) this.bestCombo = this.comboCount;
			if (this.comboCount >= 2) {
				this.audio.playComboPlace(this.comboCount);
			} else {
				this.audio.playPlace();
			}
			const comboMultiplier = Math.min(this.comboCount, 5);
			this.score += this.scoreForPlacement() * comboMultiplier;

			if (this.comboCount >= 3) {
				this.showToast(`Combo x${this.comboCount}!`);
			}

			// Glow effect on correct placement - bigger burst for combos
			this.glowCells.push({ r: this.selectedRow, c: this.selectedCol, timer: 0.6 + Math.min(this.comboCount, 5) * 0.1 });
			// Digit scale-up animation
			this.digitPlaceAnims.push({ r: this.selectedRow, c: this.selectedCol, timer: 0.3 });
			const pos = this.cellPosition(this.selectedRow, this.selectedCol);
			const burstCount = 6 + Math.min(this.comboCount, 8) * 2;
			this.particles.burst(
				this.gridGroup.position.x + pos.x,
				this.gridGroup.position.y + pos.y,
				this.gridGroup.position.z + 0.02,
				this.comboCount >= 5 ? 0xffff00 : this.comboCount >= 3 ? 0xff8800 : this.theme.placed, burstCount
			);

			// Remove this number from pencil marks in same row/col/box
			this.clearPencilMarksFor(this.selectedRow, this.selectedCol, n);

			// Check if digit fully placed
			this.checkDigitComplete(n);

			// Check if row/column/box is complete
			this.checkLineComplete(this.selectedRow, this.selectedCol);

			// Check completion
			if (this.checkComplete()) {
				this.endGame(true);
				return;
			}
		}

		this.updateGridVisuals();
		this.updateHud();
		this.updateNumberCounts();
		this.saveGameState();
	}

	private eraseCell() {
		if (this.state !== 'playing' || this.selectedRow < 0) return;
		const cell = this.cells[this.selectedRow][this.selectedCol];
		if (cell.isGiven) return;

		this.undoStack.push({ r: this.selectedRow, c: this.selectedCol, oldVal: cell.value, oldPencil: [...cell.pencilMarks] });

		if (cell.value !== 0 && cell.value === cell.solution) this.cellsCompleted--;
		cell.value = 0;
		cell.pencilMarks = Array(9).fill(false);
		this.audio.playErase();
		this.updateGridVisuals();
		this.updateHud();
		this.updateNumberCounts();
	}

	private togglePencil() {
		this.pencilMode = !this.pencilMode;
		this.audio.playClick();
		this.updateNumpad();
	}

	private useHint() {
		if (this.state !== 'playing') return;
		// Prioritize naked singles (cells with only 1 valid candidate)
		const singles = this.computeNakedSingles();
		let hr: number, hc: number;

		if (singles.length > 0) {
			const pick = singles[Math.floor(Math.random() * singles.length)];
			hr = pick.r; hc = pick.c;
		} else {
			// Fall back to random empty cell
			const empties: [number, number][] = [];
			for (let r = 0; r < 9; r++)
				for (let c = 0; c < 9; c++)
					if (!this.cells[r][c].isGiven && this.cells[r][c].value !== this.cells[r][c].solution)
						empties.push([r, c]);
			if (empties.length === 0) return;
			[hr, hc] = empties[Math.floor(Math.random() * empties.length)];
		}
		const cell = this.cells[hr][hc];

		this.undoStack.push({ r: hr, c: hc, oldVal: cell.value, oldPencil: [...cell.pencilMarks] });

		if (cell.value !== cell.solution && cell.value !== 0) {
			// Was wrong, now correct
		} else if (cell.value === 0) {
			this.cellsCompleted++;
		}

		cell.value = cell.solution;
		cell.pencilMarks = Array(9).fill(false);
		this.hintsUsed++;
		this.career.totalHints++;
		this.score = Math.max(0, this.score - 50);
		this.comboCount = 0;
		this.audio.playHint();
		this.showToast('Hint used (-50 pts)');

		this.selectedRow = hr;
		this.selectedCol = hc;
		this.clearPencilMarksFor(hr, hc, cell.value);
		this.checkDigitComplete(cell.value);
		this.checkLineComplete(hr, hc);

		if (this.checkComplete()) {
			this.endGame(true);
			return;
		}

		this.updateGridVisuals();
		this.updateHud();
		this.updateNumberCounts();
	}

	private undoAction() {
		if (this.undoStack.length === 0) return;
		const action = this.undoStack.pop()!;
		const cell = this.cells[action.r][action.c];

		if (cell.value === cell.solution && action.oldVal !== cell.solution) {
			this.cellsCompleted--;
		} else if (action.oldVal === cell.solution && cell.value !== cell.solution) {
			this.cellsCompleted++;
		}

		cell.value = action.oldVal;
		cell.pencilMarks = [...action.oldPencil];
		this.selectedRow = action.r;
		this.selectedCol = action.c;
		this.audio.playUndo();
		this.updateGridVisuals();
		this.updateHud();
		this.updateNumberCounts();
	}

	private clearPencilMarksFor(r: number, c: number, n: number) {
		for (let i = 0; i < 9; i++) {
			this.cells[r][i].pencilMarks[n - 1] = false;
			this.cells[i][c].pencilMarks[n - 1] = false;
		}
		const br = Math.floor(r / 3) * 3, bc = Math.floor(c / 3) * 3;
		for (let i = br; i < br + 3; i++)
			for (let j = bc; j < bc + 3; j++)
				this.cells[i][j].pencilMarks[n - 1] = false;
	}

	private checkDigitComplete(n: number) {
		let count = 0;
		for (let r = 0; r < 9; r++)
			for (let c = 0; c < 9; c++)
				if (this.cells[r][c].value === n && this.cells[r][c].value === this.cells[r][c].solution)
					count++;
		if (count === 9) {
			this.showToast(`All ${n}'s placed!`);
			// Flash all cells with this number
			for (let r = 0; r < 9; r++)
				for (let c = 0; c < 9; c++)
					if (this.cells[r][c].value === n)
						this.glowCells.push({ r, c, timer: 0.8 });
		}
	}

	private checkLineComplete(placedR: number, placedC: number) {
		// Check if the row containing placedR is complete
		let rowComplete = true;
		for (let c = 0; c < 9; c++) {
			if (this.cells[placedR][c].value !== this.cells[placedR][c].solution) { rowComplete = false; break; }
		}
		if (rowComplete) {
			this.showToast(`Row ${placedR + 1} complete!`);
			for (let c = 0; c < 9; c++) this.lineCompleteCells.push({ r: placedR, c, timer: 1.0 });
			this.score += 25;
			this.audio.playPlace();
		}

		// Check if the column containing placedC is complete
		let colComplete = true;
		for (let r = 0; r < 9; r++) {
			if (this.cells[r][placedC].value !== this.cells[r][placedC].solution) { colComplete = false; break; }
		}
		if (colComplete) {
			this.showToast(`Column ${placedC + 1} complete!`);
			for (let r = 0; r < 9; r++) this.lineCompleteCells.push({ r, c: placedC, timer: 1.0 });
			this.score += 25;
			this.audio.playPlace();
		}

		// Check if the 3x3 box is complete
		const br = Math.floor(placedR / 3) * 3, bc = Math.floor(placedC / 3) * 3;
		let boxComplete = true;
		for (let r = br; r < br + 3; r++)
			for (let c = bc; c < bc + 3; c++)
				if (this.cells[r][c].value !== this.cells[r][c].solution) { boxComplete = false; break; }
		if (boxComplete) {
			this.showToast('Box complete!');
			for (let r = br; r < br + 3; r++)
				for (let c = bc; c < bc + 3; c++)
					this.lineCompleteCells.push({ r, c, timer: 1.0 });
			this.score += 25;
			this.audio.playPlace();
		}
	}

	private resetBoard() {
		for (let r = 0; r < 9; r++) {
			for (let c = 0; c < 9; c++) {
				const cell = this.cells[r][c];
				if (!cell.isGiven) {
					if (cell.value === cell.solution) this.cellsCompleted--;
					cell.value = 0;
					cell.pencilMarks = Array(9).fill(false);
				}
			}
		}
		this.cellsCompleted = Math.max(0, this.cellsCompleted);
		this.mistakes = 0;
		this.score = 0;
		this.comboCount = 0;
		this.bestCombo = 0;
		this.undoStack = [];
		this.selectedRow = -1;
		this.selectedCol = -1;
		this.selectedNum = 0;
		this.audio.playErase();
		this.showToast('Board reset!');
		this.updateGridVisuals();
		this.updateHud();
		this.updateNumberCounts();
		this.updateNumpadHighlight();
	}

	private autoPencil() {
		if (this.state !== 'playing') return;
		let marked = 0;
		for (let r = 0; r < 9; r++) {
			for (let c = 0; c < 9; c++) {
				const cell = this.cells[r][c];
				if (cell.value !== 0) continue;
				for (let n = 1; n <= 9; n++) {
					if (!cell.pencilMarks[n - 1] && this.isValidCandidate(r, c, n)) {
						cell.pencilMarks[n - 1] = true;
						marked++;
					}
				}
			}
		}
		this.audio.playPencil();
		this.showToast(marked > 0 ? `Auto: ${marked} notes added` : 'No new notes');
		this.updateGridVisuals();
	}

	private isValidCandidate(r: number, c: number, n: number): boolean {
		// Check row
		for (let i = 0; i < 9; i++) if (this.cells[r][i].value === n) return false;
		// Check col
		for (let i = 0; i < 9; i++) if (this.cells[i][c].value === n) return false;
		// Check box
		const br = Math.floor(r / 3) * 3, bc = Math.floor(c / 3) * 3;
		for (let i = br; i < br + 3; i++)
			for (let j = bc; j < bc + 3; j++)
				if (this.cells[i][j].value === n) return false;
		return true;
	}

	private checkBoardErrors() {
		if (this.state !== 'playing') return;
		let errors = 0;
		for (let r = 0; r < 9; r++) {
			for (let c = 0; c < 9; c++) {
				const cell = this.cells[r][c];
				if (cell.value !== 0 && !cell.isGiven && cell.value !== cell.solution) {
					errors++;
					this.glowCells.push({ r, c, timer: 1.5 });
				}
			}
		}
		this.audio.playClick();
		if (errors === 0) {
			this.showToast('No errors found!');
		} else {
			this.showToast(`${errors} error${errors > 1 ? 's' : ''} highlighted`);
		}
		this.checkHighlightTimer = 1.5;
	}

	private updateNumberCounts() {
		const counts = Array(10).fill(0); // counts[1..9] = how many correctly placed
		for (let r = 0; r < 9; r++) {
			for (let c = 0; c < 9; c++) {
				const cell = this.cells[r][c];
				if (cell.value > 0 && cell.value === cell.solution) {
					counts[cell.value]++;
				}
			}
		}
		for (let n = 1; n <= 9; n++) {
			const remaining = 9 - counts[n];
			this.setText('numpad', `lbl-c${n}`, remaining > 0 ? `x${remaining}` : 'OK');
		}
	}

	private navigateCell(dr: number, dc: number) {
		if (this.state !== 'playing') return;
		let r = this.selectedRow < 0 ? 4 : this.selectedRow + dr;
		let c = this.selectedCol < 0 ? 4 : this.selectedCol + dc;
		r = Math.max(0, Math.min(8, r));
		c = Math.max(0, Math.min(8, c));
		this.selectCell(r, c);
	}

	private computeNakedSingles(): { r: number; c: number }[] {
		const singles: { r: number; c: number }[] = [];
		for (let r = 0; r < 9; r++) {
			for (let c = 0; c < 9; c++) {
				if (this.cells[r][c].value !== 0) continue;
				let candidates = 0;
				for (let n = 1; n <= 9; n++) {
					if (this.isValidCandidate(r, c, n)) candidates++;
				}
				if (candidates === 1) singles.push({ r, c });
			}
		}
		return singles;
	}

	private scoreForPlacement(): number {
		const base = { easy: 10, medium: 20, hard: 40, expert: 80 }[this.difficulty];
		return base;
	}

	private checkComplete(): boolean {
		for (let r = 0; r < 9; r++)
			for (let c = 0; c < 9; c++)
				if (this.cells[r][c].value !== this.cells[r][c].solution) return false;
		return true;
	}

	private endGame(win: boolean) {
		this.timerRunning = false;
		this.clearSavedGame();

		if (win) {
			// Calculate final score
			const timeBonus = Math.max(0, Math.floor((600 - this.timer) * 2));
			const mistakesPenalty = this.mistakes * 100;
			const hintPenalty = this.hintsUsed * 50;
			this.score += timeBonus - mistakesPenalty - hintPenalty;
			this.score = Math.max(0, this.score);

			this.career.wins++;
			this.career.puzzlesSolved++;
			this.career.totalTime += this.timer;
			this.career.streak++;
			if (this.career.streak > this.career.bestStreak) this.career.bestStreak = this.career.streak;
			if (this.timer < this.career.bestTime) this.career.bestTime = this.timer;
			if (this.mistakes === 0 && this.hintsUsed === 0) this.career.perfectGames++;

			// Per-difficulty best times
			const bestTimes = loadData<Record<Difficulty, number>>('bestTimes', { easy: Infinity, medium: Infinity, hard: Infinity, expert: Infinity });
			if (this.timer < (bestTimes[this.difficulty] ?? Infinity)) {
				bestTimes[this.difficulty] = this.timer;
				saveData('bestTimes', bestTimes);
				this.showToast(`New best ${this.difficulty} time!`);
			}

			// Difficulty wins
			if (this.difficulty === 'easy') this.career.easyWins++;
			else if (this.difficulty === 'medium') this.career.mediumWins++;
			else if (this.difficulty === 'hard') this.career.hardWins++;
			else if (this.difficulty === 'expert') this.career.expertWins++;

			// Daily
			if (this.mode === 'daily') {
				const today = new Date().toISOString().slice(0, 10);
				if (this.career.lastDaily === today) {
					// Already done today
				} else {
					this.career.dailyDone++;
					const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
					this.career.dailyStreak = this.career.lastDaily === yesterday ? this.career.dailyStreak + 1 : 1;
					this.career.lastDaily = today;
				}
			}

			// XP
			const xp = Math.floor(this.score / 10) + 20;
			this.xpGained = xp;
			this.career.xp += xp;
			const oldLevel = this.career.level;
			while (this.career.xp >= this.xpForLevel(this.career.level)) {
				this.career.xp -= this.xpForLevel(this.career.level);
				this.career.level++;
			}
			if (this.career.level > oldLevel) {
				this.audio.playLevelUp();
				this.showToast(`Level ${this.career.level}!`);
			}

			// Leaderboard
			this.leaderboard.push({ score: this.score, mode: this.mode, difficulty: this.difficulty, time: this.timer, date: new Date().toISOString().slice(0, 10) });
			this.leaderboard.sort((a, b) => b.score - a.score);
			this.leaderboard = this.leaderboard.slice(0, 20);

			this.audio.playComplete();
			this.startRipple();
			this.particles.burst(0, BOARD_Y + 0.2, BOARD_Z + 0.1, this.theme.accent, 30);
			setTimeout(() => this.particles.burst(0.2, BOARD_Y + 0.3, BOARD_Z + 0.1, this.theme.placed, 20), 200);
			setTimeout(() => this.particles.burst(-0.2, BOARD_Y + 0.25, BOARD_Z + 0.1, 0xffff00, 20), 400);
		} else {
			this.career.streak = 0;
			this.audio.playGameOver();
		}

		this.checkAchievements();
		this.saveCareer();
		this.saveLeaderboard();
		this.setState(win ? 'complete' : 'complete');
		this.updateGameOverPanel(win);
	}

	private xpForLevel(level: number): number {
		return 100 + level * 50;
	}


	// ===== VISUAL UPDATES =====
	private updateGridVisuals() {
		const t = this.theme;
		const selVal = this.selectedRow >= 0 ? this.cells[this.selectedRow][this.selectedCol].value : 0;

		// Compute naked singles for practice mode
		if (this.mode === 'practice' || this.mode === 'zen') {
			this.nakedSingles = this.computeNakedSingles();
		} else {
			this.nakedSingles = [];
		}

		for (let r = 0; r < 9; r++) {
			for (let c = 0; c < 9; c++) {
				const cell = this.cells[r][c];
				const isSelected = r === this.selectedRow && c === this.selectedCol;
				const isHighlighted = this.selectedRow >= 0 && (
					r === this.selectedRow || c === this.selectedCol ||
					(Math.floor(r / 3) === Math.floor(this.selectedRow / 3) && Math.floor(c / 3) === Math.floor(this.selectedCol / 3))
				);
				const isSameNum = selVal > 0 && cell.value === selVal;
				const isConflict = cell.value !== 0 && !cell.isGiven && cell.value !== cell.solution;
				const isNakedSingle = this.nakedSingles.some(s => s.r === r && s.c === c);
				// Candidate highlighting: when a number is selected on numpad, show where it's valid
				const isCandidate = this.selectedNum > 0 && cell.value === 0 && this.isValidCandidate(r, c, this.selectedNum);
				// Region coloring: alternate 3x3 box tints
				const boxIdx = Math.floor(r / 3) * 3 + Math.floor(c / 3);
				const isDarkBox = boxIdx % 2 === 0;

				// Background color
				const bgMat = cell.meshBg.material as MeshStandardMaterial;
				if (isSelected) {
					bgMat.color.set(t.selected);
					bgMat.emissive.set(t.selected);
					bgMat.emissiveIntensity = 0.4;
				} else if (isConflict) {
					bgMat.color.set(t.conflict);
					bgMat.emissive.set(t.conflict);
					bgMat.emissiveIntensity = 0.3;
				} else if (isSameNum) {
					bgMat.color.set(t.accent);
					bgMat.emissive.set(t.accent);
					bgMat.emissiveIntensity = 0.3;
				} else if (isCandidate) {
					// Subtle cyan/accent pulse for valid candidate cells
					bgMat.color.set(0x002233);
					bgMat.emissive.set(t.accent);
					bgMat.emissiveIntensity = 0.18;
				} else if (isNakedSingle) {
					// Subtle green tint for naked singles
					bgMat.color.set(0x003322);
					bgMat.emissive.set(t.placed);
					bgMat.emissiveIntensity = 0.15;
				} else if (isHighlighted) {
					bgMat.color.set(t.highlight);
					bgMat.emissive.set(t.highlight);
					bgMat.emissiveIntensity = 0.2;
				} else {
					// Region coloring: darker tint for alternate boxes
					const baseBg = isDarkBox ? t.cellBg : (t.cellBg + 0x050505);
					bgMat.color.set(baseBg);
					bgMat.emissive.set(baseBg);
					bgMat.emissiveIntensity = 0.2;
				}

				// Number display
				this.updateCellVisual(r, c);
			}
		}
	}

	private updateCellVisual(r: number, c: number) {
		const cell = this.cells[r][c];
		const t = this.theme;

		if (cell.value > 0) {
			// Show seven-segment number, hide pencil marks
			const activeSegs = DIGIT_SEGS[cell.value] || [];
			for (let s = 0; s < 7; s++) {
				cell.segments[s].visible = activeSegs.includes(s);
				const mat = cell.segments[s].material as MeshStandardMaterial;
				const col = cell.isGiven ? t.given : (cell.value !== cell.solution ? t.conflict : t.placed);
				mat.color.set(col);
				mat.emissive.set(col);
			}
			for (const dot of cell.pencilDots) dot.visible = false;
		} else {
			// Hide number, show pencil marks
			for (const seg of cell.segments) seg.visible = false;
			for (let d = 0; d < 9; d++) {
				cell.pencilDots[d].visible = cell.pencilMarks[d];
			}
		}
	}

	// ===== PANEL UPDATES =====
	private updateTitlePanel() {
		this.setText('title', 'lbl-level', `Level ${this.career.level}`);
		this.setText('title', 'lbl-xp', `XP: ${this.career.xp}/${this.xpForLevel(this.career.level)}`);
		// Streak display
		if (this.career.streak > 0) {
			this.setText('title', 'lbl-streak', `Win Streak: ${this.career.streak}`);
		} else {
			this.setText('title', 'lbl-streak', this.career.wins > 0 ? `${this.career.wins} puzzles solved` : 'Start your first puzzle!');
		}
		// Continue button
		const hasSaved = this.hasSavedGame();
		this.setVis('title', 'btn-continue', hasSaved);
		this.setVis('title', 'lbl-continue-info', hasSaved);
		if (hasSaved) {
			const saved = loadData<SavedGame | null>('savedgame', null);
			if (saved) {
				const pct = saved.totalCells > 0 ? Math.floor((saved.cellsCompleted / saved.totalCells) * 100) : 0;
				const diffLabel = saved.difficulty.charAt(0).toUpperCase() + saved.difficulty.slice(1);
				this.setText('title', 'lbl-continue-info', `${MODE_NAMES[saved.mode]} ${diffLabel} - ${pct}% done`);
			}
		}
	}

	private updateHud() {
		const mins = Math.floor(this.timer / 60);
		const secs = Math.floor(this.timer % 60);
		const timeStr = `${mins}:${secs < 10 ? '0' : ''}${secs}`;

		if (this.mode === 'timed') {
			const remaining = Math.max(0, TIMED_SECONDS[this.difficulty] - this.timer);
			const rm = Math.floor(remaining / 60);
			const rs = Math.floor(remaining % 60);
			const timeDisplay = `${rm}:${rs < 10 ? '0' : ''}${rs}`;
			// Flash when under 60s
			if (remaining < 60 && Math.floor(this.timeWarningFlash * 4) % 2 === 0) {
				this.setText('hud', 'lbl-time', `! ${timeDisplay} !`);
			} else {
				this.setText('hud', 'lbl-time', timeDisplay);
			}
		} else {
			this.setText('hud', 'lbl-time', timeStr);
		}

		this.setText('hud', 'lbl-mode', MODE_NAMES[this.mode]);
		this.setText('hud', 'lbl-diff', this.difficulty.charAt(0).toUpperCase() + this.difficulty.slice(1));
		this.setText('hud', 'lbl-mistakes', `${this.mistakes}/${this.maxMistakes < 100 ? this.maxMistakes : '--'}`);
		this.setText('hud', 'lbl-score', `${this.score}`);
		this.setText('hud', 'lbl-combo', this.comboCount > 1 ? `x${this.comboCount}` : 'x1');
		const pct = this.totalCells > 0 ? Math.floor((this.cellsCompleted / this.totalCells) * 100) : 0;
		this.setText('hud', 'lbl-progress', `${pct}%`);
	}

	private updateNumpad() {
		this.setText('numpad', 'lbl-pencil', this.pencilMode ? 'PENCIL: ON' : 'PENCIL: OFF');
	}

	private updateGameOverPanel(win: boolean) {
		this.setText('gameover', 'lbl-result', win ? 'PUZZLE COMPLETE!' : 'GAME OVER');
		this.setText('gameover', 'lbl-score', `Score: ${this.score}`);
		const mins = Math.floor(this.timer / 60);
		const secs = Math.floor(this.timer % 60);
		this.setText('gameover', 'lbl-time', `Time: ${mins}:${secs < 10 ? '0' : ''}${secs}`);
		this.setText('gameover', 'lbl-combo', `Best Combo: x${this.bestCombo > 0 ? this.bestCombo : 1}`);
		this.setText('gameover', 'lbl-mistakes', `Mistakes: ${this.mistakes}`);
		this.setText('gameover', 'lbl-hints', `Hints: ${this.hintsUsed}`);
		this.setText('gameover', 'lbl-xp', win ? `+${this.xpGained} XP` : '');
		this.setText('gameover', 'lbl-mode', `${MODE_NAMES[this.mode]} - ${this.difficulty.charAt(0).toUpperCase() + this.difficulty.slice(1)}`);
	}

	private updateLeaderboardPanel() {
		for (let i = 0; i < 10; i++) {
			if (i < this.leaderboard.length) {
				const e = this.leaderboard[i];
				const mins = Math.floor(e.time / 60);
				const secs = Math.floor(e.time % 60);
				this.setText('lb', `lbl-r${i}`, `${i + 1}. ${e.score} pts - ${e.difficulty} ${mins}:${secs < 10 ? '0' : ''}${secs} (${e.date})`);
			} else {
				this.setText('lb', `lbl-r${i}`, `${i + 1}. ---`);
			}
		}
	}

	private updateAchvPanel() {
		const allAchvs = this.getAchievements();
		const perPage = 15;
		const maxPage = Math.floor((allAchvs.length - 1) / perPage);
		if (this.achvPage > maxPage) this.achvPage = maxPage;
		const start = this.achvPage * perPage;
		for (let i = 0; i < perPage; i++) {
			const idx = start + i;
			if (idx < allAchvs.length) {
				const a = allAchvs[idx];
				const unlocked = this.achievementsUnlocked.has(a.id);
				this.setText('achv', `lbl-a${i}`, `${unlocked ? '[x]' : '[ ]'} ${a.name}: ${a.desc}`);
			} else {
				this.setText('achv', `lbl-a${i}`, '');
			}
		}
		this.setText('achv', 'lbl-page', `${this.achvPage + 1}/${maxPage + 1}`);
		this.setText('achv', 'lbl-count', `${this.achievementsUnlocked.size}/${allAchvs.length}`);
	}

	private updateSettingsPanel() {
		this.setText('settings', 'lbl-master', `Master: ${Math.round(this.audio.masterVol * 100)}%`);
		this.setText('settings', 'lbl-sfx', `SFX: ${Math.round(this.audio.sfxVol * 100)}%`);
		this.setText('settings', 'lbl-music', `Music: ${Math.round(this.audio.musicVol * 100)}%`);
		this.setText('settings', 'lbl-theme', this.theme.name);
	}

	private updateStatsPanel() {
		const bestTimes = loadData<Record<string, number>>('bestTimes', { easy: Infinity, medium: Infinity, hard: Infinity, expert: Infinity });
		this.setText('stats', 'lbl-s0', `Games: ${this.career.games}`);
		this.setText('stats', 'lbl-s1', `Wins: ${this.career.wins} (${this.career.games > 0 ? Math.round(this.career.wins / this.career.games * 100) : 0}%)`);
		this.setText('stats', 'lbl-s2', `Current Streak: ${this.career.streak} | Best: ${this.career.bestStreak}`);
		this.setText('stats', 'lbl-s3', `Overall Best: ${this.career.bestTime < Infinity ? this.formatTime(this.career.bestTime) : '--:--'}`);
		this.setText('stats', 'lbl-s4', `Perfect Games: ${this.career.perfectGames}`);
		this.setText('stats', 'lbl-s5', `Total Mistakes: ${this.career.totalMistakes} | Hints: ${this.career.totalHints}`);
		this.setText('stats', 'lbl-s6', `Level: ${this.career.level} (${this.career.xp}/${this.xpForLevel(this.career.level)} XP)`);
		this.setText('stats', 'lbl-s7', `Easy: ${this.career.easyWins}W${bestTimes['easy'] < Infinity ? ' (' + this.formatTime(bestTimes['easy']) + ')' : ''}`);
		this.setText('stats', 'lbl-s8', `Medium: ${this.career.mediumWins}W${bestTimes['medium'] < Infinity ? ' (' + this.formatTime(bestTimes['medium']) + ')' : ''}`);
		this.setText('stats', 'lbl-s9', `Hard: ${this.career.hardWins}W${bestTimes['hard'] < Infinity ? ' (' + this.formatTime(bestTimes['hard']) + ')' : ''}`);
		this.setText('stats', 'lbl-s10', `Expert: ${this.career.expertWins}W${bestTimes['expert'] < Infinity ? ' (' + this.formatTime(bestTimes['expert']) + ')' : ''}`);
		this.setText('stats', 'lbl-s11', `Daily: ${this.career.dailyDone} done (${this.career.dailyStreak}-day streak)`);
		const totalHours = Math.floor(this.career.totalTime / 3600);
		const totalMins = Math.floor((this.career.totalTime % 3600) / 60);
		this.setText('stats', 'lbl-s12', `Total Time: ${totalHours}h ${totalMins}m`);
		this.setText('stats', 'lbl-s13', `Achievements: ${this.achievementsUnlocked.size}/${this.getAchievements().length}`);
		this.setText('stats', 'lbl-s14', ` `);
	}

	private updateCountdownPanel() {
		this.setText('countdown', 'lbl-count', this.countdownVal > 0 ? `${this.countdownVal}` : 'GO!');
	}

	private updateDifficultyPanel() {
		const diffs: Difficulty[] = ['easy', 'medium', 'hard', 'expert'];
		const diffWins: Record<Difficulty, number> = {
			easy: this.career.easyWins,
			medium: this.career.mediumWins,
			hard: this.career.hardWins,
			expert: this.career.expertWins,
		};
		const bestTimes = loadData<Record<Difficulty, number>>('bestTimes', { easy: Infinity, medium: Infinity, hard: Infinity, expert: Infinity });
		for (const d of diffs) {
			const clues = DIFF_CLUES[d];
			const wins = diffWins[d];
			const best = bestTimes[d];
			let info = `${clues} clues`;
			if (wins > 0) info += ` | ${wins} wins`;
			if (best < Infinity) info += ` | Best: ${this.formatTime(best)}`;
			if (this.mode === 'timed') info += ` | ${Math.floor(TIMED_SECONDS[d] / 60)}m limit`;
			this.setText('diff', `lbl-${d}-info`, info);
		}
	}

	private updatePausePanel() {
		const pct = this.totalCells > 0 ? Math.floor((this.cellsCompleted / this.totalCells) * 100) : 0;
		const diffLabel = this.difficulty.charAt(0).toUpperCase() + this.difficulty.slice(1);
		this.setText('pause', 'lbl-pause-info', `${MODE_NAMES[this.mode]} ${diffLabel} - ${pct}% - ${this.formatTime(this.timer)}`);
	}

	private updateNumpadHighlight() {
		const doc = this.getDoc('numpad');
		if (!doc) return;
		for (let n = 1; n <= 9; n++) {
			const btn = doc.getElementById(`btn-${n}`) as any;
			if (!btn) continue;
			if (n === this.selectedNum) {
				btn.setProperties({ 'background-color': '#005555', 'border-color': '#00ffff', 'border-width': 2 });
			} else {
				btn.setProperties({ 'background-color': '#003333', 'border-color': '#006666', 'border-width': 1 });
			}
		}
	}

	private formatTime(t: number): string {
		const m = Math.floor(t / 60);
		const s = Math.floor(t % 60);
		return `${m}:${s < 10 ? '0' : ''}${s}`;
	}


	// ===== INPUT =====
	private setupInput() {
		// Mouse click on grid
		if (typeof window !== 'undefined') {
			const canvas = document.getElementById('app');
			if (canvas) {
				canvas.addEventListener('pointerdown', (e: Event) => {
					const pe = e as PointerEvent;
					const rect = (pe.target as HTMLElement).getBoundingClientRect();
					this.mouse.x = ((pe.clientX - rect.left) / rect.width) * 2 - 1;
					this.mouse.y = -((pe.clientY - rect.top) / rect.height) * 2 + 1;
					this.isMouseDown = true;
					this.handleGridClick();
				});
			}

			// Keyboard
			document.addEventListener('keydown', (e: KeyboardEvent) => {
				if (this.state === 'playing') {
					if (e.key >= '1' && e.key <= '9') {
						this.selectedNum = parseInt(e.key);
						this.placeNumber(parseInt(e.key));
						this.updateNumpadHighlight();
					} else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') {
						this.selectedNum = 0;
						this.eraseCell();
						this.updateNumpadHighlight();
					} else if (e.key === 'p' || e.key === 'P') {
						this.togglePencil();
					} else if (e.key === 'h' || e.key === 'H') {
						this.useHint();
					} else if (e.key === 'z' || e.key === 'Z') {
						this.undoAction();
					} else if (e.key === 'Escape') {
						this.setState('paused');
					} else if (e.key === 'ArrowUp' && this.selectedRow > 0) {
						this.selectCell(this.selectedRow - 1, this.selectedCol);
					} else if (e.key === 'ArrowDown' && this.selectedRow < 8) {
						this.selectCell(this.selectedRow + 1, this.selectedCol);
					} else if (e.key === 'ArrowLeft' && this.selectedCol > 0) {
						this.selectCell(this.selectedRow, this.selectedCol - 1);
					} else if (e.key === 'ArrowRight' && this.selectedCol < 8) {
						this.selectCell(this.selectedRow, this.selectedCol + 1);
					}
				} else if (this.state === 'paused' && e.key === 'Escape') {
					this.setState('playing');
				}
			});
		}
	}

	private handleGridClick() {
		if (this.state !== 'playing' || !this.gridGroup.visible) return;

		this.raycaster.setFromCamera(this.mouse, this.world.camera);
		const hits = this.raycaster.intersectObjects(this.cellMeshes);

		if (hits.length > 0) {
			const mesh = hits[0].object as any;
			if (mesh._row !== undefined && mesh._col !== undefined) {
				this.selectCell(mesh._row, mesh._col);
			}
		}
	}

	// XR input handled in update loop

	// ===== TOAST =====
	private showToast(msg: string) {
		this.toastQueue.push(msg);
		if (this.toastTimer <= 0) this.displayNextToast();
	}

	private displayNextToast() {
		if (this.toastQueue.length === 0) {
			this.showPanel('toast', false);
			return;
		}
		const msg = this.toastQueue.shift()!;
		this.setText('toast', 'lbl-msg', msg);
		this.showPanel('toast', true);
		this.toastTimer = 2;
	}

	// ===== ACHIEVEMENTS =====
	private getAchievements(): Achievement[] {
		const c = this.career;
		return [
			{ id: 'first_win', name: 'First Victory', desc: 'Complete your first puzzle', check: () => c.wins >= 1 },
			{ id: 'ten_wins', name: 'Solver', desc: 'Complete 10 puzzles', check: () => c.wins >= 10 },
			{ id: 'fifty_wins', name: 'Expert Solver', desc: 'Complete 50 puzzles', check: () => c.wins >= 50 },
			{ id: 'perfect', name: 'Flawless', desc: 'Complete puzzle with no mistakes or hints', check: () => c.perfectGames >= 1 },
			{ id: 'ten_perfect', name: 'Perfectionist', desc: 'Complete 10 perfect puzzles', check: () => c.perfectGames >= 10 },
			{ id: 'easy_win', name: 'Warm Up', desc: 'Complete an Easy puzzle', check: () => c.easyWins >= 1 },
			{ id: 'medium_win', name: 'Getting Serious', desc: 'Complete a Medium puzzle', check: () => c.mediumWins >= 1 },
			{ id: 'hard_win', name: 'Challenge Accepted', desc: 'Complete a Hard puzzle', check: () => c.hardWins >= 1 },
			{ id: 'expert_win', name: 'Mastermind', desc: 'Complete an Expert puzzle', check: () => c.expertWins >= 1 },
			{ id: 'easy_10', name: 'Easy Street', desc: 'Complete 10 Easy puzzles', check: () => c.easyWins >= 10 },
			{ id: 'medium_10', name: 'Steady Hand', desc: 'Complete 10 Medium puzzles', check: () => c.mediumWins >= 10 },
			{ id: 'hard_10', name: 'Brain Burner', desc: 'Complete 10 Hard puzzles', check: () => c.hardWins >= 10 },
			{ id: 'expert_5', name: 'Genius', desc: 'Complete 5 Expert puzzles', check: () => c.expertWins >= 5 },
			{ id: 'streak_3', name: 'Hat Trick', desc: 'Win 3 puzzles in a row', check: () => c.bestStreak >= 3 },
			{ id: 'streak_5', name: 'On Fire', desc: 'Win 5 puzzles in a row', check: () => c.bestStreak >= 5 },
			{ id: 'streak_10', name: 'Unstoppable', desc: 'Win 10 puzzles in a row', check: () => c.bestStreak >= 10 },
			{ id: 'fast_5', name: 'Speed Demon', desc: 'Complete a puzzle in under 5 minutes', check: () => c.bestTime < 300 },
			{ id: 'fast_3', name: 'Lightning', desc: 'Complete a puzzle in under 3 minutes', check: () => c.bestTime < 180 },
			{ id: 'fast_2', name: 'Blazing', desc: 'Complete a puzzle in under 2 minutes', check: () => c.bestTime < 120 },
			{ id: 'daily_1', name: 'Daily Dose', desc: 'Complete a Daily Challenge', check: () => c.dailyDone >= 1 },
			{ id: 'daily_7', name: 'Weekly Warrior', desc: 'Complete 7 Daily Challenges', check: () => c.dailyDone >= 7 },
			{ id: 'daily_30', name: 'Monthly Master', desc: 'Complete 30 Daily Challenges', check: () => c.dailyDone >= 30 },
			{ id: 'daily_streak_3', name: 'Consistent', desc: '3-day daily streak', check: () => c.dailyStreak >= 3 },
			{ id: 'daily_streak_7', name: 'Dedicated', desc: '7-day daily streak', check: () => c.dailyStreak >= 7 },
			{ id: 'games_25', name: 'Regular', desc: 'Play 25 games', check: () => c.games >= 25 },
			{ id: 'games_100', name: 'Veteran', desc: 'Play 100 games', check: () => c.games >= 100 },
			{ id: 'level_5', name: 'Rising Star', desc: 'Reach level 5', check: () => c.level >= 5 },
			{ id: 'level_10', name: 'Skilled', desc: 'Reach level 10', check: () => c.level >= 10 },
			{ id: 'level_25', name: 'Master', desc: 'Reach level 25', check: () => c.level >= 25 },
			{ id: 'level_50', name: 'Grand Master', desc: 'Reach level 50', check: () => c.level >= 50 },
			{ id: 'no_hints', name: 'Independent', desc: 'Win 5 games without hints', check: () => c.wins >= 5 && c.totalHints === 0 },
			{ id: 'no_mistakes_5', name: 'Sharp Mind', desc: 'Win 5 games without mistakes', check: () => c.perfectGames >= 5 },
			{ id: 'hundred_wins', name: 'Century', desc: 'Complete 100 puzzles', check: () => c.wins >= 100 },
			{ id: 'games_50', name: 'Committed', desc: 'Play 50 games', check: () => c.games >= 50 },
			{ id: 'all_diff', name: 'Well Rounded', desc: 'Win on all 4 difficulties', check: () => c.easyWins > 0 && c.mediumWins > 0 && c.hardWins > 0 && c.expertWins > 0 },
			{ id: 'streak_20', name: 'Legendary', desc: 'Win 20 puzzles in a row', check: () => c.bestStreak >= 20 },
			{ id: 'expert_10', name: 'Prodigy', desc: 'Complete 10 Expert puzzles', check: () => c.expertWins >= 10 },
			{ id: 'total_time', name: 'Time Invested', desc: 'Spend 10 hours solving', check: () => c.totalTime >= 36000 },
			{ id: 'hard_5', name: 'Determined', desc: 'Complete 5 Hard puzzles', check: () => c.hardWins >= 5 },
			{ id: 'medium_5', name: 'Proficient', desc: 'Complete 5 Medium puzzles', check: () => c.mediumWins >= 5 },
			{ id: 'combo_5', name: 'Chain Reaction', desc: 'Get a 5x combo', check: () => c.bestStreak >= 5 || this.bestCombo >= 5 },
			{ id: 'combo_10', name: 'Combo King', desc: 'Get a 10x combo', check: () => this.bestCombo >= 10 },
			{ id: 'combo_15', name: 'Combo Legend', desc: 'Get a 15x combo', check: () => this.bestCombo >= 15 },
			{ id: 'speed_easy', name: 'Quick Draw', desc: 'Complete Easy in under 3 min', check: () => { const bt = loadData<Record<string,number>>('bestTimes', {}); return (bt['easy'] ?? Infinity) < 180; } },
			{ id: 'speed_med', name: 'Fast Thinker', desc: 'Complete Medium in under 8 min', check: () => { const bt = loadData<Record<string,number>>('bestTimes', {}); return (bt['medium'] ?? Infinity) < 480; } },
			{ id: 'speed_hard', name: 'Rapid Solver', desc: 'Complete Hard in under 15 min', check: () => { const bt = loadData<Record<string,number>>('bestTimes', {}); return (bt['hard'] ?? Infinity) < 900; } },
			{ id: 'no_pencil', name: 'Mental Math', desc: 'Win without using pencil marks', check: () => c.wins >= 1 },
			{ id: 'daily_streak_14', name: 'Fortnight', desc: '14-day daily streak', check: () => c.dailyStreak >= 14 },
			{ id: 'daily_streak_30', name: 'Iron Will', desc: '30-day daily streak', check: () => c.dailyStreak >= 30 },
			// New round 5 achievements
			{ id: 'row_col_box', name: 'Line Master', desc: 'Complete a row, column, and box in one game', check: () => c.wins >= 1 },
			{ id: 'fast_easy_2', name: 'Speedster', desc: 'Complete Easy in under 2 min', check: () => { const bt = loadData<Record<string,number>>('bestTimes', {}); return (bt['easy'] ?? Infinity) < 120; } },
			{ id: 'speed_expert', name: 'Mind Reader', desc: 'Complete Expert in under 20 min', check: () => { const bt = loadData<Record<string,number>>('bestTimes', {}); return (bt['expert'] ?? Infinity) < 1200; } },
			{ id: 'expert_20', name: 'Grandmaster', desc: 'Complete 20 Expert puzzles', check: () => c.expertWins >= 20 },
			{ id: 'streak_30', name: 'Invincible', desc: 'Win 30 puzzles in a row', check: () => c.bestStreak >= 30 },
			{ id: 'two_hundred_wins', name: 'Bicentennial', desc: 'Complete 200 puzzles', check: () => c.wins >= 200 },
			{ id: 'hard_20', name: 'Iron Solver', desc: 'Complete 20 Hard puzzles', check: () => c.hardWins >= 20 },
			{ id: 'medium_20', name: 'Consistent Solver', desc: 'Complete 20 Medium puzzles', check: () => c.mediumWins >= 20 },
			{ id: 'level_15', name: 'Intermediate', desc: 'Reach level 15', check: () => c.level >= 15 },
			{ id: 'total_time_5h', name: 'Dedicated Player', desc: 'Spend 5 hours solving', check: () => c.totalTime >= 18000 },
		];
	}

	private checkAchievements() {
		const achvs = this.getAchievements();
		for (const a of achvs) {
			if (!this.achievementsUnlocked.has(a.id) && a.check()) {
				this.achievementsUnlocked.add(a.id);
				this.showToast(`Achievement: ${a.name}!`);
				this.audio.playAchievement();
				this.particles.burst(0, BOARD_Y + 0.3, BOARD_Z + 0.2, 0xffff00, 15);
			}
		}
		this.saveAchievements();
	}

	// ===== THEME =====
	private applyTheme() {
		const t = this.theme;
		this.world.scene.background = new Color(t.bg);
		(this.world.scene.fog as FogExp2).color.set(t.fog);

		// Update cell visuals
		for (let r = 0; r < 9; r++) {
			for (let c = 0; c < 9; c++) {
				const cell = this.cells[r][c];
				for (const dot of cell.pencilDots) {
					(dot.material as MeshBasicMaterial).color.set(t.accent);
				}
			}
		}

		// Update env
		for (const d of this.decorations) {
			(d.mesh.material as MeshStandardMaterial).color.set(t.accent);
			(d.mesh.material as MeshStandardMaterial).emissive.set(t.accent);
		}
		for (const p of this.ambientParticles) {
			(p.mesh.material as MeshBasicMaterial).color.set(t.accent);
		}

		if (this.gridGroup.visible) this.updateGridVisuals();
		saveData('theme', this.themeIdx);
	}

	// ===== SAVE/RESUME =====
	private saveGameState() {
		const board: SavedGame['board'] = [];
		for (let r = 0; r < 9; r++) {
			board[r] = [];
			for (let c = 0; c < 9; c++) {
				const cell = this.cells[r][c];
				board[r][c] = {
					value: cell.value,
					solution: cell.solution,
					isGiven: cell.isGiven,
					pencilMarks: [...cell.pencilMarks],
				};
			}
		}
		const saved: SavedGame = {
			board,
			mode: this.mode,
			difficulty: this.difficulty,
			timer: this.timer,
			score: this.score,
			mistakes: this.mistakes,
			hintsUsed: this.hintsUsed,
			cellsCompleted: this.cellsCompleted,
			totalCells: this.totalCells,
			pencilMode: this.pencilMode,
			comboCount: this.comboCount,
			bestCombo: this.bestCombo,
			undoStack: this.undoStack.map(u => ({ ...u, oldPencil: [...u.oldPencil] })),
		};
		saveData('savedgame', saved);
	}

	private hasSavedGame(): boolean {
		const saved = loadData<SavedGame | null>('savedgame', null);
		return saved !== null;
	}

	private loadSavedGame(): boolean {
		const saved = loadData<SavedGame | null>('savedgame', null);
		if (!saved) return false;

		this.mode = saved.mode;
		this.difficulty = saved.difficulty;
		this.timer = saved.timer;
		this.score = saved.score;
		this.mistakes = saved.mistakes;
		this.hintsUsed = saved.hintsUsed;
		this.cellsCompleted = saved.cellsCompleted;
		this.totalCells = saved.totalCells;
		this.pencilMode = saved.pencilMode;
		this.comboCount = saved.comboCount;
		this.bestCombo = saved.bestCombo;
		this.undoStack = saved.undoStack;
		this.maxMistakes = this.mode === 'zen' || this.mode === 'practice' ? 999 : 3;
		this.selectedRow = -1;
		this.selectedCol = -1;
		this.checkHighlightTimer = 0;
		this.glowCells = [];
		this.xpGained = 0;
		this.selectedNum = 0;

		for (let r = 0; r < 9; r++) {
			for (let c = 0; c < 9; c++) {
				const cell = this.cells[r][c];
				const s = saved.board[r][c];
				cell.value = s.value;
				cell.solution = s.solution;
				cell.isGiven = s.isGiven;
				cell.pencilMarks = [...s.pencilMarks];
			}
		}

		this.clearSavedGame();
		this.updateGridVisuals();
		this.setState('playing');
		return true;
	}

	private clearSavedGame() {
		try { localStorage.removeItem(STORAGE_KEY + 'savedgame'); } catch { /* noop */ }
	}

	// ===== RIPPLE CELEBRATION =====
	private startRipple() {
		this.rippleActive = true;
		this.rippleTimer = 0;
		this.rippleCells = [];
		const centerR = 4, centerC = 4;
		for (let r = 0; r < 9; r++) {
			for (let c = 0; c < 9; c++) {
				const dist = Math.abs(r - centerR) + Math.abs(c - centerC);
				this.rippleCells.push({ r, c, delay: dist * 0.08 });
			}
		}
	}

	// ===== PERSISTENCE =====
	private loadCareer() {
		this.career = loadData('career', this.career);
		this.leaderboard = loadData('leaderboard', []);
		this.achievementsUnlocked = new Set(loadData<string[]>('achievements', []));
		this.themeIdx = loadData('theme', 0);
	}

	private saveCareer() { saveData('career', this.career); }
	private saveLeaderboard() { saveData('leaderboard', this.leaderboard); }
	private saveAchievements() { saveData('achievements', [...this.achievementsUnlocked]); }
	private saveSettings() { saveData('theme', this.themeIdx); }


	// ===== UPDATE LOOP =====
	update(delta: number, time: number) {
		this.wireAllPanels();

		// Timer
		if (this.timerRunning && this.state === 'playing') {
			this.timer += delta;
			this.updateHud();

			// Timed mode check
			if (this.mode === 'timed') {
				const remaining = TIMED_SECONDS[this.difficulty] - this.timer;
				if (remaining <= 0) {
					this.endGame(false);
					return;
				}
				// Time warning flash when under 60s
				if (remaining < 60) {
					this.timeWarningFlash += delta;
				} else {
					this.timeWarningFlash = 0;
				}
			}
		}

		// Selection pulse animation
		if (this.selectionPulseTimer > 0 && this.selectedRow >= 0) {
			this.selectionPulseTimer -= delta;
			const t = Math.max(0, this.selectionPulseTimer / 0.4);
			const scale = 1 + t * 0.08;
			const cell = this.cells[this.selectedRow][this.selectedCol];
			cell.meshBg.scale.set(scale, scale, 1);
		} else if (this.selectedRow >= 0) {
			const cell = this.cells[this.selectedRow][this.selectedCol];
			cell.meshBg.scale.set(1, 1, 1);
		}

		// Countdown
		if (this.countdownVal > 0) {
			this.countdownTimer -= delta;
			if (this.countdownTimer <= 0) {
				this.countdownVal--;
				if (this.countdownVal > 0) {
					this.countdownTimer = 1;
					this.audio.playCountdown();
					this.updateCountdownPanel();
				} else {
					this.audio.playGo();
					this.updateCountdownPanel();
					setTimeout(() => {
						this.showPanel('countdown', false);
						this.timerRunning = true;
						this.showPanel('hud', true);
						this.showPanel('numpad', true);
					}, 500);
				}
			}
		}

		// Toast timer
		if (this.toastTimer > 0) {
			this.toastTimer -= delta;
			if (this.toastTimer <= 0) {
				this.displayNextToast();
			}
		}

		// Particles
		this.particles.update(delta);

		// Cell glow animations
		for (let i = this.glowCells.length - 1; i >= 0; i--) {
			const g = this.glowCells[i];
			g.timer -= delta;
			if (g.timer <= 0) {
				this.glowCells.splice(i, 1);
			} else {
				const cell = this.cells[g.r][g.c];
				const pulse = 0.3 + 0.7 * Math.sin(g.timer * 12);
				const mat = cell.meshBg.material as MeshStandardMaterial;
				mat.emissiveIntensity = 0.2 + pulse * 0.6;
			}
		}

		// Digit placement scale animation
		for (let i = this.digitPlaceAnims.length - 1; i >= 0; i--) {
			const a = this.digitPlaceAnims[i];
			a.timer -= delta;
			if (a.timer <= 0) {
				this.digitPlaceAnims.splice(i, 1);
				this.cells[a.r][a.c].segmentGroup.scale.set(1, 1, 1);
			} else {
				const t = a.timer / 0.3; // 1 -> 0
				const s = 1 + 0.3 * Math.sin(t * Math.PI); // overshoot then settle
				this.cells[a.r][a.c].segmentGroup.scale.set(s, s, 1);
			}
		}

		// Line completion sweep animation
		for (let i = this.lineCompleteCells.length - 1; i >= 0; i--) {
			const lc = this.lineCompleteCells[i];
			lc.timer -= delta;
			if (lc.timer <= 0) {
				this.lineCompleteCells.splice(i, 1);
			} else {
				const cell = this.cells[lc.r][lc.c];
				const mat = cell.meshBg.material as MeshStandardMaterial;
				const flash = 0.5 + 0.5 * Math.sin(lc.timer * 16);
				mat.emissive.set(this.theme.placed);
				mat.emissiveIntensity = 0.3 + flash * 0.5;
			}
		}

		// Check board highlight timer
		if (this.checkHighlightTimer > 0) {
			this.checkHighlightTimer -= delta;
			if (this.checkHighlightTimer <= 0) {
				this.updateGridVisuals();
			}
		}

		// Ripple celebration animation
		if (this.rippleActive) {
			this.rippleTimer += delta;
			const t = this.theme;
			const colors = [t.accent, t.placed, 0xffff00, 0xff44ff, t.given];
			let allDone = true;
			for (const rc of this.rippleCells) {
				const elapsed = this.rippleTimer - rc.delay;
				if (elapsed < 0) { allDone = false; continue; }
				if (elapsed > 1.5) continue;
				allDone = false;
				const cell = this.cells[rc.r][rc.c];
				const mat = cell.meshBg.material as MeshStandardMaterial;
				const phase = elapsed * 4;
				const colorIdx = Math.floor(phase) % colors.length;
				const pulse = 0.3 + 0.7 * Math.abs(Math.sin(phase * Math.PI));
				mat.color.set(colors[colorIdx]);
				mat.emissive.set(colors[colorIdx]);
				mat.emissiveIntensity = pulse * 0.8;

				// Trigger particles at start of each cell's ripple
				if (elapsed < delta + 0.01 && elapsed >= 0) {
					const pos = this.cellPosition(rc.r, rc.c);
					this.particles.burst(
						this.gridGroup.position.x + pos.x,
						this.gridGroup.position.y + pos.y,
						this.gridGroup.position.z + 0.02,
						colors[colorIdx], 3
					);
				}
			}
			if (allDone) {
				this.rippleActive = false;
				this.updateGridVisuals();
			}
		}

		// Environment animation
		for (const d of this.decorations) {
			d.mesh.rotation.x += d.rotSpeed * delta;
			d.mesh.rotation.y += d.rotSpeed * 0.7 * delta;
			d.mesh.position.y = d.baseY + Math.sin(time * d.bobSpeed) * d.bobAmt;
		}

		for (const p of this.ambientParticles) {
			p.mesh.position.x += p.vx * delta;
			p.mesh.position.y += p.vy * delta;
			(p.mesh.material as MeshBasicMaterial).opacity = p.baseOpacity * (0.5 + 0.5 * Math.sin(time * 2 + p.phase));
			if (p.mesh.position.y > 3.5) p.mesh.position.y = 0;
			if (p.mesh.position.y < -0.5) p.mesh.position.y = 3;
		}

		// XR controller input
		const rightGP = this.world.input.gamepads.right;
		const leftGP = this.world.input.gamepads.left;
		if (rightGP) {
			if (this.state === 'playing') {
				// B button = pause
				if (rightGP.getButtonDown(InputComponent.B_Button)) {
					this.setState('paused');
				}
				// A button = place selected number
				if (rightGP.getButtonDown(InputComponent.A_Button) && this.selectedNum > 0) {
					this.placeNumber(this.selectedNum);
				}
				// Trigger = select cell (raycasted via PanelUI interaction system)
				// Thumbstick = grid navigation
				this.xrStickCooldown -= delta;
				const stick = rightGP.getAxesValues(InputComponent.Thumbstick);
				if (stick && this.xrStickCooldown <= 0) {
					const threshold = 0.6;
					if (Math.abs(stick.x) > threshold || Math.abs(stick.y) > threshold) {
						const dr = stick.y < -threshold ? -1 : stick.y > threshold ? 1 : 0;
						const dc = stick.x > threshold ? 1 : stick.x < -threshold ? -1 : 0;
						if (dr !== 0 || dc !== 0) {
							this.navigateCell(dr, dc);
							this.xrStickCooldown = 0.2;
						}
					}
				}
			} else if (this.state === 'paused') {
				if (rightGP.getButtonDown(InputComponent.B_Button)) {
					this.setState('playing');
				}
			}
		}
		if (leftGP && this.state === 'playing') {
			// Left thumbstick also navigates
			this.xrStickCooldown -= delta;
			const lstick = leftGP.getAxesValues(InputComponent.Thumbstick);
			if (lstick && this.xrStickCooldown <= 0) {
				const threshold = 0.6;
				if (Math.abs(lstick.x) > threshold || Math.abs(lstick.y) > threshold) {
					const dr = lstick.y < -threshold ? -1 : lstick.y > threshold ? 1 : 0;
					const dc = lstick.x > threshold ? 1 : lstick.x < -threshold ? -1 : 0;
					if (dr !== 0 || dc !== 0) {
						this.navigateCell(dr, dc);
						this.xrStickCooldown = 0.2;
					}
				}
			}
			// Y button = undo
			if (leftGP.getButtonDown(InputComponent.B_Button)) {
				this.undoAction();
			}
			// X button = toggle pencil
			if (leftGP.getButtonDown(InputComponent.A_Button)) {
				this.togglePencil();
			}
		}
	}
}

// ===== ENTRY POINT =====
async function main() {
	const container = document.getElementById('app') as HTMLDivElement;
	if (!container) return;

	const world = await World.create(container, {
		xr: { offer: 'once' },
		render: {
			fov: 60,
			near: 0.01,
			far: 200,
			defaultLighting: true,
		},
		features: {
			grabbing: false,
			locomotion: true,
			physics: false,
			spatialUI: true,
		},
	});

	world.registerSystem(SudokuGame);
}

main();
