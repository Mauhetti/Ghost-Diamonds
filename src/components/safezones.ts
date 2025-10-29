import { engine, Entity, Transform, MeshRenderer, Material, TriggerArea, MeshCollider, GltfContainer, Animator, GltfContainerLoadingState, LoadingState } from '@dcl/sdk/ecs';
import { Vector3, Color4, Quaternion } from '@dcl/sdk/math';
import { CONFIG } from '../config';
import { triggerAreaEventsSystem } from '@dcl/sdk/ecs';
import { movePlayerTo } from '~system/RestrictedActions';
import { isDeathHandling } from '../systems/death';
import { PlayerUI } from '../systems/player';
import { ColliderLayer } from '@dcl/sdk/ecs';

// Fonction pour obtenir la hauteur du terrain à une position donnée
function getTerrainHeight(x: number, z: number): number {
  // Utiliser les mêmes calculs que dans simple-terrain-loader.ts
  const centerX = 160;
  const centerZ = 160;
  const distanceFromCenter = Math.sqrt(
    Math.pow(x - centerX, 2) + Math.pow(z - centerZ, 2)
  );
  
  // Base height du terrain visible (maintenant à Y = 1)
  const baseHeight = 1.0;
  
  // Variations basées sur les vraies données du terrain remodelé
  const heightVariation = Math.sin(x * 0.03) * Math.cos(z * 0.03) * 0.6; // ±0.6m
  const distanceVariation = (distanceFromCenter / 160) * -0.2; // Pente légère vers l'extérieur
  const noiseVariation = Math.sin(x * 0.08) * Math.sin(z * 0.08) * 0.2; // Bruit subtil
  
  return baseHeight + heightVariation + distanceVariation + noiseVariation;
}

// ===== SAFE ZONES POSITIONS ET TAILLES EN DUR =====

// Safe zone centrale (plateforme verte)
const CENTER_SAFEZONE_POS = { x: 160, y: 1.65, z: 160 };
const CENTER_SAFEZONE_RADIUS = 15; // Rayon du cylindre vert
const CENTER_SAFEZONE_HEIGHT = 2; // Épaisseur du cylindre (Y scale)

// Safe zones périphériques (zones rouges)
const SAFE_ZONE_RADIUS = 3.2; // Rayon de détection TRÈS large pour s'assurer que le joueur est protégé
const SAFE_ZONE_SIZE = 1; // Taille 1x1m
const SAFE_ZONE_VISUAL_OFFSET_X = 0; // Offset pour aligner le mesh visuel
const SAFE_ZONE_VISUAL_OFFSET_Z = 0; // Offset pour aligner le mesh visuel

// Positions fixes des 8 safe zones périphériques
const SAFE_ZONES = [
  { x: 160, z: 255 },      // Nord (0°)
  { x: 227.14, z: 227.14 }, // Nord-Est (45°)
  { x: 255, z: 160 },      // Est (90°)
  { x: 227.14, z: 92.86 }, // Sud-Est (135°)
  { x: 160, z: 65 },       // Sud (180°)
  { x: 92.86, z: 92.86 },  // Sud-Ouest (225°)
  { x: 65, z: 160 },       // Ouest (270°)
  { x: 92.86, z: 227.14 }  // Nord-Ouest (315°)
];

// État global pour éviter les duplications après reload
let safeZonesCreated = false;
let centerVisualEntity: Entity | null = null;
let centerTriggerEntity: Entity | null = null;
let platerformHaloEntity: Entity | null = null;
let zeroLifeEnforceCooldown = 0; // Cooldown pour éviter TP en boucle

export function createAllSafeZones() {
  // ✅ TOUJOURS recréer pour éviter les problèmes de reload
  // Reset des variables globales
  safeZonesCreated = false;
  centerVisualEntity = null;
  centerTriggerEntity = null;
  platerformHaloEntity = null;
  
  // console.log('[SAFEZONE] ===== CRÉATION DES SAFE ZONES ====='); // Réduit les logs
  // console.log('[SAFEZONE] Configuration:'); // Réduit les logs
  // console.log(`  - Rayon détection: ${SAFE_ZONE_RADIUS}m`); // Réduit les logs
  // console.log(`  - Taille mesh: ${SAFE_ZONE_SIZE}m x ${SAFE_ZONE_SIZE}m`); // Réduit les logs
  // console.log(`  - Position Y: 1.0m (au niveau du sol)`); // Réduit les logs
  
  // SAFE ZONE CENTRALE - ENTITÉS SÉPARÉES
  const centerVisual = engine.addEntity();
  const centerTrigger = engine.addEntity();
  centerVisualEntity = centerVisual;
  centerTriggerEntity = centerTrigger;
  
  // VISUEL - Asset GLB de la plateforme centrale avec colliders intégrés
  Transform.create(centerVisual, {
    position: Vector3.create(CENTER_SAFEZONE_POS.x, CENTER_SAFEZONE_POS.y, CENTER_SAFEZONE_POS.z),
    scale: Vector3.create(1, 1, 1), // Scale par défaut, ajustez selon vos besoins
    rotation: Quaternion.Identity()
  });
  GltfContainer.create(centerVisual, {
    src: 'assets/scene/Models/platerform/platerform.glb',
    visibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS,
    invisibleMeshesCollisionMask: ColliderLayer.CL_NONE
  });
  
  // TRIGGER - Sphère aplatie (en haut de la plateforme)
  Transform.create(centerTrigger, {
    position: Vector3.create(CENTER_SAFEZONE_POS.x, CENTER_SAFEZONE_POS.y, CENTER_SAFEZONE_POS.z), // Y du haut
    scale: Vector3.create(CENTER_SAFEZONE_RADIUS * 2, 0.1, CENTER_SAFEZONE_RADIUS * 2),
    rotation: Quaternion.Identity()
  });
  TriggerArea.setSphere(centerTrigger, ColliderLayer.CL_PLAYER);
  
  // Debug log on trigger exit (player leaving the central safe zone)
  triggerAreaEventsSystem.onTriggerExit(centerTrigger, (triggerResult) => {
    if (PlayerUI.lives === 0) {
      // Afficher "WAIT LIFE REGEN"
      import('../systems/death').then(({ showRegenText }) => {
        showRegenText();
      });
      
      movePlayerTo({
        newRelativePosition: { x: CENTER_SAFEZONE_POS.x, y: 5, z: CENTER_SAFEZONE_POS.z }, // Y=5 pour éviter d'être bloqué dans le sol
        cameraTarget: { x: CENTER_SAFEZONE_POS.x, y: 5, z: CENTER_SAFEZONE_POS.z }
      });
      // console.log('[SAFEZONE] Joueur TP - vies = 0');
    }
  });

  // Enregistrer aussi l'entrée pour afficher le texte immédiatement à 0 vie
  triggerAreaEventsSystem.onTriggerEnter(centerTrigger, (triggerResult) => {
    if (PlayerUI.lives === 0) {
      import('../systems/death').then(({ showRegenText }) => {
        showRegenText();
      });
    }
  });

  // console.log(`[SAFEZONE] ✅ Zone centrale VERTE avec PLANE COLLIDER à (${CENTER_SAFEZONE_POS.x}, 3, ${CENTER_SAFEZONE_POS.z})`);

  // ===== PLATERFORM HALO (Asset animé au centre) =====
  const platerformHalo = engine.addEntity();
  platerformHaloEntity = platerformHalo;
  Transform.create(platerformHalo, {
    position: Vector3.create(CENTER_SAFEZONE_POS.x, CENTER_SAFEZONE_POS.y, CENTER_SAFEZONE_POS.z),
    scale: Vector3.create(1, 1, 1),
    rotation: Quaternion.Identity()
  });
  
  // Charger le modèle GLB SANS Animator d'abord
  // D'après la doc: "the default behavior is that the first of these is always played on a loop"
  GltfContainer.create(platerformHalo, {
    src: 'assets/scene/Models/platerform-halo/platerform-halo.glb',
    visibleMeshesCollisionMask: ColliderLayer.CL_NONE, // Pas de collider pour l'effet visuel
    invisibleMeshesCollisionMask: ColliderLayer.CL_NONE
  });
  
  // console.log('[ANIMATION] ✅ Modèle GLB chargé - animation automatique attendue'); // Réduit les logs pour éviter 'Message too large'
  
  // Attendre un peu puis ajouter l'Animator si nécessaire
  // Cette approche permet de voir si l'animation se joue automatiquement
  
  // console.log('[SAFEZONE] ✅ Platerform Halo créé avec animation au centre'); // Réduit les logs pour éviter 'Message too large'

  // Fixed square zones around the map - position fixe Y=1.5 avec colliders
  for (let i = 0; i < SAFE_ZONES.length; i++) {
    const pos = SAFE_ZONES[i];
    
    // Vérifier si cette zone est trop proche de la zone centrale
    const distanceFromCenter = Math.sqrt(
      Math.pow(pos.x - CENTER_SAFEZONE_POS.x, 2) + 
      Math.pow(pos.z - CENTER_SAFEZONE_POS.z, 2)
    );
    
    // Si la zone est trop proche de la zone centrale, la passer
    // Seuil plus strict pour éviter tout cube rouge près du centre
    if (distanceFromCenter < CENTER_SAFEZONE_RADIUS + 10) {
      continue;
    }
    
    const zone = engine.addEntity();
    Transform.create(zone, {
      position: Vector3.create(pos.x + SAFE_ZONE_VISUAL_OFFSET_X, 1.0, pos.z + SAFE_ZONE_VISUAL_OFFSET_Z), // Y=1.0 avec offset possible
      scale: Vector3.create(SAFE_ZONE_SIZE, 2.16, SAFE_ZONE_SIZE), // Épaisseur normale
      rotation: Quaternion.Identity()
    });
    
    // Utiliser le modèle GLB sz2.glb au lieu de MeshRenderer
    GltfContainer.create(zone, {
      src: 'assets/scene/Models/sz2/sz2.glb',
      visibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS, // ✅ Colliders sur layer physique
      invisibleMeshesCollisionMask: ColliderLayer.CL_NONE
    });
    
    // Créer l'entité sz2-fire pour l'animation
    const fireEntity = engine.addEntity();
    Transform.create(fireEntity, {
      position: Vector3.create(0, 0.5, 0), // Position relative au parent, monté de 0.5m en Y
      scale: Vector3.create(1, 0.7, 1), // Scale Y réduit de 30% (1.0 -> 0.7)
      rotation: Quaternion.Identity(),
      parent: zone // Parent de la safe zone
    });
    
    GltfContainer.create(fireEntity, {
      src: 'assets/scene/Models/sz2-fire/sz2-fire.glb',
      visibleMeshesCollisionMask: ColliderLayer.CL_NONE, // Pas de collision pour l'effet visuel
      invisibleMeshesCollisionMask: ColliderLayer.CL_NONE
    });
    
    // Ajouter toutes les animations fire en boucle
    Animator.create(fireEntity, {
      states: [
        {
          clip: 'fire-1',
          playing: true,
          loop: true,
          speed: 1.0
        },
        {
          clip: 'fire-2',
          playing: true,
          loop: true,
          speed: 1.0
        },
        {
          clip: 'fure-3',
          playing: true,
          loop: true,
          speed: 1.0
        },
        {
          clip: 'fire-4',
          playing: true,
          loop: true,
          speed: 1.0
        }
      ]
    });
    
    // Ajouter un trigger pour détecter l'entrée/sortie (pas de collider physique pour permettre de marcher sur le terrain)
    TriggerArea.setBox(zone, ColliderLayer.CL_PLAYER);
    
    // console.log(`[SAFEZONE] ✅ Zone ${i + 1} créée à (${pos.x}, 1.0, ${pos.z}) - Rayon: ${SAFE_ZONE_RADIUS}m`); // Réduit les logs
  }
  
  // console.log('[SAFEZONE] ===== FIN CRÉATION SAFE ZONES ====='); // Réduit les logs
  safeZonesCreated = true;

  // Système de garde global: si vies=0 et joueur hors safe zones, TP au centre
  engine.addSystem((dt) => {
    if (zeroLifeEnforceCooldown > 0) {
      zeroLifeEnforceCooldown -= dt;
    }
    const player = engine.PlayerEntity;
    if (!player || !Transform.has(player)) return;
    if (PlayerUI.lives === 0 && !isDeathHandling()) {
      const p = Transform.get(player).position;
      if (!isInAnySafeZone(p.x, p.z) && zeroLifeEnforceCooldown <= 0) {
        import('../systems/death').then(({ showRegenText }) => {
          showRegenText();
        });
        movePlayerTo({
          newRelativePosition: { x: CENTER_SAFEZONE_POS.x, y: 5, z: CENTER_SAFEZONE_POS.z },
          cameraTarget: { x: CENTER_SAFEZONE_POS.x, y: 5, z: CENTER_SAFEZONE_POS.z }
        });
        zeroLifeEnforceCooldown = 1.0; // 1s pour éviter spam
      }
    }
  });
}

export function isInAnySafeZone(x: number, z: number) {
  for(const sz of SAFE_ZONES) {
    const dx = x - sz.x, dz = z - sz.z;
    if (dx*dx + dz*dz < SAFE_ZONE_RADIUS*SAFE_ZONE_RADIUS) return true;
  }
  const dxC = x - CENTER_SAFEZONE_POS.x;
  const dzC = z - CENTER_SAFEZONE_POS.z;
  if (dxC*dxC + dzC*dzC < CENTER_SAFEZONE_RADIUS*CENTER_SAFEZONE_RADIUS) return true;
  return false;
}

export function getSafeZonesList() {
  return SAFE_ZONES;
}