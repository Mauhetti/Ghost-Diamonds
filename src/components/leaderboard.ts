import { engine, Transform, TextShape, Font, TextAlignMode, Billboard, BillboardMode, MeshRenderer, Material, GltfContainer } from '@dcl/sdk/ecs';
import { Vector3, Color4 } from '@dcl/sdk/math';
import { CONFIG } from '../config';
import { FIREBASE_CONFIG } from '../config-firebase';

const RTDB_URL = FIREBASE_CONFIG.RTDB_URL;

// Leaderboard state
let leaderboardEntity: any = null;
let leaderboardTitleEntity: any = null;
let leaderboardBackground: any = null;
let ghostImageEntity: any = null;
let leaderboardData: { name: string, diamonds: number }[] = [];
let lastUpdateTime = 0;
const UPDATE_INTERVAL = 5; // Update every 5 seconds
const REFRESH_DATA_INTERVAL = 5; // Refresh from Firebase every 5 seconds
let lastDataRefreshTime = 0;

// Create leaderboard display
export function createLeaderboard() {
  if (leaderboardEntity) return; // Already created
  
  const CENTER = CONFIG.SAFE_ZONE.CENTER;
  
  // Create ghost image plane above leaderboard
  ghostImageEntity = engine.addEntity();
  Transform.create(ghostImageEntity, {
    position: { x: CENTER.x, y: 13, z: CENTER.z - 8 },
    scale: { x: 4, y: 4, z: 1 }
  });
  MeshRenderer.setPlane(ghostImageEntity);
  Material.setBasicMaterial(ghostImageEntity, {
    texture: Material.Texture.Common({
      src: 'assets/scene/Images/ghosty.png'
    })
  });
  Billboard.create(ghostImageEntity, { billboardMode: BillboardMode.BM_Y });
  
  // Create background panel (black semi-transparent) - PARENT
  leaderboardBackground = engine.addEntity();
  Transform.create(leaderboardBackground, {
    position: { x: CENTER.x, y: 10, z: CENTER.z - 8 },
    scale: { x: 4, y: 2.5, z: 0.1 }  // ✅ Réduit de moitié
  });
  MeshRenderer.setPlane(leaderboardBackground);
  Material.setBasicMaterial(leaderboardBackground, {
    diffuseColor: Color4.create(0, 0, 0, 0.5) // Black 50% transparent
  });
  Billboard.create(leaderboardBackground, { billboardMode: BillboardMode.BM_Y });
  
  // Create title (child of background) - TITRE
  leaderboardTitleEntity = engine.addEntity();
  Transform.create(leaderboardTitleEntity, {
    position: { x: 0, y: 0.5, z: -0.01 }, // Position en haut
    scale: { x: 0.25, y: 0.4, z: 0.25 },
    parent: leaderboardBackground // ENFANT du fond
  });
  
  TextShape.create(leaderboardTitleEntity, {
    text: 'LEADERBOARD',
    fontSize: 3, // x2 la taille (1.5 * 2)
    textColor: Color4.create(1, 1, 1, 1), // Blanc
    outlineColor: Color4.create(0, 0, 0, 1),
    outlineWidth: 0.1,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER,
    font: Font.F_SANS_SERIF
  });
  
  // Create leaderboard text (child of background) - CLASSEMENT
  leaderboardEntity = engine.addEntity();
  Transform.create(leaderboardEntity, {
    position: { x: 0, y: -0.3, z: -0.01 }, // ✅ 30cm sous le titre (0.2 - 0.5 = -0.3)
    scale: { x: 0.25, y: 0.35, z: 0.25 }, // ✅ Hauteur réduite pour éviter le débordement
    parent: leaderboardBackground // ENFANT du fond
  });
  
  TextShape.create(leaderboardEntity, {
    text: 'Loading...',
    fontSize: 3.0, // ✅ Taille x2 (1.5 * 2 = 3.0)
    textColor: Color4.create(1, 1, 1, 1), // ✅ BLANC comme demandé
    outlineColor: Color4.create(0, 0, 0, 1), // Contour noir
    outlineWidth: 0.2,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER,
    font: Font.F_SANS_SERIF
  });
  
  // Pas de Billboard sur l'enfant - il hérite du parent
  
  // Root container for rules (handles billboard and rotation)
  const rulesRootEntity = engine.addEntity();
  Transform.create(rulesRootEntity, {
    position: { x: 150, y: 6.6, z: 160 } // Décalé de -10 en X depuis le centre
  });
  Billboard.create(rulesRootEntity); // Billboard only on root

  // Background panel as child of root
  const rulesEntity = engine.addEntity();
  Transform.create(rulesEntity, {
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 5, y: 2.5, z: 0.1 },
    parent: rulesRootEntity
  });
  MeshRenderer.setPlane(rulesEntity);
  Material.setBasicMaterial(rulesEntity, {
    diffuseColor: Color4.create(0, 0, 0, 0.8) // Black 80% opaque
  });
  
  // Create rules title (child of background, like leaderboard)
  const rulesTitleEntity = engine.addEntity();
  Transform.create(rulesTitleEntity, {
    position: { x: 0, y: 0.33, z: -0.01 }, // Monté de 3cm supplémentaires
    parent: rulesEntity // Parent = fond, comme le leaderboard
  });
  TextShape.create(rulesTitleEntity, {
    text: 'GHOST DIAMONDS HUNTERS',
    fontSize: 0.63, // -20% supplémentaire
    font: Font.F_SANS_SERIF,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER,
    textColor: Color4.create(1, 1, 1, 1),
    outlineColor: Color4.create(0, 0, 0, 1),
    outlineWidth: 0.2,
    width: 4.0, // Réduit pour éviter l'étirement horizontal
    height: 0.7,
    textWrapping: true
  });
  
  // Create rules body text (child of background)
  const rulesTextEntity = engine.addEntity();
  Transform.create(rulesTextEntity, {
    position: { x: 0, y: 0.05, z: -0.01 }, // Plus proche du titre (remonté)
    parent: rulesEntity // Parent = fond, comme le leaderboard
  });
  TextShape.create(rulesTextEntity, {
    text: '• Go collect diamonds and save them in the chest\n\n• Ghosts only see you when facing them\n\n• You need at least 1 life to collect diamonds\n\n• One diamond by run\n\n• Plateformes with blue flames are safe zones\n\n• More you move, more they see',
    fontSize: 0.32, // Réduit pour tout afficher
    font: Font.F_SANS_SERIF,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER,
    textColor: Color4.create(1, 1, 1, 1),
    outlineColor: Color4.create(0, 0, 0, 1),
    outlineWidth: 0.15,
    width: 4.0, // Réduit pour limiter l'étirement
    height: 2.0, // Augmenté pour plus de lignes
    textWrapping: true
  });

  // Footer line (moved 20cm below the rules block)
  const rulesFooterEntity = engine.addEntity();
  Transform.create(rulesFooterEntity, {
    position: { x: 0, y: -0.25, z: -0.01 }, // Descendu de 10cm supplémentaires
    parent: rulesEntity
  });
  TextShape.create(rulesFooterEntity, {
    text: 'Stay allive ,collect diamonds, win respect !',
    fontSize: 0.396,
    font: Font.F_SANS_SERIF,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER,
    textColor: Color4.create(1, 1, 1, 1),
    outlineColor: Color4.create(0, 0, 0, 1),
    outlineWidth: 0.15,
    width: 4.0,
    height: 0.4,
    textWrapping: true
  });
  
}

// Update leaderboard data
export function updateLeaderboard(playerName: string, diamonds: number) {
  // Find existing player or add new one
  const existingIndex = leaderboardData.findIndex(p => p.name === playerName);
  
  if (existingIndex >= 0) {
    leaderboardData[existingIndex].diamonds = diamonds;
  } else {
    leaderboardData.push({ name: playerName, diamonds });
  }
  
  // Sort by diamonds (descending)
  leaderboardData.sort((a, b) => b.diamonds - a.diamonds);
  
  // Keep only top 10
  leaderboardData = leaderboardData.slice(0, 10);
  
  // ✅ MISE À JOUR IMMÉDIATE DE L'AFFICHAGE
  updateLeaderboardDisplay();
  
  // ✅ RAFRAÎCHISSEMENT IMMÉDIAT DEPUIS FIREBASE (pour synchroniser avec les autres joueurs)
  refreshLeaderboardFromFirebase();
}

// Refresh leaderboard data from Firebase using diamondBackups as primary source
async function refreshLeaderboardFromFirebase() {
  try {
    // ✅ UTILISER diamondBackups comme source principale (plus fiable)
    const response = await fetch(`${RTDB_URL}/diamondBackups.json`);
    
    if (!response.ok) {
      return;
    }
    
    const data = await response.json();
    if (!data) {
      return;
    }
    
    // Convertir les données diamondBackups en format leaderboard
    const newData: { name: string, diamonds: number }[] = [];
    
    for (const [address, backupData] of Object.entries(data)) {
      if (typeof backupData === 'object' && backupData !== null) {
        const bd = backupData as any;
        
        // ✅ Utiliser les données depuis diamondBackups
        const diamondCount = bd.diamonds || 0;
        
        // ✅ AFFICHER SEULEMENT LES JOUEURS AVEC DES DIAMANTS (> 0)
        if (diamondCount > 0) {
          // Essayer de récupérer le nom depuis /players/{address} pour l'affichage
          try {
            const playerResp = await fetch(`${RTDB_URL}/players/${address}.json`);
            let playerName = address.substring(0, 8) + '...'; // Fallback
            
            if (playerResp.ok) {
              const playerData = await playerResp.json();
              if (playerData && playerData.name) {
                // ✅ VALIDATION ET NETTOYAGE DU NOM
                playerName = playerData.name.trim();
                
                // Vérifier si le nom est valide
                if (!playerName || playerName === '' || playerName === 'null' || playerName === 'undefined') {
                  playerName = `Player_${address.substring(0, 8)}`;
                } else {
                  // Nettoyer le nom pour l'affichage
                  playerName = playerName
                    .replace(/[^\w\s-]/g, '') // Garder seulement lettres, chiffres, espaces et tirets
                    .substring(0, 15); // Limiter à 15 caractères pour l'affichage
                  
                  if (playerName.length === 0) {
                    playerName = `Player_${address.substring(0, 8)}`;
                  }
                }
              }
            }
            
            newData.push({ name: playerName, diamonds: diamondCount });
          } catch (nameError) {
            // Fallback avec nom généré
            const fallbackName = `Player_${address.substring(0, 8)}`;
            newData.push({ name: fallbackName, diamonds: diamondCount });
          }
        }
      }
    }
    
    // Trier et mettre à jour
    newData.sort((a, b) => b.diamonds - a.diamonds);
    
    // Garder les meilleurs scores (top 10)
    if (newData.length > 0) {
      leaderboardData = newData.slice(0, 10);
      updateLeaderboardDisplay();
    }
  } catch (error) {
    // ✅ PROTECTION: Ignorer les erreurs d'annulation (CancellationTokenSource disposed)
    if (error instanceof Error && (error.message.includes('CancellationTokenSource') || error.message.includes('disposed'))) {
      // Ignorer silencieusement - la scène est probablement en cours de rechargement
      return;
    }
    console.error('[LEADERBOARD] ❌ Error refreshing from diamondBackups:', error);
  }
}

// Update the visual display
function updateLeaderboardDisplay() {
  if (!leaderboardEntity) {
    return;
  }
  
  let displayText = '';
  
  if (leaderboardData.length === 0) {
    displayText = 'No players yet...\n\n\n\n\n\n\n\n\n\n'; // ✅ TAILLE FIXE : 10 lignes
  } else {
    // ✅ TAILLE FIXE : Toujours afficher 10 lignes maximum
    const maxDisplay = Math.min(leaderboardData.length, 10);
    
    for (let i = 0; i < 10; i++) { // Toujours 10 lignes
      if (i < maxDisplay) {
        const player = leaderboardData[i];
        const rank = i + 1;
        
        // ✅ MISE EN FORME SIMPLE : Limiter la longueur du nom et aligner
        const name = player.name.length > 10 ? player.name.substring(0, 10) + '..' : player.name;
        const paddedName = name.padEnd(12); // Padding pour alignement
        const paddedDiamonds = player.diamonds.toString().padStart(3); // Padding pour alignement
        
        displayText += `${rank}. ${paddedName} ${paddedDiamonds}\n`;
      } else {
        // Ligne vide pour maintenir la taille fixe
        displayText += '\n';
      }
    }
  }
  
  const textShape = TextShape.getMutable(leaderboardEntity);
  textShape.text = displayText;
}

// Force immediate refresh (for spawn)
export function forceRefreshLeaderboard() {
  refreshLeaderboardFromFirebase();
}

// ✅ DEBUG: Fonction pour vérifier les données diamondBackups
export async function debugDiamondBackups() {
  try {
    console.log('[LEADERBOARD] 🔍 DEBUG: Checking diamondBackups data...');
    const response = await fetch(`${RTDB_URL}/diamondBackups.json`);
    
    if (!response.ok) {
      console.log('[LEADERBOARD] 🔍 DEBUG: No diamondBackups data found');
      return;
    }
    
    const data = await response.json();
    console.log('[LEADERBOARD] 🔍 DEBUG: Raw diamondBackups data:', data);
    
    if (data) {
      const playerCount = Object.keys(data).length;
      console.log(`[LEADERBOARD] 🔍 DEBUG: Found ${playerCount} players in diamondBackups`);
      
      for (const [address, backupData] of Object.entries(data)) {
        const bd = backupData as any;
        console.log(`[LEADERBOARD] 🔍 DEBUG: ${address}: ${bd.diamonds} diamonds (timestamp: ${bd.timestamp})`);
      }
    }
  } catch (error) {
    console.error('[LEADERBOARD] 🔍 DEBUG: Error checking diamondBackups:', error);
  }
}

// Initialize leaderboard system
export function initLeaderboard() {
  // console.log('[LEADERBOARD] 🔥 INIT: Starting leaderboard initialization...'); // DÉSACTIVÉ pour réduire les logs
  createLeaderboard();
  
  // console.log('[LEADERBOARD] 🔥 INIT: Leaderboard created, leaderboardEntity:', leaderboardEntity); // DÉSACTIVÉ pour réduire les logs
  
  // Initial refresh from Firebase
  refreshLeaderboardFromFirebase();
  
  // Exposer une fonction de rafraîchissement manuel pour debug
  (globalThis as any).refreshLeaderboard = () => {
    // console.log('[LEADERBOARD] Manual refresh requested'); // DÉSACTIVÉ pour réduire les logs
    refreshLeaderboardFromFirebase();
  };
  
  // Exposer la fonction de rafraîchissement forcé
  (globalThis as any).forceRefreshLeaderboard = forceRefreshLeaderboard;
  
  // Exposer la fonction de debug pour diamondBackups
  (globalThis as any).debugDiamondBackups = debugDiamondBackups;
  
  // console.log('[LEADERBOARD] 🔥 INIT: Functions exposed on globalThis'); // DÉSACTIVÉ pour réduire les logs
  
  // Update display and refresh data from Firebase periodically
  engine.addSystem((dt) => {
    const currentTime = Date.now() / 1000;
    
    // Rafraîchir les données depuis Firebase toutes les 5 secondes
    if (currentTime - lastDataRefreshTime > REFRESH_DATA_INTERVAL) {
      refreshLeaderboardFromFirebase();
      lastDataRefreshTime = currentTime;
    }
    
    // Mettre à jour l'affichage toutes les 5 secondes (si les données ont changé)
    if (currentTime - lastUpdateTime > UPDATE_INTERVAL) {
      updateLeaderboardDisplay();
      lastUpdateTime = currentTime;
    }
  });
  
  // console.log('[LEADERBOARD] 🔥 INIT: Leaderboard system initialized'); // DÉSACTIVÉ pour réduire les logs
}

// Get current leaderboard data
export function getLeaderboardData() {
  return leaderboardData;
}

// Reset leaderboard (for testing)
export function resetLeaderboard() {
  leaderboardData = [];
  updateLeaderboardDisplay();
}