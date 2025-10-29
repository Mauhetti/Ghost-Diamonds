import { engine, Transform, Entity, InputModifier } from '@dcl/sdk/ecs';
import { Vector3 } from '@dcl/sdk/math';
import { isInAnySafeZone } from '../components/safezones';
import { isPlayerDead } from './death';
import { CONFIG } from '../config';

const SPRINT_DURATION = 3.0; // Maximum 3 seconds of sprint
const SPRINT_SPEED_THRESHOLD = 12; // Seuil de sprint (haut pour éviter les pentes)

let currentSprintTime = SPRINT_DURATION; // Time remaining (in seconds)
let lastPlayerPosition: { x: number, y: number, z: number } | null = null;
let isPlayerSprinting = false;
let sprintAreaEntity: Entity | null = null;

export function getStaminaPercentage(): number {
  // Return percentage based on time remaining (0 to 100%)
  return (currentSprintTime / SPRINT_DURATION) * 100;
}

export function resetStaminaToFull() {
  currentSprintTime = SPRINT_DURATION;
  console.log('[STAMINA] Reset stamina to full');
}

export function initStaminaSystem() {
  // console.log('[STAMINA] System initialized - 3 seconds sprint capacity'); // Réduit les logs pour éviter "Message too large"
  
  // Create a global area that controls sprint based on stamina
  sprintAreaEntity = engine.addEntity();
  Transform.create(sprintAreaEntity, {
    position: Vector3.create(160, 0, 160), // Center of scene
    scale: Vector3.create(320, 20, 320) // Cover entire scene
  });
  
  // Reset stamina to full at spawn
  currentSprintTime = SPRINT_DURATION;
  
  // Clean up any leftover InputModifiers from previous session
  const playerEntity = engine.PlayerEntity;
  if (playerEntity && InputModifier.has(playerEntity)) {
    InputModifier.deleteFrom(playerEntity);
    console.log('[STAMINA] Cleaned up leftover InputModifier at spawn');
  }
  
  // Update stamina based on player movement speed
  let firstFrame = true;
  engine.addSystem((dt: number) => {
    const playerEntity = engine.PlayerEntity;
    if (!playerEntity || !Transform.has(playerEntity)) {
      return;
    }
    
    // Clean up any InputModifiers on first frame (safety)
    if (firstFrame) {
      firstFrame = false;
      if (InputModifier.has(playerEntity)) {
        const modifier = InputModifier.get(playerEntity);
        if (modifier && modifier.mode && modifier.mode.$case === 'standard') {
          const isDisableAll = modifier.mode.standard.disableAll === true;
          if (!isDisableAll) {
            // Remove disableRun modifiers on first frame, keep disableAll from death system
            InputModifier.deleteFrom(playerEntity);
          }
        }
      }
    }
    
    const playerPosition = Transform.get(playerEntity).position;
    
    // Calculate player speed (HORIZONTAL ONLY - ignore vertical movement)
    let speed = 0;
    if (lastPlayerPosition) {
      const dx = playerPosition.x - lastPlayerPosition.x;
      const dz = playerPosition.z - lastPlayerPosition.z;
      // Ignore dy (vertical) to avoid counting falls/descents as sprint
      const distance = Math.sqrt(dx*dx + dz*dz);
      speed = distance / dt;
    }
    
    // Check if player is in a safe zone
    const inSafeZone = isInAnySafeZone(playerPosition.x, playerPosition.z);
    
    // Check if player is sprinting (over 11.8 m/s)
    const wasSprinting = isPlayerSprinting;
    isPlayerSprinting = speed > SPRINT_SPEED_THRESHOLD;
    
    // Consume stamina when sprinting
    if (isPlayerSprinting && currentSprintTime > 0) {
      // Consume sprint time: multiply by 2.86 to make it last ~1.05s instead of 3s (+40% consumption total)
      currentSprintTime = Math.max(0, currentSprintTime - (dt * 2.86));
    }
    
    // Regenerate stamina ONLY in safe zones
    if (inSafeZone && currentSprintTime < SPRINT_DURATION) {
      currentSprintTime = Math.min(SPRINT_DURATION, currentSprintTime + (dt * 2)); // Fast recharge in safe zones
    }
    
    // Skip stamina control if player is dead
    if (isPlayerDead) {
      lastPlayerPosition = { x: playerPosition.x, y: playerPosition.y, z: playerPosition.z };
      return;
    }
    
    if (currentSprintTime <= 0) {
      // Disable sprint when stamina is 0 (selon doc officielle)
      if (playerEntity) {
        InputModifier.createOrReplace(playerEntity, {
          mode: InputModifier.Mode.Standard({
            disableRun: true
          })
        });
        // console.log('[STAMINA] 🚫 Blocked sprint (stamina=0)'); // Réduit les logs pour éviter "Message too large"
      }
    } else if (currentSprintTime > 0) {
      // Re-enable sprint when stamina is restored (selon doc officielle)
      if (playerEntity && InputModifier.has(playerEntity)) {
        const modifier = InputModifier.get(playerEntity);
        if (modifier && modifier.mode && modifier.mode.$case === 'standard' && modifier.mode.standard.disableRun === true) {
          InputModifier.createOrReplace(playerEntity, {
            mode: InputModifier.Mode.Standard({
              disableRun: false
            })
          });
          // console.log('[STAMINA] ✅ Re-enabled sprint (stamina>0)'); // Réduit les logs pour éviter "Message too large"
        }
      }
    }
    
    lastPlayerPosition = { x: playerPosition.x, y: playerPosition.y, z: playerPosition.z };
  });
}
