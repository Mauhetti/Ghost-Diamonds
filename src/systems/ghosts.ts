import { engine, Transform, Entity, TextShape, TextAlignMode, Font, GltfContainer, Billboard, BillboardMode } from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color4 } from '@dcl/sdk/math'
import { CONFIG } from '../config';
import { PlayerUI } from './player';
import { loadSharedSeed, deterministicRandom, randomRange, randomAngle } from '../utils/shared-seed'
import { forceDeathDetection } from './death'
import { getTerrainHeight, getTerrainBounds } from '../utils/terrain-height-loader'
import { getGhostPosition } from './ghost-positions-persistence'

// Cache pour les calculs de hauteur de terrain (optimisation performance)
const ghostLastHeightCheck = new Map<number, { x: number, z: number, y: number }>();

// Système de lissage vertical pour les variations en Y
const ghostVerticalSmoothing = new Map<number, number>();

// Fonction pour contraindre une position dans les limites du terrain
function constrainToTerrainBounds(x: number, z: number): { x: number, z: number } {
  const bounds = getTerrainBounds();
  const margin = 15; // Marge de sécurité de 15m
  
  let constrainedX = x;
  let constrainedZ = z;
  
  // Contraindre X
  if (x < bounds.minX + margin) {
    constrainedX = bounds.minX + margin;
  } else if (x > bounds.maxX - margin) {
    constrainedX = bounds.maxX - margin;
  }
  
  // Contraindre Z
  if (z < bounds.minZ + margin) {
    constrainedZ = bounds.minZ + margin;
  } else if (z > bounds.maxZ - margin) {
    constrainedZ = bounds.maxZ - margin;
  }
  
  return { x: constrainedX, z: constrainedZ };
}


// ============================================================================
// ANTI-FAKE STOP SYSTEM
// ============================================================================ 
// Système pour détecter et punir les "fake stops" (immobilisation immédiate après détection)
// Chaque fantôme a son propre compteur de fake stops
let fakeStopHistory: number[] = []; // Historique des derniers fake stops
let fakeStopCountPerGhost: number[] = Array(200).fill(0); // Compteur par fantôme
let lastFakeStopTimePerGhost: number[] = Array(200).fill(0); // Temps du dernier fake stop par fantôme
let fakeStopResetTimestamp: number[] = Array(200).fill(0); // Timestamp pour reset après 1 seconde

// Variables de persistance pour l'état des fantômes (DOIVENT être au niveau du module)
let suspicionTimer: number[] = Array(200).fill(0);
let wasSuspicious: boolean[] = Array(200).fill(false);
let suspicionThresholdFrozen: number[] = Array(200).fill(0); // Threshold "gelé" au moment de l'entrée en suspicion
let lastSuspicionEnterTime: number[] = Array(200).fill(0); // Timestamp du dernier "JUST ENTERED" pour éviter les logs répétés
let lastFakeStopSeenByGhost: number[] = Array(200).fill(0); // Dernier fake stop vu par ce fantôme

// Fonction pour détecter les fake stops (PATTERN RÉPÉTITIF)
// Variables pour suivre l'immobilisation
let isPlayerImmobilized = false;
let lastImmobilizationTime = 0;
let lastPlayerSpeed = 0;

// Variable globale pour éviter de compter plusieurs fois le même pattern
let lastFakeStopPatternTime = 0;

// Seuil plus strict pour la détection des fake stops (nécessite un vrai arrêt)
const FAKE_STOP_IMMOBILE_THRESHOLD = 0.5; // Le joueur doit descendre sous 0.5 m/s pour être considéré comme immobile

function detectFakeStop(currentSpeed: number, dt: number): boolean {
  const now = Date.now();
  
  // Détecter si le joueur s'immobilise (transition de mouvement à immobilisation)
  // Utilise un seuil plus strict pour les fake stops
  if (currentSpeed < FAKE_STOP_IMMOBILE_THRESHOLD && lastPlayerSpeed >= FAKE_STOP_IMMOBILE_THRESHOLD) {
    // Joueur vient de s'immobiliser (vraiment immobile)
    isPlayerImmobilized = true;
    lastImmobilizationTime = now;
  }
  
  // Détecter si le joueur repart après une immobilisation
  if (isPlayerImmobilized && currentSpeed >= FAKE_STOP_IMMOBILE_THRESHOLD) {
    const immobilizationDuration = now - lastImmobilizationTime;
    isPlayerImmobilized = false;
    
    // Si l'immobilisation a duré entre 100ms et 1 seconde, c'est un fake stop cycle (plus strict)
    if (immobilizationDuration < 1000 && immobilizationDuration > 100) {
      fakeStopHistory.push(now);
      
      // Nettoyer l'historique (garder seulement les 7 dernières secondes)
      while (fakeStopHistory.length > 0 && now - fakeStopHistory[0] > 7000) {
        fakeStopHistory.shift();
      }
      
      // ✅ Retourne true UNE SEULE FOIS quand on atteint 3 cycles pour la première fois
      // (pas à chaque nouveau cycle pour éviter les comptages multiples)
      if (fakeStopHistory.length >= 3 && now - lastFakeStopPatternTime > 1000) {
        lastFakeStopPatternTime = now;
        lastPlayerSpeed = currentSpeed;
        return true;
      }
    }
  }
  
  lastPlayerSpeed = currentSpeed;
  return false;
}

// Fonction pour calculer le cooldown progressif (PAR FANTÔME)
function getFakeStopCooldown(ghostIndex: number): number {
  if (fakeStopCountPerGhost[ghostIndex] === 0) return 0;
  
  // Cooldown plus court et progressif :
  // 1er fake stop: 0.5s
  // 2ème fake stop: 1s  
  // 3ème fake stop: 1.5s
  // 4ème+ fake stop: 2s max
  const cooldown = Math.min(500 + (fakeStopCountPerGhost[ghostIndex] * 500), 2000); // 0.5s + 0.5s par fake stop, max 2s
  return cooldown;
}
// - Mouvement plus agressif pendant la poursuite
// ============================================================================ 
// GHOST AI SYSTEM
// ============================================================================ 
// Advanced AI system for 200 synchronized ghosts with realistic behavior:
// - Deterministic movement using shared seed for multiplayer sync
// - Patrol, chase, and alert states with smooth transitions
// - Visual deformation effects based on movement speed
// - Player detection with field of view and movement speed consideration
// - Death mechanics when touching players
// - Firebase synchronization for consistent behavior across all players
// ============================================================================ 

// Exposed containers to allow main() to sync entities after creation
let GHOST_ENTITIES: Entity[] = [];
let ALERT_MARKERS: Entity[] = [];

// Limites pour éviter l'accumulation de mémoire
const MAX_GHOST_ENTITIES = 300; // Limite de sécurité
const MAX_ALERT_MARKERS = 50;   // Limite de sécurité

// Initialize ghost synchronization (déterministe)
async function initGhostSync() {
  await loadSharedSeed();
}

export async function setupGhosts(SAFE_ZONES: { x: number; z: number }[], isInAnySafeZone: (x:number, z:number) => boolean) {
  // prevent duplicate setup on hot-reload
  // @ts-ignore
  const g: any = (globalThis as any);
  if (g.__GHOSTS_SETUP__) {
    return;
  }
  g.__GHOSTS_SETUP__ = true;
  
  // COMMANDES DE DEBUG POUR ANTI-FAKE STOP
  (globalThis as any).debugFakeStop = (ghostIndex: number = 0) => {
    console.log(`  - Ghost ${ghostIndex} fake stops: ${fakeStopCountPerGhost[ghostIndex]}`);
    console.log(`  - Ghost ${ghostIndex} cooldown: ${getFakeStopCooldown(ghostIndex)}ms`);
    console.log(`  - Immobilisé: ${isPlayerImmobilized}`);
    console.log(`  - Dernière immobilisation: ${Date.now() - lastImmobilizationTime}ms`);
    console.log(`  - Historique des cycles: ${fakeStopHistory.length}/3`);
  };
  
  (globalThis as any).resetFakeStop = (ghostIndex: number = -1) => {
    if (ghostIndex === -1) {
      // Reset tous les fantômes
      for (let i = 0; i < fakeStopCountPerGhost.length; i++) {
        fakeStopCountPerGhost[i] = 0;
      }
    } else {
      fakeStopCountPerGhost[ghostIndex] = 0;
    }
    lastImmobilizationTime = 0;
    isPlayerImmobilized = false;
    fakeStopHistory.length = 0;
  };
  
  (globalThis as any).testFakeStop = (ghostIndex: number = 0) => {
    fakeStopCountPerGhost[ghostIndex]++;
    lastFakeStopTimePerGhost[ghostIndex] = Date.now();
  };
  
  (globalThis as any).testInterpolation = () => {
    if (ghostLogicalPositions.length > 0) {
      const logical = ghostLogicalPositions[0];
      const visual = ghostVisualPositions[0];
      
      // Forcer un décalage pour tester l'interpolation
      ghostLogicalPositions[0] = Vector3.create(logical.x + 5, logical.y, logical.z + 5);
    }
  };
  
  // console.log('  - debugFakeStop() : Voir l\'état du système anti-fake stop'); // Réduit les logs
  // console.log('  - resetFakeStop() : Reset le compteur de fake stops'); // Réduit les logs
  // console.log('  - testFakeStop() : Simuler un fake stop pour tester'); // Réduit les logs
  // console.log('  - testInterpolation() : Tester l\'interpolation des fantômes'); // Réduit les logs

  // Initialize ghost synchronization
  initGhostSync();
  const GHOST_COUNT = CONFIG.GHOST.COUNT;
  const GHOST_MAX_CHASE_SPEED_BASE = CONFIG.GHOST.CHASE_SPEED;
  const GHOST_MAX_CHASE_SPEED_SPRINT = CONFIG.GHOST.SPRINT_SPEED;
  const turnSpeed = CONFIG.GHOST.TURN_SPEED;
  
        // Initialiser les arrays de persistance avec la bonne taille (PREMIER SETUP UNIQUEMENT)
        if (suspicionTimer.length !== GHOST_COUNT) {
          // console.log(`[GHOST_INIT] Initializing suspicion arrays for ${GHOST_COUNT} ghosts (first time only)`);
          
          // ÉTENDRE les tableaux en place sans perdre les valeurs existantes
          while (suspicionTimer.length < GHOST_COUNT) {
            suspicionTimer.push(0);
            wasSuspicious.push(false);
            suspicionThresholdFrozen.push(0);
            lastSuspicionEnterTime.push(0);
            lastFakeStopSeenByGhost.push(0);
            fakeStopCountPerGhost.push(0);
            fakeStopResetTimestamp.push(0);
          }
          
          // TRONQUER si nécessaire
          while (suspicionTimer.length > GHOST_COUNT) {
            suspicionTimer.pop();
            wasSuspicious.pop();
            suspicionThresholdFrozen.pop();
            lastSuspicionEnterTime.pop();
            lastFakeStopSeenByGhost.pop();
            fakeStopCountPerGhost.pop();
            fakeStopResetTimestamp.pop();
          }
        }
  
  const PATROL_POINTS = CONFIG.GHOST.PATROL_POINTS;
  let tGlobal = 0;
  // Phase system removed - using deterministic time
  // Main dynamic arrays avec vérification de taille
  if (GHOST_ENTITIES.length > MAX_GHOST_ENTITIES) {
    GHOST_ENTITIES = GHOST_ENTITIES.slice(-MAX_GHOST_ENTITIES);
  }
  if (ALERT_MARKERS.length > MAX_ALERT_MARKERS) {
    ALERT_MARKERS = ALERT_MARKERS.slice(-MAX_ALERT_MARKERS);
  }
  
  GHOST_ENTITIES = [];
  let ghostYaw: number[] = [];
  ALERT_MARKERS = [];
  let ghostModels: Entity[] = [];
  let dynamicPatrols: Vector3[][] = [];
  let ghostIdx = Array(GHOST_COUNT).fill(0);
  let isChasing: boolean[] = Array(GHOST_COUNT).fill(false);
  let chasingDuration: number[] = Array(GHOST_COUNT).fill(0);
  let postChaseTimer: number[] = Array(GHOST_COUNT).fill(0); // seconds to remain in alert after chase ends
  let suspicionToPatrolCooldown: number[] = Array(GHOST_COUNT).fill(0); // cooldown suspicion -> patrouille
  let chaseToSuspicionCooldown: number[] = Array(GHOST_COUNT).fill(0); // cooldown poursuite -> suspicion
  let isInFakeStopMode: boolean[] = Array(GHOST_COUNT).fill(false); // tracker si le fantôme est en mode fake stop
  let fakeStopModeTimeout: number[] = Array(GHOST_COUNT).fill(0); // timeout pour sortir du mode fake stop
  let currentPatrolSpeed: number[] = Array(GHOST_COUNT).fill(1.5);
  let nextPatrolSpeedChange: number[] = Array(GHOST_COUNT).fill(8);
  let chaseStartTime: number[] = Array(GHOST_COUNT).fill(0); // Timestamp du début de poursuite
  
  // ============================================================================ 
  // INTERPOLATION SYSTEM FOR SMOOTH RENDERING
  // ============================================================================ 
  // Variables pour séparer la position logique (déterministe) de la position visuelle (interpolée)
  let ghostLogicalPositions: Vector3[] = Array(GHOST_COUNT).fill(null).map(() => Vector3.create(0, 0, 0));
  let ghostVisualPositions: Vector3[] = Array(GHOST_COUNT).fill(null).map(() => Vector3.create(0, 0, 0));
  const INTERPOLATION_SPEED = 5.0; // Vitesse d'interpolation (plus lent = plus visible)
  let playerHitCooldown = 0; // post-hit invulnerability in seconds
  let lastGhostPos: Vector3[] = [];
  let headingX: number[] = [];
  let headingZ: number[] = [];
  let lastMarkChar: string[] = [];
  let alertCodes: number[] = [];
  let lastVeilAlpha: number[] = [];
  // throttled debug logger (reduces spam)
  let debugTimer = 0;

  // Use shared seed for deterministic generation
  function rand() {
    return deterministicRandom();
  }

  function stepTowardsAngle(current: number, target: number, maxStep: number) {
    let diff = ((target - current + Math.PI) % (2 * Math.PI)) - Math.PI;
    if (diff > Math.PI) diff -= 2 * Math.PI;
    if (diff < -Math.PI) diff += 2 * Math.PI;
    if (diff > maxStep) diff = maxStep;
    if (diff < -maxStep) diff = -maxStep;
    return current + diff;
  }

  function genRandomPatrolAround(x0: number, z0: number) {
    const points = []
    for(let k=0; k < PATROL_POINTS; k++) {
      let tries = 0, ok = false, x = 0, z = 0
      while(!ok && tries < 50) {
        // 1 fois sur 2, cibler le centre de la map
        let targetX0 = x0, targetZ0 = z0;
        if (Math.random() < 0.5) {
          targetX0 = 160; // Centre de la map
          targetZ0 = 160;
        }
        
        const r = randomRange(40, 120)
        const theta = randomAngle()
        x = targetX0 + r * Math.cos(theta)
        z = targetZ0 + r * Math.sin(theta)
        
        // Contraindre la position dans les limites du terrain
        const constrainedPos = constrainToTerrainBounds(x, z);
        x = constrainedPos.x;
        z = constrainedPos.z;
        
        ok = true
        for(const sz of SAFE_ZONES) {
          const dx = x - sz.x, dz = z - sz.z
          if(dx*dx + dz*dz < Math.pow(2.5 + 2.5,2)) { ok = false; break }
        }
      }
      // Obtenir la hauteur du terrain à ce point de patrouille
      const terrainY = getTerrainHeight(x, z);
      points.push({ x, y: terrainY + 2.0, z }) // Fantôme vole 2m au-dessus du terrain
    }
    return points
  }

  // Création entités
  for (let i = 0; i < GHOST_COUNT; i++) {
    let gx = 160, gz = 160, ghostY = 2.0;
    
    // Essayer d'utiliser la position persistée si elle existe
    const persistedPos = getGhostPosition(i);
    if (persistedPos) {
      gx = persistedPos.x;
      gz = persistedPos.z;
      ghostY = persistedPos.y;
      // console.log(`[GHOST_INIT] Using persisted position for ghost ${i}: (${gx.toFixed(1)}, ${ghostY.toFixed(1)}, ${gz.toFixed(1)})`);
    } else {
      // Générer une nouvelle position si aucune n'est persistée
      let found = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        gx = randomRange(25, 295);
        gz = randomRange(25, 295);
        
        // Contraindre la position dans les limites du terrain
        const constrainedPos = constrainToTerrainBounds(gx, gz);
        gx = constrainedPos.x;
        gz = constrainedPos.z;
        
        let ok = !isInAnySafeZone(gx, gz)
        if (ok) { found = true; break; }
      }
      if (!found) { gx = 160; gz = 160; }
      
      // Obtenir la hauteur du terrain pour la position de spawn
      const spawnTerrainY = getTerrainHeight(gx, gz);
      ghostY = spawnTerrainY + 2.0; // Fantôme spawn 2m au-dessus du terrain
    }
    
    const ghost = engine.addEntity();
    Transform.create(ghost, { position: Vector3.create(gx, ghostY, gz) });
    
    // Initialiser les positions logiques et visuelles
    ghostLogicalPositions[i] = Vector3.create(gx, ghostY, gz);
    ghostVisualPositions[i] = Vector3.create(gx, ghostY, gz);
    
    const ghostModel = engine.addEntity();
    Transform.create(ghostModel, {
      parent: ghost,
      position: Vector3.create(0, 0, 0),
      rotation: Quaternion.fromEulerDegrees(0, CONFIG.GHOST.MODEL_YAW_OFFSET_DEG, 0),
      scale: Vector3.create(2.5, 2.5, 2.5)
    });
    GltfContainer.create(ghostModel, { src: 'assets/scene/Models/ghost_vibe/ghost_vibe.glb' });
    ghostModels.push(ghostModel);

    lastVeilAlpha.push(0.5);

    // Debug visuals removed (arrows/cones)
    GHOST_ENTITIES.push(ghost);
    dynamicPatrols.push(genRandomPatrolAround(gx, gz));
    // Initial orientation towards the first patrol point
    {
      const patrol0 = dynamicPatrols[i][0];
      const dx0 = patrol0.x - gx;
      const dz0 = patrol0.z - gz;
      const yaw0 = Math.atan2(dz0, dx0);
      ghostYaw[i] = yaw0;
      // Cap initial aligné vers le premier point
      const len0 = Math.sqrt(dx0*dx0 + dz0*dz0) || 1;
      headingX[i] = dx0 / len0;
      headingZ[i] = dz0 / len0;
      const tr0m = Transform.getMutable(ghostModel);
      const dir0 = Vector3.create(Math.cos(yaw0), 0, Math.sin(yaw0));
      // apply +90° yaw fix (+180° vs previous) so they face forward
      const rotAdjust0 = Quaternion.fromEulerDegrees(0, 90, 0);
      tr0m.rotation = Quaternion.multiply(Quaternion.lookRotation(dir0), rotAdjust0);
    }
    // Previous position for velocity-based heading
    lastGhostPos[i] = Vector3.create(gx, 0, gz);
    const alertMark = engine.addEntity();
    Transform.create(alertMark, { position: Vector3.create(gx, 3.0, gz) });
    TextShape.create(alertMark, {
      text: '',
      fontSize: 8,
      textColor: Color4.White(),
      outlineColor: Color4.Black(),
      outlineWidth: 0.1,
      textAlign: TextAlignMode.TAM_MIDDLE_CENTER,
      font: Font.F_SANS_SERIF
    });
    Billboard.create(alertMark, { billboardMode: BillboardMode.BM_Y });
    ALERT_MARKERS.push(alertMark);
    alertCodes.push(0);

    // pas de fond; on utilise textColor
    currentPatrolSpeed[i] = CONFIG.GHOST.PATROL_SPEED_MIN + rand() * (CONFIG.GHOST.PATROL_SPEED_MAX - CONFIG.GHOST.PATROL_SPEED_MIN);
    nextPatrolSpeedChange[i] = 6 + rand() * 9;
  }

  function applyMarker(i: number, code: 0|1|2) {
    const mark = ALERT_MARKERS[i];
    if (!mark || !TextShape.has(mark)) return;
    const ts = TextShape.getMutable(mark);
    if (code === 2) {
      if (lastMarkChar[i] !== '!') { ts.text = '!'; lastMarkChar[i] = '!'; }
      ts.textColor = Color4.Red();
    } else if (code === 1) {
      if (lastMarkChar[i] !== '?') { ts.text = '?'; lastMarkChar[i] = '?'; }
      ts.textColor = Color4.create(1, 0.5, 0, 1);
    } else {
      if (lastMarkChar[i] !== '') { ts.text = ''; lastMarkChar[i] = ''; }
    }
    alertCodes[i] = code;
  }

  // Marker system removed - using atomic events for synchronization

  // Globals for smoothed player speed and other state
  let lastPlayerPos: Vector3 | null = null;
  let lastSpeeds: number[] = [];
  const SPEED_SMOOTH_WINDOW = CONFIG.ALERT.SPEED_SMOOTH_WINDOW;
  function computePlayerSpeed(curr: Vector3, last: Vector3, dt: number): number {
    const dx = curr.x - last.x;
    const dy = curr.y - last.y;
    const dz = curr.z - last.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz) / Math.max(0.001, dt);
  }

  // Check if player is within ghost's field of vision
  function isPlayerInVision(ghostPos: Vector3, ghostYaw: number, playerPos: Vector3): boolean {
    // Ghost eye position (higher than ground)
    const ghostEyePos = Vector3.create(
      ghostPos.x, 
      ghostPos.y + CONFIG.ALERT.VISION.HEIGHT_OFFSET, 
      ghostPos.z
    );
    
    // Player position (at player height)
    const playerEyePos = Vector3.create(
      playerPos.x, 
      playerPos.y + CONFIG.ALERT.VISION.PLAYER_HEIGHT_OFFSET, 
      playerPos.z
    );
    
    // Vector from ghost to player
    const toPlayer = Vector3.subtract(playerEyePos, ghostEyePos);
    const distance = Vector3.length(toPlayer);
    
    // Normalize direction vector
    const directionToPlayer = Vector3.normalize(toPlayer);
    
    // Ghost's forward direction (based on current yaw)
    const ghostForward = Vector3.create(
      Math.cos(ghostYaw),
      0,
      Math.sin(ghostYaw)
    );
    
    // Calculate angle between ghost's forward direction and direction to player
    const dotProduct = Vector3.dot(ghostForward, directionToPlayer);
    const angleToPlayer = Math.acos(Math.max(-1, Math.min(1, dotProduct))) * (180 / Math.PI);
    
    // Check if player is within vision angle (half angle on each side)
    const halfVisionAngle = CONFIG.ALERT.VISION.ANGLE_DEG / 2;
    return angleToPlayer <= halfVisionAngle;
  }

  // add system only once across hot-reloads
  if (!g.__GHOSTS_SYSTEM__) {
    g.__GHOSTS_SYSTEM__ = true;
    engine.addSystem((dt) => {
    tGlobal += dt;
    debugTimer += dt;
    const doLog = debugTimer >= 0.5; // log twice per second max
    if (doLog) debugTimer = 0;

    // ---- Player speed, alert radius, etc. ----
    const player = engine.PlayerEntity;
    if (!player || !Transform.has(player)) return;
    const playerPos = Transform.get(player).position;
    let instSpeed = 0;
    if (lastPlayerPos) {
      instSpeed = computePlayerSpeed(playerPos, lastPlayerPos, dt);
      lastSpeeds.push(instSpeed);
      if (lastSpeeds.length > SPEED_SMOOTH_WINDOW) lastSpeeds.shift();
    }
    lastPlayerPos = { ...playerPos };
    const speed = lastSpeeds.length ? lastSpeeds.reduce((a, b) => a + b, 0) / lastSpeeds.length : 0;
    
    // ============================================================================ 
    // ANTI-FAKE STOP DETECTION
    // ============================================================================ 
    const fakeStopDetected = detectFakeStop(speed, dt);
    
    // Logs de debug supprimés pour éviter les messages trop volumineux
    
    // Ajuster le rayon d'alerte en fonction des fake stops
    let alertRadius = CONFIG.ALERT.RADIUS.IMMOBILE;
    if (speed < CONFIG.ALERT.SPEED.IMMOBILE) alertRadius = CONFIG.ALERT.RADIUS.IMMOBILE;
    else if (speed < CONFIG.ALERT.SPEED.WALK) alertRadius = CONFIG.ALERT.RADIUS.WALK;
    else if (speed < CONFIG.ALERT.SPEED.RUN) alertRadius = CONFIG.ALERT.RADIUS.RUN;
    else alertRadius = CONFIG.ALERT.RADIUS.SPRINT;
    
    const alertRadius2 = alertRadius * alertRadius;
    let inSafeZone = isInAnySafeZone(playerPos.x, playerPos.z);

    // ---- Limit to 3 ghosts chasing simultaneously ----
    let chasingCount = 0;
    for(let c=0; c<GHOST_COUNT; c++) if(isChasing[c]) chasingCount++;
    
    // ---- PRIORITÉ : Calculer les distances et trier les fantômes par proximité ----
    const ghostDistances: { index: number, distance: number }[] = [];
    for(let i = 0; i < GHOST_COUNT; i++) {
      const gx = ghostLogicalPositions[i].x;
      const gz = ghostLogicalPositions[i].z;
      const dxp = playerPos.x - gx;
      const dzp = playerPos.z - gz;
      const distance = Math.sqrt(dxp * dxp + dzp * dzp);
      ghostDistances.push({ index: i, distance });
    }
    
    // Trier par distance (plus proche en premier)
    ghostDistances.sort((a, b) => a.distance - b.distance);
    
    // Seuls les 3 fantômes les plus proches peuvent déclencher une poursuite
    const maxChasingGhosts = 3;
    const closestGhosts = ghostDistances.slice(0, maxChasingGhosts);

    // Center reference and central safe-zone radius (for inside checks)
    const center = CONFIG.SAFE_ZONE.CENTER;
    const centerRadius = CONFIG.SAFE_ZONE.CENTER_RADIUS - 0.5;

    // Ghost ↔ player collision and TP back to center
    // No forced TP by mutating Transform (unreliable on client)
    // Create a copy to avoid collection modification during enumeration
    const ghostEntitiesCopy = [...GHOST_ENTITIES];
    ghostEntitiesCopy.forEach((g, i) => {
      let desiredYaw: number | null = null;
      // ---- Dynamic patrol speed variance ----
      if(!isChasing[i]) {
        nextPatrolSpeedChange[i] -= dt;
        if(nextPatrolSpeedChange[i] <= 0) {
          currentPatrolSpeed[i] = CONFIG.GHOST.PATROL_SPEED_MIN + rand() * (CONFIG.GHOST.PATROL_SPEED_MAX - CONFIG.GHOST.PATROL_SPEED_MIN);
          nextPatrolSpeedChange[i] = 6 + rand() * 9;
        }
      } else {
        nextPatrolSpeedChange[i] = 6 + rand() * 9;
      }
      const t = Transform.getMutable(g);
      const gx = ghostLogicalPositions[i].x, gz = ghostLogicalPositions[i].z;
    const nowMs = Date.now();
    // Use deterministic time for patrol speed variation
    const phase = (tGlobal * 1000) % 99999;
    const dxp = playerPos.x - gx;
      const dzp = playerPos.z - gz;
      const dist2ToPlayer = dxp * dxp + dzp * dzp;
      
      // ✅ CORRECTION : Calculer desiredYaw EN PREMIER pour avoir l'orientation actuelle
      // Avant de calculer la suspicion (pour la chase, on utilise la position du joueur)
      if (isChasing[i] && !inSafeZone) {
        // Chase local player
        let targetX = playerPos.x;
        let targetZ = playerPos.z;
        
        // Prédiction de trajectoire basique
        if (lastPlayerPos) {
          const playerVelocityX = (playerPos.x - lastPlayerPos.x) / dt;
          const playerVelocityZ = (playerPos.z - lastPlayerPos.z) / dt;
          const playerSpeed = Math.sqrt(playerVelocityX * playerVelocityX + playerVelocityZ * playerVelocityZ);
          
          if (playerSpeed > 2.0) {
            const predictionTime = 0.1;
            targetX = playerPos.x + playerVelocityX * predictionTime;
            targetZ = playerPos.z + playerVelocityZ * predictionTime;
          }
        }
        desiredYaw = Math.atan2(targetZ - gz, targetX - gx);
      } else if (!isChasing[i]) {
        // Patrol : orientation vers le prochain point de patrol
        const patrol = dynamicPatrols[i];
        const targetIdx = ghostIdx[i];
        const target = patrol[targetIdx];
        const dx = target.x - t.position.x;
        const dz = target.z - t.position.z;
        if (dx*dx + dz*dz > 0.000001) {
          desiredYaw = Math.atan2(dz, dx);
        }
      } else {
        // Si chase mais inSafeZone, ne pas calculer d'orientation
        desiredYaw = null;
      }
      
      // ---- Suspicion & chase (local-only for stability) ----
      // Check both distance AND field of vision
      const inDistance = dist2ToPlayer < alertRadius2;
      
      // ✅ UTILISER desiredYaw (orientation cible actuelle) au lieu de ghostYaw[i] (ancienne orientation)
      let inVision = false;
      if (desiredYaw !== null) {
        // Calculer l'angle entre la direction du fantôme et le vecteur vers le joueur
        const dxToPlayer = playerPos.x - gx;
        const dzToPlayer = playerPos.z - gz;
        const angleToPlayer = Math.atan2(dzToPlayer, dxToPlayer);
        
        // Calculer la différence d'angle avec l'orientation CIBLE
        let angleDiff = angleToPlayer - desiredYaw;
        
        // Normaliser l'angle entre -PI et PI
        while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
        while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
        
        // Vérifier si le joueur est dans le champ de vision (60° de chaque côté = 120° total)
        const halfVisionAngle = (CONFIG.ALERT.VISION.ANGLE_DEG / 2) * (Math.PI / 180);
        inVision = Math.abs(angleDiff) <= halfVisionAngle;
      }
      
      // PRIORITÉ : Seuls les 3 fantômes les plus proches peuvent déclencher une suspicion
      const isClosestGhost = closestGhosts.some(ghost => ghost.index === i);
      const suspicion = !inSafeZone && inDistance && inVision && isClosestGhost;
      
      // Logs supprimés
      
      // ✅ Si un fake stop vient d'être détecté, SEULS les fantômes proches l'enregistrent
      // Chaque fantôme a son propre compteur de fake stops
      // Un fantôme ne peut compter un fake stop que s'il est proche du joueur (< 100m)
      if (fakeStopDetected && dist2ToPlayer < 10000) {
        lastFakeStopSeenByGhost[i] = Date.now();
        fakeStopCountPerGhost[i]++;
        lastFakeStopTimePerGhost[i] = Date.now();
      }
      
      // ✅ ANTI-FAKE STOP: Cooldown par fantôme
      const fakeStopCooldown = getFakeStopCooldown(i);
      const now = Date.now();
      const timeSinceLastFakeStop = now - lastFakeStopTimePerGhost[i];
      const isInFakeStopCooldown = fakeStopCooldown > 0 && timeSinceLastFakeStop < fakeStopCooldown;
      
      // ADAPTATION À LA VITESSE : Plus le joueur va vite, plus le temps de suspicion doit être court
      let suspicionThreshold = 2.0; // Base de 2 secondes
      
      // Réduire le temps de suspicion selon la vitesse du joueur
      if (speed >= CONFIG.ALERT.SPEED.RUN) {
        suspicionThreshold = 0.5; // 0.5s pour le sprint (très rapide)
      } else if (speed >= CONFIG.ALERT.SPEED.WALK) {
        suspicionThreshold = 1.0; // 1s pour la course
      } else {
        suspicionThreshold = 1.5; // 1.5s pour la marche
      }
      
      // Gérer le timer de suspicion
      if(suspicion) {
        // Si on vient d'entrer en suspicion (transition de false à true)
        if (!wasSuspicious[i]) {
          suspicionTimer[i] = 0;
          suspicionThresholdFrozen[i] = suspicionThreshold; // GELER le threshold
          
          // Log seulement si on n'a pas logué récemment (éviter les oscillations)
          const now = Date.now();
          if (now - lastSuspicionEnterTime[i] > 2000) { // 2 secondes de cooldown
            // console.log(`[GHOST_DEBUG] Ghost ${i}: JUST ENTERED suspicion, timer=0, threshold=${suspicionThresholdFrozen[i].toFixed(2)}s (FROZEN)`);
            lastSuspicionEnterTime[i] = now;
          }
          
          wasSuspicious[i] = true; // Marquer comme processed
        }
        // Toujours accumuler le timer si on est en suspicion
        suspicionTimer[i] += dt;
        
        // Log de progression du timer (toutes les 0.3 secondes)
        // if (i === 0 && Math.floor(suspicionTimer[i] * 2) % 2 === 0 && suspicionTimer[i] > 0 && suspicionTimer[i] < 2) {
        //   console.log(`[GHOST_DEBUG] Ghost ${i}: Timer=${suspicionTimer[i].toFixed(3)}s/${suspicionThresholdFrozen[i].toFixed(2)}s`);
        // }
      } else {
        // Reset le timer quand on sort de suspicion
        suspicionTimer[i] = 0;
        suspicionThresholdFrozen[i] = 0;
        
        // Reset wasSuspicious seulement après un délai pour éviter les oscillations
        // (On garde l'état pour une seconde pour filtrer les oscillations rapides)
        if (wasSuspicious[i]) {
          wasSuspicious[i] = false; // Reset immédiat pour permettre de nouvelles entrées
        }
      }
      // DÉCLENCHER une attaque si trop de fake stops détectés
      // ✅ NOUVEAU : Le fantôme DOIT être déjà en suspicion pour déclencher via fake stops
      // ET si un fake stop a été détecté dans les 5 dernières secondes par ce fantôme spécifiquement
      const recentFakeStopForThisGhost = lastFakeStopSeenByGhost[i] > 0 && Date.now() - lastFakeStopSeenByGhost[i] < 5000;
      // Pour les fake stops, on n'exige PAS inDistance/isClosestGhost car le fantôme peut avoir détecté les fake stops avant d'être assez proche
      // On vérifie juste que le joueur est dans une portée raisonnable (< 100m) pour éviter que des fantômes très lointains ne poursuivent
      const isPlayerWithinReasonableRange = dist2ToPlayer < 10000; // 100m en m²
      // ✅ Le fantôme DOIT être en suspicion pour déclencher via fake stops
      const isInSuspicion = suspicionTimer[i] > 0;
      const shouldAttackForFakeStops = isInSuspicion && fakeStopCountPerGhost[i] >= 3 && recentFakeStopForThisGhost && isPlayerWithinReasonableRange;
      
         // Debug SUCCINT pour comprendre pourquoi les fake stops sont détectés ou pas
         // if (shouldAttackForFakeStops && playerFakeStopCount >= 3) {
         //   console.log(`[FAKE_STOP_DEBUG] ✅ Ghost ${i} PEUT ATTAQUER via FAKE_STOPS (fakeStopCount=${playerFakeStopCount})`);
         // } else if (playerFakeStopCount >= 3 && !shouldAttackForFakeStops) {
         //   // Log détaillé pour debug avec positions
         //   const playerDistance = Math.sqrt(dist2ToPlayer);
         //   console.log(`[FAKE_STOP_DEBUG] ⏳ Ghost ${i} ne peut pas attaquer: recentStop=${recentFakeStopForThisGhost}, inRange=${isPlayerWithinReasonableRange}, suspicionTimer=${suspicionTimer[i].toFixed(2)}s, playerFakeStopCount=${playerFakeStopCount}, playerDistance=${playerDistance.toFixed(2)}m`);
         //   console.log(`[FAKE_STOP_DEBUG] Positions: Ghost(${gx.toFixed(1)}, ${gz.toFixed(1)}) Player(${playerPos.x.toFixed(1)}, ${playerPos.z.toFixed(1)})`);
         // }
      
      // CORRECTION : Séparer la logique de suspicion normale des fake stops
      // Utiliser le threshold GELÉ au moment de l'entrée en suspicion
      // Ne peut déclencher une poursuite via suspicion normale que si le threshold est gelé
      const hasEnoughSuspicion = suspicionThresholdFrozen[i] > 0 && suspicionTimer[i] >= suspicionThresholdFrozen[i];
      // Les fake stops peuvent déclencher une poursuite même sans suspicion préalable
      const canTriggerChase = hasEnoughSuspicion || shouldAttackForFakeStops;
      
      // Debug si un fantôme peut déclencher une poursuite avec un threshold de 0
      // if (canTriggerChase && !isChasing[i] && suspicionThresholdFrozen[i] === 0 && i < 5) {
      //   console.log(`[GHOST_DEBUG] Ghost ${i}: WARNING canTriggerChase with threshold=0! hasEnough=${hasEnoughSuspicion}, timer=${suspicionTimer[i].toFixed(3)}, fakeStops=${shouldAttackForFakeStops}`);
      // }
      
      // Debug si le fantôme peut déclencher une poursuite
      // if(canTriggerChase && !isChasing[i] && suspicionTimer[i] > 0 && suspicionTimer[i] < 2 && i === 0) {
      //   console.log(`[GHOST_DEBUG] Ghost ${i}: CAN TRIGGER! timer=${suspicionTimer[i].toFixed(2)}, threshold=${suspicionThresholdFrozen[i].toFixed(2)} (FROZEN), hasEnough=${hasEnoughSuspicion}, fakeStops=${shouldAttackForFakeStops}`);
      // }
      
      if(canTriggerChase) {
        // Ne pas commencer de poursuite si le joueur est dans une safe zone OU immobile et loin
        const playerDistance = Math.sqrt(dist2ToPlayer);
        const isPlayerImmobile = speed < CONFIG.ALERT.SPEED.IMMOBILE;
        const isPlayerFar = playerDistance > 15.0;
        
        // RÈGLES ORIGINALES : Respecter les limites de fantômes ET les rayons de détection
        // ET respecter les cooldowns entre états + avoir assez de suspicion
        const canStartChase = hasEnoughSuspicion && !inSafeZone && !(isPlayerImmobile && isPlayerFar) && !isChasing[i] && chasingCount < 3 && suspicionToPatrolCooldown[i] <= 0 && chaseToSuspicionCooldown[i] <= 0;
        
        // FAKE STOPS : Peuvent déclencher une attaque mais toujours avec la limite de 3 fantômes
        // ET respecter les cooldowns (condition !isInFakeStopMode[i] retirée car elle bloquait les attaques)
        const canAttackForFakeStops = shouldAttackForFakeStops && !inSafeZone && !(isPlayerImmobile && isPlayerFar) && chasingCount < 3 && chaseToSuspicionCooldown[i] <= 0;
        
        // DÉBUT DE POURSUITE : Soit suspicion normale, soit fake stops (mais toujours avec limites)
        if(canStartChase || canAttackForFakeStops) {
          if(!isChasing[i]) {
            chasingCount++;
            isChasing[i] = true;
            chasingDuration[i] = 6; // Durée initiale augmentée à 6 secondes
            chaseStartTime[i] = tGlobal; // Enregistrer le début de la poursuite
            
            // Log pour voir quand un fantôme entre en mode poursuite
            // const reason = shouldAttackForFakeStops ? "FAKE_STOPS" : "NORMAL_SUSPICION";
            // console.log(`[GHOST_CHASE] Ghost ${i} STARTING CHASE, reason=${reason}, timer=${suspicionTimer[i].toFixed(3)}s, threshold=${suspicionThresholdFrozen[i].toFixed(2)}s (FROZEN)`);
            
            // Déclencher le cooldown suspicion -> patrouille (3 secondes)
            suspicionToPatrolCooldown[i] = 3.0;
            
            // Attaque déclenchée par fake stops
            if(shouldAttackForFakeStops) {
              // Attaque fantôme
              // Marquer ce fantôme comme étant en mode fake stop
              isInFakeStopMode[i] = true;
              fakeStopModeTimeout[i] = 10.0; // 10 secondes de timeout
            }
          }
        }
        // else, restrict chase count; visual state remains red
      }
      if(isChasing[i]) {
        // ARRÊTER IMMÉDIATEMENT la poursuite si le joueur est dans une safe zone
        if(inSafeZone) {
          isChasing[i] = false;
          chasingDuration[i] = 0;
          chasingCount--;
          postChaseTimer[i] = 3; // remain in alert ("?") for a few seconds
          
          // ✅ Réinitialiser le timer ET l'état de suspicion pour éviter déclenchement immédiat
          suspicionTimer[i] = 0;
          wasSuspicious[i] = false;
          suspicionThresholdFrozen[i] = 0;
          
          // ✅ Forcer un cooldown minimum de 5 secondes pour éviter le redéclenchement immédiat
          chaseToSuspicionCooldown[i] = 5.0;
          
          // Sortir du mode fake stop quand le joueur entre dans une safe zone
          if(isInFakeStopMode[i]) {
            isInFakeStopMode[i] = false;
            fakeStopModeTimeout[i] = 0;
            // Cooldown déjà défini à 5.0 ligne précédente
          }
        } else {
          // Continuer la poursuite si :
          // 1. Le joueur est visible (suspicion) OU
          // 2. On est en cooldown anti-fake OU  
          // 3. Le joueur est proche (dans un rayon de 10m)
          const playerDistance = Math.sqrt(dist2ToPlayer);
          const isPlayerClose = playerDistance < 15.0; // Augmenté de 10 à 15m
          const isPlayerImmobile = speed < CONFIG.ALERT.SPEED.IMMOBILE;
          const isPlayerFar = playerDistance > 25.0; // Augmenté de 15 à 25m - plus permissif
          
          // ARRÊTER la poursuite seulement si le joueur est immobile ET très loin
          if(isPlayerImmobile && isPlayerFar) {
            isChasing[i] = false;
            chasingDuration[i] = 0;
            chasingCount--;
            postChaseTimer[i] = 3; // remain in alert ("?") for a few seconds
            // Déclencher le cooldown poursuite -> suspicion (5 secondes pour être moins agressif)
            chaseToSuspicionCooldown[i] = 5.0;
            // Réinitialiser le timestamp de fake stop vu par ce fantôme
            lastFakeStopSeenByGhost[i] = 0;
            // ✅ Déclencher le reset du compteur fake stop après 1 seconde
            fakeStopResetTimestamp[i] = Date.now() + 1000;
            // Sortir du mode fake stop quand la poursuite se termine
            if(isInFakeStopMode[i]) {
              isInFakeStopMode[i] = false;
              // Forcer un cooldown plus long pour éviter l'attaque immédiate
              chaseToSuspicionCooldown[i] = 8.0; // 8 secondes de cooldown
              // Fantôme sort du mode fake stop
            }
          } else if(suspicion || isInFakeStopCooldown || isPlayerClose) {
            // Reset de la durée de poursuite si le joueur est visible/proche
            chasingDuration[i] = 6; // Augmenté de 4 à 6 secondes pour poursuites plus longues
          } else {
            // Réduire la durée seulement si le joueur n'est plus visible ET pas en cooldown ET pas proche
            chasingDuration[i] -= dt * 0.5; // Ralentir la décrémentation de 50%
            if(chasingDuration[i] <= 0) {
              isChasing[i] = false;
              chasingDuration[i] = 0;
              chasingCount--;
              postChaseTimer[i] = 3; // remain in alert ("?") for a few seconds
              // Déclencher le cooldown poursuite -> suspicion (5 secondes pour être moins agressif)
              chaseToSuspicionCooldown[i] = 5.0;
              // Réinitialiser le timestamp de fake stop vu par ce fantôme
              lastFakeStopSeenByGhost[i] = 0;
              // ✅ Déclencher le reset du compteur fake stop après 1 seconde
              fakeStopResetTimestamp[i] = Date.now() + 1000;
              // Sortir du mode fake stop quand la poursuite se termine
              if(isInFakeStopMode[i]) {
                isInFakeStopMode[i] = false;
                // Forcer un cooldown plus long pour éviter l'attaque immédiate
                chaseToSuspicionCooldown[i] = 8.0; // 8 secondes de cooldown
                // Fantôme sort du mode fake stop
              }
            }
          }
        }
      }
      const chase = isChasing[i];
      let dx = 0, dz = 0, targetIdx = ghostIdx[i], len2 = 0, target = null;
      // ---- Ghost movement ----
      if(chase) {
        // ARRÊTER immédiatement la poursuite si le joueur est dans une safe zone
        if(inSafeZone) {
          // Ne pas bouger vers le joueur si il est dans une safe zone
          dx = 0;
          dz = 0;
          len2 = 0;
        } else {
          // Chase local player (stable, no network dependency)
          let targetX = playerPos.x;
          let targetZ = playerPos.z;
          
          // ✅ MÉCANISME 2 : Prédiction de trajectoire améliorée (anti-slalom)
          if (lastPlayerPos) {
            const playerVelocityX = (playerPos.x - lastPlayerPos.x) / dt;
            const playerVelocityZ = (playerPos.z - lastPlayerPos.z) / dt;
            const speed = Math.sqrt(playerVelocityX * playerVelocityX + playerVelocityZ * playerVelocityZ);
            
            // Prédire où le joueur sera basé sur sa vitesse
            // Plus le joueur va vite, plus on prédit loin (anti-slalom)
            if (speed > 2.0) {
              // Prédiction adaptative : plus le joueur est rapide, plus on prédit loin
              const predictionTime = Math.min(0.2 + (speed - 2.0) * 0.05, 0.4); // 0.2-0.4s selon vitesse
              targetX = playerPos.x + playerVelocityX * predictionTime;
              targetZ = playerPos.z + playerVelocityZ * predictionTime;
            }
          }
          
          dx = targetX - t.position.x;
          dz = targetZ - t.position.z;
          len2 = dx*dx + dz*dz;
          
          // ✅ Vitesse de poursuite constante (pas d'accélération si le joueur sprinte)
          let ghostChaseSpeed = GHOST_MAX_CHASE_SPEED_BASE; // Toujours 9.02 m/s selon CONFIG.GHOST.CHASE_SPEED
          // ❌ Plus d'accélération si le joueur sprinte - vitesse constante pour tous les fantômes
          
          // ✅ Boost de vitesse selon distance pour compenser le drift (anti-slalom renforcé)
          // ✅ SUPPRIMÉ: Système de boost dynamique - les fantômes gardent une vitesse constante
          // Les fantômes utilisent maintenant uniquement leur vitesse de base définie dans CONFIG.GHOST.CHASE_SPEED
          
          // BONUS de vitesse supprimé pour les fake stops (trop agressif)
          let canContinue = true;
          if(isInAnySafeZone(playerPos.x, playerPos.z)) canContinue = false;
          
          if(len2 > 0.01 && canContinue) {
          const invLen = 1 / Math.sqrt(len2);
          const curX = ghostLogicalPositions[i].x; const curZ = ghostLogicalPositions[i].z;
          const step = Math.min(ghostChaseSpeed * dt, Math.sqrt(len2));
          let nextX = curX + (dx*invLen) * step;
          let nextZ = curZ + (dz*invLen) * step;
          
          // Contraindre la position dans les limites du terrain
          const constrainedPos = constrainToTerrainBounds(nextX, nextZ);
          nextX = constrainedPos.x;
          nextZ = constrainedPos.z;
          
          let nextInSafeZone = isInAnySafeZone(nextX, nextZ);
          if(!nextInSafeZone) {
            // Mettre à jour la position logique (déterministe)
            ghostLogicalPositions[i] = Vector3.create(nextX, t.position.y, nextZ);
          }
          const mvx = ghostLogicalPositions[i].x - curX; const mvz = ghostLogicalPositions[i].z - curZ;
          const mvLen = Math.sqrt(mvx*mvx + mvz*mvz);
          if (mvLen > CONFIG.GHOST.HEADING_EPS) {
            headingX[i] = mvx / mvLen;
            headingZ[i] = mvz / mvLen;
          }
          // ✅ desiredYaw déjà calculé au début, pas besoin de le recalculer
          // Debug logs réduits pour améliorer les performances
          }
        }
      } else {
        const patrol = dynamicPatrols[i]
        targetIdx = ghostIdx[i]
        target = patrol[targetIdx]
        dx = target.x - t.position.x
        dz = target.z - t.position.z
        len2 = dx*dx + dz*dz
        if (len2 < 0.04) { targetIdx = (targetIdx + 1) % dynamicPatrols[i].length; }
        else if (len2 > 0.000001) {
          const curX = ghostLogicalPositions[i].x; const curZ = ghostLogicalPositions[i].z;
          const invLen = 1 / Math.sqrt(len2);
          const step = Math.min(currentPatrolSpeed[i] * dt, Math.sqrt(len2));
          let nextX = curX + (dx*invLen)*step;
          let nextZ = curZ + (dz*invLen)*step;
          
          // Contraindre la position dans les limites du terrain
          const constrainedPos = constrainToTerrainBounds(nextX, nextZ);
          nextX = constrainedPos.x;
          nextZ = constrainedPos.z;
          
          let nextInSafeZone = isInAnySafeZone(nextX, nextZ);
          if (!nextInSafeZone) {
            // Mettre à jour la position logique (déterministe)
            ghostLogicalPositions[i] = Vector3.create(nextX, t.position.y, nextZ);
          } else {
            dynamicPatrols[i] = genRandomPatrolAround(ghostLogicalPositions[i].x, ghostLogicalPositions[i].z);
            ghostIdx[i] = 0;
            targetIdx = 0;
          }
          const mvx = ghostLogicalPositions[i].x - curX; const mvz = ghostLogicalPositions[i].z - curZ;
          const mvLen = Math.sqrt(mvx*mvx + mvz*mvz);
          if (mvLen > CONFIG.GHOST.HEADING_EPS) {
            headingX[i] = mvx / mvLen;
            headingZ[i] = mvz / mvLen;
            // ✅ desiredYaw déjà calculé au début, pas besoin de le recalculer
          }
          // Debug logs réduits pour améliorer les performances
        }
        ghostIdx[i] = targetIdx;
      }
      // --- Vertical bobbing (relatif à la hauteur du terrain) ---
      const bob = tGlobal * 0.8 + i * 1.4;
      const bobOffset = 0.5 * Math.sin(bob); // Oscillation de ±0.5m
      
      // Calcul de hauteur du terrain (OPTIMISÉ avec cache)
      const currentPos = ghostLogicalPositions[i];
      const lastCheck = ghostLastHeightCheck.get(i) || { x: 0, z: 0, y: 0 };
      const movedDistance = Math.sqrt(
        (currentPos.x - lastCheck.x) ** 2 + (currentPos.z - lastCheck.z) ** 2
      );
      
      let groundY = lastCheck.y;
      
      // Recalculer seulement si on a bougé de plus de 4m (optimisation performance)
      if (movedDistance > 4.0) {
        groundY = getTerrainHeight(currentPos.x, currentPos.z);
        ghostLastHeightCheck.set(i, { x: currentPos.x, z: currentPos.z, y: groundY });
      }
      
      // Hauteur cible : 2.2m au-dessus du terrain
      const targetHeight = groundY + 2.2;
      const currentHeight = t.position.y - bobOffset - 0.15; // Retirer l'offset pour le calcul
      
      // Récupérer ou initialiser le lissage vertical
      let verticalSmoothing = ghostVerticalSmoothing.get(i);
      if (verticalSmoothing === undefined) {
        verticalSmoothing = currentHeight;
        ghostVerticalSmoothing.set(i, verticalSmoothing);
      }
      
      // Lissage vertical très lent et fluide pour les variations en Y
      const verticalSmoothingFactor = 0.03; // Très lent pour un mouvement fluide
      verticalSmoothing += (targetHeight - verticalSmoothing) * verticalSmoothingFactor;
      ghostVerticalSmoothing.set(i, verticalSmoothing);
      
      // Protection stricte : JAMAIS sous terrain + 1.8m
      const minHeight = groundY + 1.8;
      const finalHeight = Math.max(verticalSmoothing, minHeight);
      
      // Appliquer la hauteur finale avec offset du mesh
      t.position.y = finalHeight + bobOffset + 0.15; // Offset de 0.15m pour le mesh

      // ============================================================================ 
      // INTERPOLATION: Mise à jour des positions visuelles (fluides)
      // ============================================================================ 
      // Interpoler la position visuelle vers la position logique (lissage de trajectoire)
      const oldVisualX = ghostVisualPositions[i].x;
      const oldVisualZ = ghostVisualPositions[i].z;
      
      // ✅ MÉCANISME 3 : Interpolation adaptative selon l'état et la distance
      let smoothInterpolationSpeed = Math.min(INTERPOLATION_SPEED * 0.5, 6.0);
      
      // Si on poursuit le joueur, rendre l'interpolation plus réactive
      if (isChasing[i]) {
        const player = engine.PlayerEntity;
        if (player && Transform.has(player)) {
          const p = Transform.get(player).position;
          const distanceToPlayer = Math.sqrt(
            (p.x - ghostLogicalPositions[i].x) ** 2 + (p.z - ghostLogicalPositions[i].z) ** 2
          );
          
          // Plus on est proche du joueur, plus on est réactif (moins de drift)
          if (distanceToPlayer < 4) {
            // Très proche : interpolation très rapide pour coller au joueur
            smoothInterpolationSpeed = Math.min(INTERPOLATION_SPEED * 1.5, 10.0);
          } else if (distanceToPlayer < 10) {
            // Distance moyenne : interpolation rapide
            smoothInterpolationSpeed = Math.min(INTERPOLATION_SPEED * 1.0, 8.0);
          } else {
            // Distance : interpolation plus réactive qu'avant
            smoothInterpolationSpeed = Math.min(INTERPOLATION_SPEED * 0.8, 7.0);
          }
          // Interpolation plus rapide partout pour réduire le drift
        }
      }
      
      ghostVisualPositions[i] = Vector3.lerp(ghostVisualPositions[i], ghostLogicalPositions[i], dt * smoothInterpolationSpeed);
      
      // Debug logs réduits pour améliorer les performances
      
      // Mettre à jour la position réelle du transform avec la position visuelle interpolée
      t.position.x = ghostVisualPositions[i].x;
      t.position.z = ghostVisualPositions[i].z;
      
      // Update previous position (debug / potential secondary calc)
      lastGhostPos[i] = Vector3.create(t.position.x, t.position.y, t.position.z);

      // Orientation: smooth rotation towards desiredYaw (if defined), else keep previous
      {
        let targetYaw = (desiredYaw !== null ? desiredYaw : (ghostYaw[i] ?? 0));
        ghostYaw[i] = stepTowardsAngle(ghostYaw[i] ?? targetYaw, targetYaw, turnSpeed * dt);
        
        const model = ghostModels[i];
        if (model && Transform.has(model)) {
          const tm = Transform.getMutable(model);
          const dir = Vector3.create(Math.cos(ghostYaw[i]), 0, Math.sin(ghostYaw[i]));
          const rotAdjust = Quaternion.fromEulerDegrees(0, 90, 0);
          tm.rotation = Quaternion.multiply(Quaternion.lookRotation(dir), rotAdjust);
          
          // EFFET DE DÉFORMATION désactivé (hauteur variable selon terrain)
          // Scale uniforme sans déformation
          const baseScale = 2.5;
          tm.scale = Vector3.create(baseScale, baseScale, baseScale);
        }
        // Debug logs réduits pour améliorer les performances
      }

      // Fade transparency effect - GLB models manage their own transparency

      // Update previous position (for potential speed debug)
      lastGhostPos[i] = Vector3.create(t.position.x, 0, t.position.z);
      // --- Alert marker above ghost ---
      const mark = ALERT_MARKERS[i];
      const markTr = Transform.getMutable(mark);
      markTr.position.x = t.position.x;
      markTr.position.y = t.position.y + 1.55;
      markTr.position.z = t.position.z;
      const ts = TextShape.getMutable(mark);
      // Decrement post-chase timer
      if (postChaseTimer[i] > 0) {
        postChaseTimer[i] -= dt;
        if (postChaseTimer[i] < 0) postChaseTimer[i] = 0;
      }
      
      // Gestion des cooldowns entre états
      // Cooldown suspicion -> patrouille
      if (suspicionToPatrolCooldown[i] > 0) {
        suspicionToPatrolCooldown[i] -= dt;
        if (suspicionToPatrolCooldown[i] < 0) suspicionToPatrolCooldown[i] = 0;
      }
      
      // Cooldown poursuite -> suspicion
      if (chaseToSuspicionCooldown[i] > 0) {
        chaseToSuspicionCooldown[i] -= dt;
        if (chaseToSuspicionCooldown[i] < 0) chaseToSuspicionCooldown[i] = 0;
      }
      
      // Timeout du mode fake stop
      if (isInFakeStopMode[i] && fakeStopModeTimeout[i] > 0) {
        fakeStopModeTimeout[i] -= dt;
        if (fakeStopModeTimeout[i] <= 0) {
          isInFakeStopMode[i] = false;
          // Fantôme timeout
        }
      }
      
      // ✅ Reset du compteur fake stop après 1 seconde si la poursuite est terminée
      if (fakeStopResetTimestamp[i] > 0) {
        if (Date.now() >= fakeStopResetTimestamp[i]) {
          fakeStopCountPerGhost[i] = 0;
          fakeStopResetTimestamp[i] = 0;
          lastFakeStopSeenByGhost[i] = 0;
          // console.log(`[FAKE_STOP] Ghost ${i} reset fake stop counter after chase ended`);
        }
      }
      // Update marker state
      {
        let code: 0|1|2 = 0;
        if (isChasing[i]) code = 2; else if (suspicionTimer[i] > 0 || postChaseTimer[i] > 0) code = 1;
        if (alertCodes[i] !== code) {
          applyMarker(i, code);
        }
      }
      // --- Player collision (guarded by invulnerability) ---
      if (playerHitCooldown <= 0) {
        const t = Transform.get(g);
        const player = engine.PlayerEntity;
        if (player && Transform.has(player)) {
          const p = Transform.get(player).position;
          const ghostPos = Transform.get(g).position;
          const ghostDist = Math.sqrt(Math.pow(p.x - ghostPos.x,2) + Math.pow(p.z - ghostPos.z,2));
          const heightDiff = Math.abs(p.y - ghostPos.y);
          
          const playerInSafeZone = isInAnySafeZone(p.x, p.z);
          
          if (ghostDist < 1.25 && heightDiff < 1.9 && !playerInSafeZone) {
            const previousLives = PlayerUI.lives;
            PlayerUI.loseLife().then(() => {
              forceDeathDetection();
            }).catch(err => console.error('[FANTOME] Error saving life loss:', err));
            playerHitCooldown = 5;
          }
        }
      }
    });
      if (playerHitCooldown > 0) playerHitCooldown -= dt;
    });
  }
}

export function getGhostHandles(): { ghosts: Entity[]; markers: Entity[] } {
  return { ghosts: GHOST_ENTITIES, markers: ALERT_MARKERS };
}

// Initialize ghost synchronization (call this from main)
export function initGhostSyncSystem() {
  initGhostSync();
}