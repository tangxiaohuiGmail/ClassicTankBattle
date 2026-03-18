/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, CircleDot } from 'lucide-react';

// --- Game Constants ---
const TILE_SIZE = 32;
const MAP_COLS = 13;
const MAP_ROWS = 13;
const CANVAS_WIDTH = MAP_COLS * TILE_SIZE;
const CANVAS_HEIGHT = MAP_ROWS * TILE_SIZE;

const TANK_SIZE = 26; // Slightly smaller than tile for easy movement
const BULLET_SIZE = 6;
const PLAYER_SPEED = 2;
const ENEMY_SPEED = 1.5;
const BULLET_SPEED = 6;

type Direction = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';

interface GameObject {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Tank extends GameObject {
  dir: Direction;
  speed: number;
  isPlayer: boolean;
  cooldown: number;
  color: string;
  isMoving: boolean;
}

interface Bullet extends GameObject {
  dir: Direction;
  isPlayer: boolean;
  active: boolean;
}

interface Particle extends GameObject {
  life: number;
  maxLife: number;
  color: string;
  vx: number;
  vy: number;
}

// 0: Empty, 1: Brick, 2: Steel, 3: Base, 4: Base Destroyed
const INITIAL_MAP = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0],
  [0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0],
  [0, 1, 1, 0, 1, 1, 2, 1, 1, 0, 1, 1, 0],
  [0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 1, 1, 0, 2, 0, 0, 0, 2, 0, 1, 1, 0],
  [0, 1, 1, 0, 2, 1, 1, 1, 2, 0, 1, 1, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 0],
  [0, 1, 1, 0, 1, 3, 3, 3, 1, 0, 1, 1, 0],
];

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);

  // Game State (Mutable ref to avoid re-renders during game loop)
  const state = useRef({
    map: [] as number[][],
    player: null as Tank | null,
    enemies: [] as Tank[],
    bullets: [] as Bullet[],
    particles: [] as Particle[],
    keys: {} as Record<string, boolean>,
    enemySpawnTimer: 0,
    score: 0,
    lives: 3,
    isGameOver: false,
  });

  const initGame = () => {
    // Deep copy map
    const newMap = INITIAL_MAP.map((row) => [...row]);
    // Fix base area
    newMap[11][5] = 1; newMap[11][6] = 1; newMap[11][7] = 1;
    newMap[12][5] = 1; newMap[12][6] = 3; newMap[12][7] = 1;

    state.current = {
      map: newMap,
      player: {
        x: 4 * TILE_SIZE + (TILE_SIZE - TANK_SIZE) / 2,
        y: 12 * TILE_SIZE + (TILE_SIZE - TANK_SIZE) / 2,
        width: TANK_SIZE,
        height: TANK_SIZE,
        dir: 'UP',
        speed: PLAYER_SPEED,
        isPlayer: true,
        cooldown: 0,
        color: '#FACC15', // Yellow
        isMoving: false,
      },
      enemies: [],
      bullets: [],
      particles: [],
      keys: {},
      enemySpawnTimer: 0,
      score: 0,
      lives: 3,
      isGameOver: false,
    };
    setScore(0);
    setLives(3);
    setGameOver(false);
    setIsPlaying(true);
  };

  const spawnEnemy = () => {
    if (state.current.enemies.length >= 4) return; // Max 4 enemies
    const spawnPoints = [0, 6 * TILE_SIZE, 12 * TILE_SIZE];
    const x = spawnPoints[Math.floor(Math.random() * spawnPoints.length)];
    
    state.current.enemies.push({
      x: x + (TILE_SIZE - TANK_SIZE) / 2,
      y: (TILE_SIZE - TANK_SIZE) / 2,
      width: TANK_SIZE,
      height: TANK_SIZE,
      dir: 'DOWN',
      speed: ENEMY_SPEED,
      isPlayer: false,
      cooldown: 60,
      color: '#EF4444', // Red
      isMoving: true,
    });
  };

  const createExplosion = (x: number, y: number, color: string) => {
    for (let i = 0; i < 15; i++) {
      state.current.particles.push({
        x, y,
        width: 4, height: 4,
        vx: (Math.random() - 0.5) * 4,
        vy: (Math.random() - 0.5) * 4,
        life: 0,
        maxLife: 20 + Math.random() * 20,
        color
      });
    }
  };

  const checkCollision = (rect1: GameObject, rect2: GameObject) => {
    return (
      rect1.x < rect2.x + rect2.width &&
      rect1.x + rect1.width > rect2.x &&
      rect1.y < rect2.y + rect2.height &&
      rect1.y + rect1.height > rect2.y
    );
  };

  const checkMapCollision = (obj: GameObject) => {
    const { map } = state.current;
    const margin = 2; // Tolerance
    
    const leftCol = Math.floor((obj.x + margin) / TILE_SIZE);
    const rightCol = Math.floor((obj.x + obj.width - margin) / TILE_SIZE);
    const topRow = Math.floor((obj.y + margin) / TILE_SIZE);
    const bottomRow = Math.floor((obj.y + obj.height - margin) / TILE_SIZE);

    if (leftCol < 0 || rightCol >= MAP_COLS || topRow < 0 || bottomRow >= MAP_ROWS) {
      return true; // Out of bounds
    }

    for (let r = topRow; r <= bottomRow; r++) {
      for (let c = leftCol; c <= rightCol; c++) {
        if (map[r][c] === 1 || map[r][c] === 2 || map[r][c] === 3) {
          return { row: r, col: c, type: map[r][c] };
        }
      }
    }
    return false;
  };

  const fireBullet = (tank: Tank) => {
    if (tank.cooldown > 0) return;
    
    let bx = tank.x + tank.width / 2 - BULLET_SIZE / 2;
    let by = tank.y + tank.height / 2 - BULLET_SIZE / 2;

    if (tank.dir === 'UP') by = tank.y - BULLET_SIZE;
    if (tank.dir === 'DOWN') by = tank.y + tank.height;
    if (tank.dir === 'LEFT') bx = tank.x - BULLET_SIZE;
    if (tank.dir === 'RIGHT') bx = tank.x + tank.width;

    state.current.bullets.push({
      x: bx, y: by,
      width: BULLET_SIZE, height: BULLET_SIZE,
      dir: tank.dir,
      isPlayer: tank.isPlayer,
      active: true
    });

    tank.cooldown = tank.isPlayer ? 30 : 60; // Player shoots faster
  };

  const update = () => {
    if (!state.current.player || state.current.isGameOver) return;
    const { player, enemies, bullets, particles, keys, map } = state.current;

    // --- Player Movement ---
    player.isMoving = false;
    let newDir: Direction | null = null;
    
    if (keys['ArrowUp'] || keys['w']) newDir = 'UP';
    else if (keys['ArrowDown'] || keys['s']) newDir = 'DOWN';
    else if (keys['ArrowLeft'] || keys['a']) newDir = 'LEFT';
    else if (keys['ArrowRight'] || keys['d']) newDir = 'RIGHT';

    if (newDir) {
      player.dir = newDir;
      player.isMoving = true;
      let nextX = player.x;
      let nextY = player.y;

      if (newDir === 'UP') nextY -= player.speed;
      if (newDir === 'DOWN') nextY += player.speed;
      if (newDir === 'LEFT') nextX -= player.speed;
      if (newDir === 'RIGHT') nextX += player.speed;

      // Snap to grid slightly to help going through corridors
      if (newDir === 'UP' || newDir === 'DOWN') {
        const center = nextX + player.width / 2;
        const tileCenter = Math.floor(center / TILE_SIZE) * TILE_SIZE + TILE_SIZE / 2;
        if (Math.abs(center - tileCenter) < 8) {
          nextX += (tileCenter - center) * 0.2;
        }
      } else {
        const center = nextY + player.height / 2;
        const tileCenter = Math.floor(center / TILE_SIZE) * TILE_SIZE + TILE_SIZE / 2;
        if (Math.abs(center - tileCenter) < 8) {
          nextY += (tileCenter - center) * 0.2;
        }
      }

      const testObj = { ...player, x: nextX, y: nextY };
      if (!checkMapCollision(testObj)) {
        player.x = nextX;
        player.y = nextY;
      }
    }

    if (keys[' '] || keys['Enter']) {
      fireBullet(player);
    }
    if (player.cooldown > 0) player.cooldown--;

    // --- Enemy Logic ---
    state.current.enemySpawnTimer--;
    if (state.current.enemySpawnTimer <= 0) {
      spawnEnemy();
      state.current.enemySpawnTimer = 150;
    }

    enemies.forEach(enemy => {
      if (enemy.cooldown > 0) enemy.cooldown--;
      
      // Randomly shoot
      if (Math.random() < 0.02) fireBullet(enemy);

      // Randomly change direction
      if (Math.random() < 0.02) {
        const dirs: Direction[] = ['UP', 'DOWN', 'LEFT', 'RIGHT'];
        enemy.dir = dirs[Math.floor(Math.random() * dirs.length)];
      }

      let nextX = enemy.x;
      let nextY = enemy.y;
      if (enemy.dir === 'UP') nextY -= enemy.speed;
      if (enemy.dir === 'DOWN') nextY += enemy.speed;
      if (enemy.dir === 'LEFT') nextX -= enemy.speed;
      if (enemy.dir === 'RIGHT') nextX += enemy.speed;

      const testObj = { ...enemy, x: nextX, y: nextY };
      if (!checkMapCollision(testObj)) {
        enemy.x = nextX;
        enemy.y = nextY;
      } else {
        // Turn around if hit wall
        const dirs: Direction[] = ['UP', 'DOWN', 'LEFT', 'RIGHT'];
        enemy.dir = dirs[Math.floor(Math.random() * dirs.length)];
      }
    });

    // --- Bullets ---
    bullets.forEach(b => {
      if (!b.active) return;
      if (b.dir === 'UP') b.y -= BULLET_SPEED;
      if (b.dir === 'DOWN') b.y += BULLET_SPEED;
      if (b.dir === 'LEFT') b.x -= BULLET_SPEED;
      if (b.dir === 'RIGHT') b.x += BULLET_SPEED;

      // Map collision
      const hit = checkMapCollision(b);
      if (hit && typeof hit !== 'boolean') {
        b.active = false;
        if (hit.type === 1) { // Brick
          map[hit.row][hit.col] = 0;
          createExplosion(hit.col * TILE_SIZE + 16, hit.row * TILE_SIZE + 16, '#F97316');
        } else if (hit.type === 3) { // Base
          map[hit.row][hit.col] = 4; // Destroyed
          createExplosion(hit.col * TILE_SIZE + 16, hit.row * TILE_SIZE + 16, '#EF4444');
          state.current.isGameOver = true;
          setGameOver(true);
        } else if (hit.type === 2) { // Steel
          createExplosion(b.x, b.y, '#9CA3AF');
        }
      } else if (hit === true) {
        b.active = false; // Out of bounds
      }

      // Tank collision
      if (b.active) {
        if (b.isPlayer) {
          enemies.forEach((enemy, eIdx) => {
            if (checkCollision(b, enemy)) {
              b.active = false;
              createExplosion(enemy.x + 13, enemy.y + 13, enemy.color);
              enemies.splice(eIdx, 1);
              state.current.score += 100;
              setScore(state.current.score);
            }
          });
        } else {
          if (checkCollision(b, player)) {
            b.active = false;
            createExplosion(player.x + 13, player.y + 13, player.color);
            state.current.lives--;
            setLives(state.current.lives);
            if (state.current.lives <= 0) {
              state.current.isGameOver = true;
              setGameOver(true);
            } else {
              // Respawn
              player.x = 4 * TILE_SIZE + (TILE_SIZE - TANK_SIZE) / 2;
              player.y = 12 * TILE_SIZE + (TILE_SIZE - TANK_SIZE) / 2;
              player.dir = 'UP';
            }
          }
        }
      }
    });

    state.current.bullets = bullets.filter(b => b.active);

    // --- Particles ---
    state.current.particles = particles.filter(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.life++;
      return p.life < p.maxLife;
    });
  };

  const drawTank = (ctx: CanvasRenderingContext2D, tank: Tank) => {
    ctx.save();
    ctx.translate(tank.x + tank.width / 2, tank.y + tank.height / 2);
    
    if (tank.dir === 'RIGHT') ctx.rotate(Math.PI / 2);
    else if (tank.dir === 'DOWN') ctx.rotate(Math.PI);
    else if (tank.dir === 'LEFT') ctx.rotate(-Math.PI / 2);

    // Tank Body
    ctx.fillStyle = tank.color;
    ctx.fillRect(-tank.width / 2, -tank.height / 2, tank.width, tank.height);
    
    // Tracks
    ctx.fillStyle = '#333';
    ctx.fillRect(-tank.width / 2 - 2, -tank.height / 2, 4, tank.height);
    ctx.fillRect(tank.width / 2 - 2, -tank.height / 2, 4, tank.height);

    // Turret
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(0, 0, 6, 0, Math.PI * 2);
    ctx.fill();
    
    // Gun barrel
    ctx.fillStyle = '#666';
    ctx.fillRect(-2, -tank.height / 2 - 4, 4, tank.height / 2 + 4);

    ctx.restore();
  };

  const draw = (ctx: CanvasRenderingContext2D) => {
    // Clear
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    const { map, player, enemies, bullets, particles } = state.current;

    // Draw Map
    for (let r = 0; r < MAP_ROWS; r++) {
      for (let c = 0; c < MAP_COLS; c++) {
        const tile = map[r][c];
        const x = c * TILE_SIZE;
        const y = r * TILE_SIZE;
        
        if (tile === 1) { // Brick
          ctx.fillStyle = '#B45309';
          ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
          ctx.strokeStyle = '#78350F';
          ctx.strokeRect(x, y, TILE_SIZE, TILE_SIZE);
          // Brick pattern
          ctx.beginPath();
          ctx.moveTo(x, y + TILE_SIZE/2); ctx.lineTo(x + TILE_SIZE, y + TILE_SIZE/2);
          ctx.moveTo(x + TILE_SIZE/2, y); ctx.lineTo(x + TILE_SIZE/2, y + TILE_SIZE/2);
          ctx.moveTo(x + TILE_SIZE/4, y + TILE_SIZE/2); ctx.lineTo(x + TILE_SIZE/4, y + TILE_SIZE);
          ctx.moveTo(x + TILE_SIZE*0.75, y + TILE_SIZE/2); ctx.lineTo(x + TILE_SIZE*0.75, y + TILE_SIZE);
          ctx.stroke();
        } else if (tile === 2) { // Steel
          ctx.fillStyle = '#9CA3AF';
          ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
          ctx.fillStyle = '#D1D5DB';
          ctx.fillRect(x + 4, y + 4, TILE_SIZE - 8, TILE_SIZE - 8);
        } else if (tile === 3) { // Base
          ctx.fillStyle = '#15803D';
          ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
          ctx.fillStyle = '#FFF';
          ctx.beginPath();
          ctx.arc(x + 16, y + 16, 10, 0, Math.PI * 2);
          ctx.fill();
        } else if (tile === 4) { // Base Destroyed
          ctx.fillStyle = '#451A03';
          ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
        }
      }
    }

    // Draw Bullets
    bullets.forEach(b => {
      ctx.fillStyle = '#FEF08A';
      ctx.fillRect(b.x, b.y, b.width, b.height);
    });

    // Draw Enemies
    enemies.forEach(enemy => drawTank(ctx, enemy));

    // Draw Player
    if (player) drawTank(ctx, player);

    // Draw Particles
    particles.forEach(p => {
      ctx.fillStyle = p.color;
      ctx.globalAlpha = 1 - (p.life / p.maxLife);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.width, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1.0;
    });
  };

  const gameLoop = () => {
    update();
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) draw(ctx);
    }
    requestRef.current = requestAnimationFrame(gameLoop);
  };

  useEffect(() => {
    if (isPlaying) {
      requestRef.current = requestAnimationFrame(gameLoop);
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [isPlaying]);

  // Keyboard Listeners
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      state.current.keys[e.key] = true;
      // Prevent default scrolling for arrow keys and space
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
        e.preventDefault();
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      state.current.keys[e.key] = false;
    };

    window.addEventListener('keydown', handleKeyDown, { passive: false });
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Mobile Control Handlers
  const handleTouchStart = (key: string) => (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    state.current.keys[key] = true;
  };
  const handleTouchEnd = (key: string) => (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    state.current.keys[key] = false;
  };

  return (
    <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center text-white font-mono select-none">
      
      {/* Header / HUD */}
      <div className="w-full max-w-[416px] flex justify-between items-center p-4 bg-neutral-900 rounded-t-xl border-b-4 border-neutral-800">
        <div className="text-xl font-bold text-yellow-400">SCORE: {score}</div>
        <div className="text-xl font-bold text-red-400">LIVES: {lives}</div>
      </div>

      {/* Game Canvas Container */}
      <div className="relative bg-black w-full max-w-[416px] aspect-square shadow-2xl shadow-black/50">
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="w-full h-full object-contain"
        />

        {/* Overlays */}
        {!isPlaying && !gameOver && (
          <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center">
            <h1 className="text-4xl font-black text-yellow-500 mb-8 tracking-widest text-center">BATTLE<br/>CITY</h1>
            <button 
              onClick={initGame}
              className="px-8 py-4 bg-red-600 hover:bg-red-500 text-white font-bold text-xl rounded-lg border-b-4 border-red-800 active:border-b-0 active:translate-y-1 transition-all"
            >
              START GAME
            </button>
            <p className="mt-8 text-neutral-400 text-sm text-center px-4">
              Desktop: WASD / Arrows to move, Space to shoot.<br/>
              Mobile: Use on-screen controls.
            </p>
          </div>
        )}

        {gameOver && (
          <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center">
            <h2 className="text-5xl font-black text-red-600 mb-4 animate-pulse">GAME OVER</h2>
            <p className="text-2xl text-yellow-400 mb-8">FINAL SCORE: {score}</p>
            <button 
              onClick={initGame}
              className="px-8 py-4 bg-white text-black hover:bg-neutral-200 font-bold text-xl rounded-lg border-b-4 border-neutral-400 active:border-b-0 active:translate-y-1 transition-all"
            >
              PLAY AGAIN
            </button>
          </div>
        )}
      </div>

      {/* Mobile Controls */}
      <div className="w-full max-w-[416px] p-6 bg-neutral-900 rounded-b-xl flex justify-between items-center md:hidden">
        {/* D-Pad */}
        <div className="grid grid-cols-3 gap-2 w-32 h-32">
          <div />
          <button 
            className="bg-neutral-700 rounded-lg flex items-center justify-center active:bg-neutral-500"
            onTouchStart={handleTouchStart('ArrowUp')} onTouchEnd={handleTouchEnd('ArrowUp')}
            onMouseDown={handleTouchStart('ArrowUp')} onMouseUp={handleTouchEnd('ArrowUp')}
            onMouseLeave={handleTouchEnd('ArrowUp')}
          >
            <ArrowUp size={24} />
          </button>
          <div />
          <button 
            className="bg-neutral-700 rounded-lg flex items-center justify-center active:bg-neutral-500"
            onTouchStart={handleTouchStart('ArrowLeft')} onTouchEnd={handleTouchEnd('ArrowLeft')}
            onMouseDown={handleTouchStart('ArrowLeft')} onMouseUp={handleTouchEnd('ArrowLeft')}
            onMouseLeave={handleTouchEnd('ArrowLeft')}
          >
            <ArrowLeft size={24} />
          </button>
          <button 
            className="bg-neutral-700 rounded-lg flex items-center justify-center active:bg-neutral-500"
            onTouchStart={handleTouchStart('ArrowDown')} onTouchEnd={handleTouchEnd('ArrowDown')}
            onMouseDown={handleTouchStart('ArrowDown')} onMouseUp={handleTouchEnd('ArrowDown')}
            onMouseLeave={handleTouchEnd('ArrowDown')}
          >
            <ArrowDown size={24} />
          </button>
          <button 
            className="bg-neutral-700 rounded-lg flex items-center justify-center active:bg-neutral-500"
            onTouchStart={handleTouchStart('ArrowRight')} onTouchEnd={handleTouchEnd('ArrowRight')}
            onMouseDown={handleTouchStart('ArrowRight')} onMouseUp={handleTouchEnd('ArrowRight')}
            onMouseLeave={handleTouchEnd('ArrowRight')}
          >
            <ArrowRight size={24} />
          </button>
        </div>

        {/* Action Button */}
        <button 
          className="w-20 h-20 bg-red-600 rounded-full flex items-center justify-center shadow-lg shadow-red-900/50 active:bg-red-500 active:scale-95 transition-transform border-4 border-red-800"
          onTouchStart={handleTouchStart(' ')} onTouchEnd={handleTouchEnd(' ')}
          onMouseDown={handleTouchStart(' ')} onMouseUp={handleTouchEnd(' ')}
          onMouseLeave={handleTouchEnd(' ')}
        >
          <CircleDot size={32} className="text-white/80" />
        </button>
      </div>

    </div>
  );
}
